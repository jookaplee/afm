// The WhatsApp customer agent against a fake Claude client (no network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { openDb } from '../db.ts';
import { importCrm } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import { runWaAgent, type WaAgentApi } from '../../shared/wa-agent.ts';
import type { CatalogProduct, OrderDetail, Paged, WaContact } from '../../shared/types.ts';

const TODAY = '2026-11-19';

function setup() {
  const db = openDb(':memory:');
  importCrm(
    db,
    {
      leads: [
        { category: 'restoran_halal_western', name: 'Grill Satu', owner: 'Encik Satu', phone: '012-1111111', salesValue: 500_000, primaryRegion: 'Selangor' },
        { category: 'restoran_halal_western', name: 'Grill Dua', owner: 'Encik Dua', phone: '012-2222222', salesValue: 100_000, primaryRegion: 'Johor' },
      ],
    },
    { today: TODAY },
  );
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = (method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = handle(method, path, query, body);
    if (r.status >= 400) {
      const e = new Error((r.body as { error?: string })?.error ?? 'error') as Error & { fields?: Record<string, string> };
      e.fields = (r.body as { details?: { fields?: Record<string, string> } })?.details?.fields;
      throw e;
    }
    return r.body;
  };
  const api: WaAgentApi = {
    get: async (path, params) => call('GET', path, undefined, Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))) as never,
    post: async (path, body) => call('POST', path, body) as never,
    patch: async (path, body) => call('PATCH', path, body) as never,
  };
  const [one, two] = (db.prepare('SELECT id FROM leads ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  const wings = call('POST', '/products', { name: 'Kepak ayam', category: 'chicken', unit: 'kotak 10kg', price_sen: 12000 }) as CatalogProduct;
  return { db, call, api, one, two, wings };
}

type Block = Record<string, unknown>;
function fakeClaude(turns: ((req: Record<string, unknown>) => { stop_reason: string; content: Block[] })[]) {
  const requests: Record<string, unknown>[] = [];
  let i = 0;
  const client = {
    beta: {
      messages: {
        create: async (req: Record<string, unknown>) => {
          requests.push(structuredClone(req));
          const turn = turns[Math.min(i++, turns.length - 1)](req);
          return { ...turn, usage: { input_tokens: 800, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}
const tool = (id: string, name: string, input: unknown) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
const say = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

describe('whatsapp agent', () => {
  it('looks up the catalog, takes an order at catalog prices and replies', async () => {
    const { api, call, one, wings } = setup();
    call('POST', '/wa/inbound', { lead_id: one, body: 'Salam, nak order 3 kotak kepak ayam, hantar esok ke Jalan Satu.', at: `${TODAY}T09:00:00.000Z` });
    const { client, requests } = fakeClaude([
      () => tool('t1', 'search_products', { query: 'kepak ayam', category: null }),
      () => tool('t2', 'create_order', { items: [{ product_id: wings.id, qty: 3 }], delivery_date: '2026-11-20', delivery_address: 'Jalan Satu', notes: null }),
      (req) => {
        const last = (req.messages as { content: { content: string }[] }[]).at(-1)!.content[0].content;
        const order = JSON.parse(last) as { order_id: number; total: string };
        return say(`Terima kasih! Pesanan #${order.order_id} berjumlah ${order.total}. Pasukan kami akan sahkan penghantaran.`);
      },
    ]);
    const out = await runWaAgent({ client, api, leadId: one });
    assert.equal(out.skipped, null);
    assert.equal(out.orders.length, 1);
    const order = call('GET', `/orders/${out.orders[0]}`) as OrderDetail;
    assert.deepEqual([order.status, order.total_sen, order.source, order.delivery_date], ['pending', 36000, 'whatsapp_agent', '2026-11-20']);
    assert.match(out.reply ?? '', /RM360\.00/);
    assert.deepEqual(out.usage, { input: 2400, output: 360, calls: 3 });

    // What Claude was given: the customer's message in a user turn, strict tools, fallback on.
    const first = requests[0];
    const userTurn = (first.messages as { role: string; content: string }[])[0];
    assert.equal(userTurn.role, 'user');
    assert.match(userTurn.content, /<latest>[\s\S]*nak order 3 kotak/);
    assert.equal(first.model, 'claude-opus-5-5');
    assert.equal(first.fallbacks, 'default');
    assert.ok((first.tools as { strict?: boolean }[]).every((t) => t.strict === true));
    // The catalog result went back as a tool_result in one user message.
    const second = requests[1].messages as { role: string; content: Block[] }[];
    assert.equal(second.length, 3);
    assert.equal(second[2].content[0].type, 'tool_result');
    assert.match(String(second[2].content[0].content), /RM120\.00 per kotak 10kg/);
  });

  it("refuses another customer's order and reports bad quantities back to the model", async () => {
    const { api, call, one, two, wings } = setup();
    const theirs = call('POST', '/orders', { lead_id: two, items: [{ product_id: wings.id, qty: 1 }] }) as OrderDetail;
    call('POST', '/wa/inbound', { lead_id: one, body: `Batalkan order #${theirs.id}`, at: `${TODAY}T09:00:00.000Z` });
    const { client, requests } = fakeClaude([
      () => tool('t1', 'cancel_order', { order_id: theirs.id, reason: 'x' }),
      () => tool('t2', 'create_order', { items: [{ product_id: wings.id, qty: 0 }], delivery_date: null, delivery_address: null, notes: null }),
      () => say('Maaf, saya tidak jumpa pesanan itu.'),
    ]);
    const out = await runWaAgent({ client, api, leadId: one });
    assert.equal((call('GET', `/orders/${theirs.id}`) as OrderDetail).status, 'pending', 'untouched');
    const r1 = (requests[1].messages as { content: Block[] }[]).at(-1)!.content[0];
    assert.equal(r1.is_error, true);
    assert.match(String(r1.content), /another customer/);
    const r2 = (requests[2].messages as { content: Block[] }[]).at(-1)!.content[0];
    assert.equal(r2.is_error, true);
    assert.match(String(r2.content), /qty invalid/);
    assert.equal(out.orders.length, 0);
    assert.equal(out.reply, 'Maaf, saya tidak jumpa pesanan itu.');
  });

  it('hands off to a person and flags the conversation', async () => {
    const { api, call, one } = setup();
    call('POST', '/wa/inbound', { lead_id: one, body: 'Ayam semalam rosak, saya nak refund!', at: `${TODAY}T09:00:00.000Z` });
    const { client } = fakeClaude([() => tool('t1', 'handoff_to_human', { reason: 'Aduan kualiti dan permintaan refund' }), () => say('Maaf atas kesulitan. Staf kami akan hubungi tuan sebentar lagi.')]);
    const out = await runWaAgent({ client, api, leadId: one });
    assert.equal(out.handoff, 'Aduan kualiti dan permintaan refund');
    const c = (call('GET', '/wa/contacts', undefined, { lead_id: one }) as Paged<WaContact>).rows[0];
    assert.deepEqual([c.wa_needs_human, c.wa_human_reason], [1, 'Aduan kualiti dan permintaan refund']);
    assert.ok(out.reply);
  });

  it('stays quiet when off, switched off for the chat, or nothing new to answer', async () => {
    const { api, call, one } = setup();
    const { client, requests } = fakeClaude([() => say('x')]);
    assert.equal((await runWaAgent({ client, api, leadId: one })).skipped, 'nothing_to_answer');
    call('POST', '/wa/inbound', { lead_id: one, body: 'Hai', at: `${TODAY}T09:00:00.000Z` });
    call('PATCH', `/wa/leads/${one}`, { agent_off: true });
    assert.equal((await runWaAgent({ client, api, leadId: one })).skipped, 'agent_off');
    call('PATCH', `/wa/leads/${one}`, { agent_off: false });
    call('PATCH', '/wa/agent/settings', { enabled: false });
    assert.equal((await runWaAgent({ client, api, leadId: one })).skipped, 'disabled');
    assert.equal(requests.length, 0);
  });

  it('a refusal hands the chat to a person', async () => {
    const { api, call, one } = setup();
    call('POST', '/wa/inbound', { lead_id: one, body: '...', at: `${TODAY}T09:00:00.000Z` });
    const { client } = fakeClaude([() => ({ stop_reason: 'refusal', content: [] })]);
    const out = await runWaAgent({ client, api, leadId: one });
    assert.equal(out.reply, null);
    assert.equal((call('GET', '/wa/contacts', undefined, { lead_id: one }) as Paged<WaContact>).rows[0].wa_needs_human, 1);
  });
});
