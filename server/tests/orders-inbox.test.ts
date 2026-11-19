// Catalog, orders (confirmed -> won deal) and the WhatsApp inbox (incoming
// messages, drafts, conversation state). Synthetic data only.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.ts';
import { importCrm } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import type { CatalogProduct, OrderDetail, OrderSummary, Paged, WaContact, WaMessageRow, WaSummary } from '../../shared/types.ts';
import type { WaAgentContext } from '../../shared/whatsapp.ts';

const TODAY = '2026-11-19';
const AT = `${TODAY}T10:00:00.000Z`;

function setup() {
  const db = openDb(':memory:');
  importCrm(
    db,
    { leads: [{ category: 'restoran_halal_western', name: 'Grill Satu', owner: 'Encik Satu', phone: '012-1111111', salesValue: 500_000, primaryRegion: 'Selangor' }] },
    { today: TODAY },
  );
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = handle(method, path, query, body);
    return { status: r.status, body: r.body as T };
  };
  const ok = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = call<T>(method, path, body, query);
    assert.ok(r.status < 400, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  };
  const leadId = (db.prepare('SELECT id FROM leads LIMIT 1').get() as { id: number }).id;
  const ribeye = ok<CatalogProduct>('POST', '/products', { name: 'Ribeye Australia', category: 'beef', unit: 'kg', price_sen: 8990, min_qty: 2 });
  const wings = ok<CatalogProduct>('POST', '/products', { name: 'Kepak ayam', category: 'chicken', unit: 'kotak 10kg', price_sen: 12000 });
  return { db, call, ok, leadId, ribeye, wings };
}

describe('catalog', () => {
  it('validates products and finds them by words', () => {
    const { call, ok } = setup();
    assert.equal(call('POST', '/products', { name: 'X', category: 'pork', unit: 'kg', price_sen: 100 }).status, 400);
    assert.equal(call('POST', '/products', { name: 'X', category: 'beef', unit: 'kg', price_sen: 1.5 }).status, 400);
    const found = ok<CatalogProduct[]>('GET', '/wa/agent/products', undefined, { q: 'ribeye' });
    assert.deepEqual(found.map((p) => p.name), ['Ribeye Australia']);
    assert.equal(ok<CatalogProduct[]>('GET', '/wa/agent/products', undefined, { category: 'chicken' }).length, 1);
    // No match: the whole catalog rather than nothing.
    assert.equal(ok<CatalogProduct[]>('GET', '/wa/agent/products', undefined, { q: 'udang' }).length, 2);
  });
});

