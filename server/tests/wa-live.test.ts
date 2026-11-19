// WhatsApp Business Platform connection: webhook verification and signatures,
// incoming messages, the agent's reply sent through a fake Graph API, delivery
// reports and the 24-hour window. No network.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import { openDb } from '../db.ts';
import { importCrm } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import { createWaLive } from '../wa-live.ts';
import type { Paged, WaContact, WaMessageRow } from '../../shared/types.ts';

const SECRET = 'app-secret';
const TODAY = new Date().toISOString().slice(0, 10);

function setup(opts: { autoSend?: boolean; reply?: string } = {}) {
  const db = openDb(':memory:');
  importCrm(db, { leads: [{ category: 'restoran_halal_western', name: 'Grill Satu', owner: 'Encik Satu', phone: '012-1111111', primaryRegion: 'Selangor' }] }, { today: TODAY });
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => handle(method, path, query, body).body as T;
  if (opts.autoSend) call('PATCH', '/wa/agent/settings', { autoSend: true });
  const sent: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const fetchImpl = (async (url: string, init: { body: string; headers: Record<string, string> }) => {
    sent.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.out${sent.length}` }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = {
    beta: { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: opts.reply ?? 'Waalaikumsalam, boleh saya bantu?' }], usage: { input_tokens: 1, output_tokens: 1 } }) } },
  } as unknown as Anthropic;
  const wa = createWaLive({
    db,
    today: () => TODAY,
    config: { token: 'tok', phoneNumberId: 'PN1', appSecret: SECRET, verifyToken: 'verify-me', agent: true },
    client,
    fetchImpl,
    debounceMs: 5,
    log: () => {},
  });
  const sign = (raw: Buffer) => `sha256=${createHmac('sha256', SECRET).update(raw).digest('hex')}`;
  const webhook = (value: Record<string, unknown>) => {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'PN1' }, ...value } }] }] }));
    return { raw, sig: sign(raw) };
  };
  const leadId = (db.prepare('SELECT id FROM leads LIMIT 1').get() as { id: number }).id;
  return { db, wa, call, sent, webhook, sign, leadId };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const incoming = (id: string, from: string, body: string, name = 'Encik Satu') => ({
  contacts: [{ wa_id: from, profile: { name } }],
  messages: [{ id, from, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body } }],
});

describe('whatsapp business api', () => {
  it('verifies the webhook URL and rejects unsigned deliveries', async () => {
    const { wa, webhook } = setup();
    assert.equal(wa.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': '12345' }), '12345');
    assert.equal(wa.verify({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }), null);
    const { raw } = webhook(incoming('wamid.1', '60121111111', 'Hai'));
    assert.equal(await wa.handleWebhook(raw, undefined), 401);
    assert.equal(await wa.handleWebhook(raw, 'sha256=deadbeef'), 401);
  });

  it('records the message, drafts the agent reply, and sends a draft once approved', async () => {
    const { wa, call, sent, webhook, leadId } = setup();
    const { raw, sig } = webhook(incoming('wamid.1', '60121111111', 'Ada ribeye?'));
    assert.equal(await wa.handleWebhook(raw, sig), 200);
    assert.equal(await wa.handleWebhook(raw, sig), 200, 'retries are fine');
    await wait(60);
    const msgs = call<Paged<WaMessageRow>>('GET', '/wa/messages', undefined, { lead_id: leadId }).rows;
    assert.deepEqual(
      msgs.map((m) => [m.direction, m.status, m.author]),
      [
        ['out', 'draft', 'agent'],
        ['in', 'received', 'contact'],
      ],
      'one incoming message (no duplicate) and a draft reply',
    );
    assert.equal(sent.length, 0, 'nothing sent without approval');
    const out = await wa.send(leadId, 'Ada, tuan. RM89.90/kg.', { draftId: msgs[0].id });
    assert.deepEqual([out.status, out.wa_id, out.body], ['sent', 'wamid.out1', 'Ada, tuan. RM89.90/kg.']);
    assert.equal(sent[0].url, 'https://graph.facebook.com/v23.0/PN1/messages');
    assert.equal(sent[0].auth, 'Bearer tok');
    assert.deepEqual(sent[0].body.text, { preview_url: false, body: 'Ada, tuan. RM89.90/kg.' });
    assert.equal(sent[0].body.to, '60121111111');
    // Delivery reports move the status along.
    const st = webhook({ statuses: [{ id: 'wamid.out1', status: 'read' }] });
    await wa.handleWebhook(st.raw, st.sig);
    assert.equal(call<Paged<WaMessageRow>>('GET', '/wa/messages', undefined, { lead_id: leadId }).rows[0].status, 'read');
  });

  it('auto-sends when enabled and creates a lead for a new number', async () => {
    const { wa, call, sent, webhook } = setup({ autoSend: true });
    const { raw, sig } = webhook(incoming('wamid.9', '60139998888', 'Saya nak tanya harga', 'Kafe Baru'));
    await wa.handleWebhook(raw, sig);
    await wait(60);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].body.to, '60139998888');
    const c = call<Paged<WaContact>>('GET', '/wa/contacts', undefined, { search: 'Kafe Baru' }).rows[0];
    assert.equal(c.company, 'Kafe Baru');
    assert.equal(c.last_status, 'sent');
    assert.equal(c.last_author, 'agent');
  });

  it('refuses free text outside the 24-hour window', async () => {
    const { wa, call, leadId, sent } = setup();
    await assert.rejects(() => wa.send(leadId, 'Hai'), /window_closed/);
    const old = new Date(Date.now() - 30 * 3600 * 1000).toISOString();
    call('POST', '/wa/inbound', { lead_id: leadId, body: 'lama', at: old });
    await assert.rejects(() => wa.send(leadId, 'Hai'), /window_closed/);
    assert.equal(sent.length, 0);
  });

  it('marks a message failed when the Graph API refuses it', async () => {
    const db = openDb(':memory:');
    importCrm(db, { leads: [{ category: 'other', name: 'X', phone: '012-1111111' }] }, { today: TODAY });
    const fetchImpl = (async () => new Response(JSON.stringify({ error: { message: 'Recipient not on WhatsApp' } }), { status: 400 })) as unknown as typeof fetch;
    const wa = createWaLive({ db, today: () => TODAY, config: { token: 't', phoneNumberId: 'PN1', appSecret: SECRET, agent: false }, fetchImpl, log: () => {} });
    const { handle } = createRouter({ db, today: () => TODAY });
    const leadId = (db.prepare('SELECT id FROM leads LIMIT 1').get() as { id: number }).id;
    handle('POST', '/wa/inbound', {}, { lead_id: leadId, body: 'Hai', at: new Date().toISOString() });
    const m = await wa.send(leadId, 'Hai juga');
    assert.deepEqual([m.status, m.error], ['failed', 'Recipient not on WhatsApp']);
  });
});