describe('orders', () => {
  it('prices from the catalog and enforces minimums', () => {
    const { ok, call, leadId, ribeye, wings } = setup();
    assert.equal(call('POST', '/orders', { lead_id: leadId, items: [{ product_id: ribeye.id, qty: 1 }] }).status, 400, 'below minimum');
    assert.equal(call('POST', '/orders', { lead_id: leadId, items: [{ product_id: 999, qty: 1 }] }).status, 400);
    assert.equal(call('POST', '/orders', { lead_id: leadId, items: [] }).status, 400);
    const o = ok<OrderDetail>('POST', '/orders', {
      lead_id: leadId,
      items: [
        { product_id: ribeye.id, qty: 2.5, price_sen: 1 },
        { product_id: wings.id, qty: 3 },
      ],
      delivery_date: '2026-11-21',
      source: 'whatsapp_agent',
      at: AT,
    });
    assert.equal(o.status, 'pending');
    assert.equal(o.total_sen, Math.round(2.5 * 8990) + 3 * 12000, 'a price sent by the caller is ignored');
    assert.equal(o.items.length, 2);
    assert.equal(o.source, 'whatsapp_agent');
    assert.match(o.items_summary ?? '', /2.5 kg Ribeye Australia/);
    // Edit while pending.
    const edited = ok<OrderDetail>('PATCH', `/orders/${o.id}`, { items: [{ product_id: wings.id, qty: 5 }] });
    assert.equal(edited.total_sen, 60000);
    assert.equal(call('PATCH', `/orders/${o.id}`, { status: 'delivered' }).status, 400, 'cannot skip confirmation');
  });

  it('a confirmed order becomes a won deal; cancelling takes it back', () => {
    const { ok, call, db, leadId, wings } = setup();
    const o = ok<OrderDetail>('POST', '/orders', { lead_id: leadId, items: [{ product_id: wings.id, qty: 10 }] });
    const confirmed = ok<OrderDetail>('PATCH', `/orders/${o.id}`, { status: 'confirmed' });
    assert.ok(confirmed.deal_id);
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(confirmed.deal_id!) as { stage: string; amount: number; product: string; type: string };
    assert.deepEqual([deal.stage, deal.amount, deal.product, deal.type], ['won', 1200, 'chicken', 'new_business']);
    const lead = db.prepare('SELECT status, deal_id FROM leads WHERE id = ?').get(leadId) as { status: string; deal_id: number };
    assert.deepEqual([lead.status, lead.deal_id], ['converted', confirmed.deal_id]);
    assert.equal(call('PATCH', `/orders/${o.id}`, { items: [{ product_id: wings.id, qty: 1 }] }).status, 409, 'items fixed once confirmed');
    ok('PATCH', `/orders/${o.id}`, { status: 'cancelled', cancel_reason: 'Pelanggan batal' });
    assert.equal((db.prepare('SELECT stage FROM deals WHERE id = ?').get(confirmed.deal_id!) as { stage: string }).stage, 'lost');
    const s = ok<OrderSummary>('GET', '/orders/summary');
    assert.equal(s.counts.cancelled, 1);
  });

  it('creates the account for a lead that has none', () => {
    const { ok, db, wings } = setup();
    const inbound = ok<{ lead_id: number }>('POST', '/wa/inbound', { phone: '+60 19-222 3333', name: 'Kafe Baru', body: 'Nak order', at: AT });
    const o = ok<OrderDetail>('POST', '/orders', { lead_id: inbound.lead_id, items: [{ product_id: wings.id, qty: 1 }] });
    const c = ok<OrderDetail>('PATCH', `/orders/${o.id}`, { status: 'confirmed' });
    const acc = db.prepare('SELECT a.name, a.source FROM accounts a JOIN leads l ON l.account_id = a.id WHERE l.id = ?').get(inbound.lead_id) as { name: string; source: string };
    assert.deepEqual([acc.name, acc.source], ['Kafe Baru', 'WhatsApp']);
    assert.ok(c.deal_id);
  });
});

describe('whatsapp inbox', () => {
  it('records incoming messages, new customers and duplicates', () => {
    const { ok, db, leadId } = setup();
    // Known number (other format) goes to the existing lead.
    const a = ok<{ lead_id: number; duplicate: boolean }>('POST', '/wa/inbound', { phone: '60121111111', body: 'Salam, ada ribeye?', wa_id: 'wamid.1', at: AT });
    assert.equal(a.lead_id, leadId);
    const again = ok<{ lead_id: number; duplicate: boolean }>('POST', '/wa/inbound', { phone: '60121111111', body: 'Salam, ada ribeye?', wa_id: 'wamid.1', at: AT });
    assert.equal(again.duplicate, true);
    // Unknown number: a new lead on the WhatsApp channel.
    const b = ok<{ lead_id: number }>('POST', '/wa/inbound', { phone: '+60 13-444 5555', name: 'Puan Baru', body: 'Harga ayam?', at: AT });
    const nl = db.prepare('SELECT name, channel, phone, status FROM leads WHERE id = ?').get(b.lead_id) as Record<string, string>;
    assert.deepEqual([nl.name, nl.channel, nl.phone, nl.status], ['Puan Baru', 'whatsapp', '013-4445555', 'new']);
    const c = ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { lead_id: leadId }).rows[0];
    assert.deepEqual([c.wa_unread, c.last_direction, c.wa_status, c.wa_replied_at], [1, 'in', 'yes', AT]);
    const s = ok<WaSummary>('GET', '/wa/summary');
    assert.deepEqual([s.unread, s.live, s.agentServer], [2, false, false]);
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'unread' }).total, 2);
  });

  it('keeps agent drafts apart until they are sent', () => {
    const { ok, call, db, leadId } = setup();
    ok('POST', '/wa/inbound', { lead_id: leadId, body: 'Boleh hantar esok?', at: AT });
    const draft = ok<WaMessageRow>('POST', '/wa/messages', { lead_id: leadId, body: 'Boleh, tuan.', author: 'agent', status: 'draft', at: AT });
    let lead = db.prepare('SELECT status, wa_unread FROM leads WHERE id = ?').get(leadId) as { status: string; wa_unread: number };
    assert.deepEqual([lead.status, lead.wa_unread], ['new', 1], 'a draft is not contact');
    assert.equal(ok<WaSummary>('GET', '/wa/summary').drafts, 1);
    assert.equal(ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { lead_id: leadId }).rows[0].sent_count, 0);
    ok('PATCH', `/wa/messages/${draft.id}`, { body: 'Boleh, tuan. Esok pagi.' });
    const sent = ok<WaMessageRow>('PATCH', `/wa/messages/${draft.id}`, { status: 'opened', at: `${TODAY}T10:05:00.000Z` });
    assert.deepEqual([sent.status, sent.body, sent.created_at], ['opened', 'Boleh, tuan. Esok pagi.', `${TODAY}T10:05:00.000Z`]);
    lead = db.prepare('SELECT status, wa_unread FROM leads WHERE id = ?').get(leadId) as { status: string; wa_unread: number };
    assert.deepEqual([lead.status, lead.wa_unread], ['mql', 0]);
    assert.equal(call('PATCH', `/wa/messages/${draft.id}`, { body: 'x' }).status, 409, 'sent messages are not edited');
    assert.equal(call('DELETE', `/wa/messages/${draft.id}`).status, 409);
    const d2 = ok<WaMessageRow>('POST', '/wa/messages', { lead_id: leadId, body: 'Draf lain', author: 'agent', status: 'draft' });
    assert.equal(call('DELETE', `/wa/messages/${d2.id}`).status, 204);
  });

  it('tracks hand-off and agent switch, and builds the agent context', () => {
    const { ok, leadId, wings } = setup();
    ok('POST', '/wa/inbound', { lead_id: leadId, body: 'Nak buat aduan', at: AT });
    ok('PATCH', `/wa/leads/${leadId}`, { needs_human: true, reason: 'Aduan kualiti' });
    ok('PATCH', `/wa/leads/${leadId}`, { agent_off: true, read: true });
    const c = ok<Paged<WaContact>>('GET', '/wa/contacts', undefined, { stage: 'human' }).rows[0];
    assert.deepEqual([c.lead_id, c.wa_human_reason, c.wa_agent_off, c.wa_unread], [leadId, 'Aduan kualiti', 1, 0]);
    ok('POST', '/orders', { lead_id: leadId, items: [{ product_id: wings.id, qty: 2 }] });
    ok('POST', '/wa/messages', { lead_id: leadId, body: 'draf', author: 'agent', status: 'draft' });
    const ctx = ok<WaAgentContext>('GET', '/wa/agent/context', undefined, { lead_id: leadId });
    assert.equal(ctx.lead.agent_off, 1);
    assert.equal(ctx.messages.length, 1, 'drafts are not part of the conversation');
    assert.equal(ctx.orders.length, 1);
    assert.equal(ctx.products, 2);
    assert.equal(ctx.agent.enabled, true);
    assert.equal(ctx.agent.autoSend, false);
  });
});
