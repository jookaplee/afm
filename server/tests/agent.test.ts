// The AI lead agent: planning, saving results as findings, deciding on them,
// and a full cycle against a fake Claude client (no network, synthetic data).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import { openDb } from '../db.ts';
import { importCrm } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import { cleanValue, formatPhone, nameKey, normPhone, normalizeSettings, valueKey, type AgentPlan, type AgentRunInput, type AgentRunSummary } from '../../shared/agent.ts';
import { runAgentCycle, toCandidates, type AgentApi } from '../../shared/agent-runner.ts';
import type { Account, AgentFindingRow, AgentSummary, Paged } from '../../shared/types.ts';

const TODAY = '2026-11-19';
const NOW = `${TODAY}T10:00:00.000Z`;
const rec = (name: string, over: Record<string, unknown> = {}) => ({
  category: 'restoran_halal_western',
  name,
  salesValue: 150_000,
  primaryRegion: 'Johor',
  owner: `Pemilik ${name}`,
  phone: '012-0000001',
  ratingValue: 4.4,
  website: `https://${name.toLowerCase().replace(/\s+/g, '')}.example`,
  ...over,
});

function setup() {
  const db = openDb(':memory:');
  importCrm(
    db,
    {
      leads: [
        rec('Besar Steakhouse', { salesValue: 2_500_000, phone: '03-11111111', primaryRegion: 'Kuala Lumpur' }),
        rec('Sederhana Grill', { salesValue: 450_000, phone: '012-2222222' }),
        rec('Kecil Burger', { salesValue: 50_000, phone: '013-3333333' }),
      ],
    },
    { today: TODAY },
  );
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = handle(method, path, query, body);
    assert.ok(r.status < 400, `${method} ${path} -> ${r.status} ${JSON.stringify(r.body)}`);
    return r.body as T;
  };
  const account = (name: string) => (db.prepare('SELECT * FROM accounts WHERE name = ?').get(name) as unknown as Account);
  return { db, handle, call, account };
}

const run = (results: AgentRunInput['results'], candidates: AgentRunInput['candidates'] = []): AgentRunInput => ({
  kind: 'cycle',
  started_at: NOW,
  finished_at: NOW,
  model: 'claude-opus-5-5',
  calls: results.length + (candidates.length ? 1 : 0),
  searches: 3,
  input_tokens: 1000,
  output_tokens: 200,
  error: null,
  results,
  candidates,
});

describe('agent values', () => {
  it('normalises Malaysian phone numbers and links', () => {
    assert.equal(normPhone('+60 12-345 6789'), '0123456789');
    assert.equal(normPhone('03-2201 9055'), '0322019055');
    assert.equal(normPhone('1300-88-1234'), '1300881234');
    assert.equal(normPhone('12345'), null);
    assert.equal(formatPhone('0123456789'), '012-3456789');
    assert.equal(formatPhone('0322019055'), '03-22019055');
    assert.equal(cleanValue('phone', '+6012 345 6789'), '012-3456789');
    assert.equal(cleanValue('phone', 'call us'), null);
    assert.equal(cleanValue('website', 'javascript:alert(1)'), null);
    assert.equal(cleanValue('website', 'contoh.example/menu'), 'https://contoh.example/menu');
    assert.equal(cleanValue('email', 'not an email'), null);
    assert.equal(valueKey('website', 'https://www.Contoh.example/'), valueKey('website', 'http://contoh.example'));
    assert.equal(valueKey('phone', '012-3456789'), valueKey('phone', '+60123456789'));
    assert.equal(nameKey('Restoran Besar Steakhouse Sdn Bhd'), nameKey('besar steakhouse'));
  });

  it('keeps settings within bounds', () => {
    const s = normalizeSettings({ model: 'gpt', perCycle: 999, intervalMin: 1, autopilot: 'yes' });
    assert.equal(s.model, 'claude-opus-5-5');
    assert.equal(s.perCycle, 20);
    assert.equal(s.intervalMin, 5);
    assert.equal(s.autopilot, true);
  });
});

describe('agent store', () => {
  it('plans the biggest unchecked accounts first, within the daily limit', () => {
    const { call } = setup();
    call('PATCH', '/agent/settings', { perCycle: 2, dailyCalls: 2, discoverPerCycle: 1 });
    const plan = call<AgentPlan>('GET', '/agent/plan');
    assert.deepEqual(plan.accounts.map((a) => a.name), ['Besar Steakhouse', 'Sederhana Grill']);
    // Both calls go to verification, none left for discovery.
    assert.equal(plan.discover, null);
    call('PATCH', '/agent/settings', { dailyCalls: 10 });
    const next = call<AgentPlan>('GET', '/agent/plan');
    assert.ok(next.discover);
    assert.ok(next.discover.exclude.length >= 1);
  });

  it('turns results into findings, fills empty fields and never repeats itself', () => {
    const { call, account, db } = setup();
    const besar = account('Besar Steakhouse');
    const kecil = account('Kecil Burger');
    const result = {
      account_id: besar.id,
      found: true,
      operating: 'yes' as const,
      operating_source: null,
      fields: {
        phone: { value: '03-9999 9999', source: 'https://maps.example/besar', confidence: 'high' as const },
        address: { value: 'Lot 1, Jalan Contoh, 50000 Kuala Lumpur', source: 'https://maps.example/besar', confidence: 'high' as const },
        website: { value: 'besarsteakhouse.example', source: 'https://besarsteakhouse.example', confidence: 'high' as const },
        contact_name: { value: 'Encik Baharu', source: 'https://facebook.example/besar', confidence: 'medium' as const },
        email: { value: 'not-an-email', source: 'https://x.example', confidence: 'high' as const },
      },
      summary: 'Restoran stik di KL.',
      sources: ['https://maps.example/besar', 'javascript:bad'],
    };
    const closed = {
      account_id: kecil.id,
      found: true,
      operating: 'no' as const,
      operating_source: 'https://maps.example/kecil',
      fields: {},
      summary: 'Sudah tutup.',
      sources: [],
    };
    const s = call<AgentRunSummary>('POST', '/agent/runs', run([result, closed]));
    // phone (changed) + contact_name (changed) + closed = 3 to review; address filled; website confirmed.
    assert.deepEqual([s.checked, s.findings, s.auto, s.confirmed], [2, 3, 1, 1]);
    const after = account('Besar Steakhouse');
    assert.equal(after.address, 'Lot 1, Jalan Contoh, 50000 Kuala Lumpur');
    assert.equal(after.phone, '03-11111111'); // not overwritten without approval
    assert.equal(after.verify_status, 'changed');
    assert.equal(account('Kecil Burger').verify_status, 'closed');

    // Same results again: nothing new to review.
    const again = call<AgentRunSummary>('POST', '/agent/runs', run([result, closed]));
    assert.equal(again.findings, 0);
    const pending = call<Paged<AgentFindingRow>>('GET', '/agent/findings', undefined, { status: 'pending' });
    assert.equal(pending.total, 3);
    assert.ok(pending.rows.every((f) => Array.isArray(f.sources)));

    // Accepting the phone updates the account and its lead; rejecting the name is remembered.
    const phone = pending.rows.find((f) => f.field === 'phone')!;
    const name = pending.rows.find((f) => f.field === 'contact_name')!;
    call('PATCH', `/agent/findings/${phone.id}`, { status: 'accepted', at: NOW });
    call('PATCH', `/agent/findings/${name.id}`, { status: 'rejected', at: NOW });
    assert.equal(account('Besar Steakhouse').phone, '03-99999999');
    const lead = db.prepare('SELECT phone FROM leads WHERE account_id = ?').get(besar.id) as { phone: string };
    assert.equal(lead.phone, '03-99999999');
    assert.equal(account('Besar Steakhouse').verify_status, 'ok');
    const third = call<AgentRunSummary>('POST', '/agent/runs', run([result]));
    assert.equal(third.findings, 0, 'a rejected value is not proposed again');

    // Accepting "closed" disqualifies the account's open leads.
    const closedFinding = call<Paged<AgentFindingRow>>('GET', '/agent/findings', undefined, { kind: 'closed' }).rows[0];
    call('POST', '/agent/findings/decide', { ids: [closedFinding.id], status: 'accepted', at: NOW });
    const leads = db.prepare('SELECT status FROM leads WHERE account_id = ?').all(kecil.id) as { status: string }[];
    assert.ok(leads.length > 0 && leads.every((l) => l.status === 'disqualified'));

    const sum = call<AgentSummary>('GET', '/agent/summary');
    assert.equal(sum.accounts.verified, 2);
    assert.equal(sum.today.calls, 5);
    assert.equal(sum.findings.pending, 0);
  });

  it('keeps new leads that are not already in the CRM and adds them on approval', () => {
    const { call, db } = setup();
    const lead = (name: string, phone: string | null) => ({
      name,
      legal_name: null,
      category: 'restoran_halal_western' as const,
      state: 'Johor',
      area: 'Johor Bahru',
      address: 'Jalan Baru, Johor Bahru',
      phone,
      contact_name: 'Puan Baru',
      email: 'hello@baru.example',
      website: null,
      facebook: 'https://facebook.example/baru',
      instagram: null,
      tiktok: null,
      rating: 4.6,
      size: 'medium' as const,
      why: 'Restoran sibuk.',
      confidence: 'high' as const,
      sources: ['https://maps.example/baru'],
    });
    const s = call<AgentRunSummary>(
      'POST',
      '/agent/runs',
      run([], [lead('Restoran Besar Steakhouse', null), lead('Kedai Lain', '012-2222222'), lead('Grill Baru JB', '017-5555555')]),
    );
    assert.deepEqual([s.new_leads, s.duplicates], [1, 2]);
    const f = call<Paged<AgentFindingRow>>('GET', '/agent/findings', undefined, { kind: 'new_lead' }).rows[0];
    assert.equal(f.payload?.name, 'Grill Baru JB');
    call('PATCH', `/agent/findings/${f.id}`, { status: 'accepted', at: NOW });
    const a = db.prepare('SELECT * FROM accounts WHERE name = ?').get('Grill Baru JB') as unknown as Account;
    assert.equal(a.region, 'southern');
    assert.equal(a.segment, 'midmarket');
    assert.equal(a.address, 'Jalan Baru, Johor Bahru');
    assert.match(a.source ?? '', /^Ejen AI/);
    const l = db.prepare('SELECT * FROM leads WHERE account_id = ?').get(a.id) as { name: string; phone: string; status: string };
    assert.deepEqual([l.name, l.phone, l.status], ['Puan Baru', '017-5555555', 'new']);
    // Found again later: a duplicate now.
    assert.equal(call<AgentRunSummary>('POST', '/agent/runs', run([], [lead('Grill Baru JB', '017-5555555')])).duplicates, 1);
  });
});

// ---------- A full cycle with a fake Claude ----------

type Block = Record<string, unknown>;
function fakeClaude(script: (req: Record<string, unknown>) => { content: Block[]; stop_reason: string; searches?: number }) {
  const requests: Record<string, unknown>[] = [];
  const client = {
    beta: {
      messages: {
        create: async (req: Record<string, unknown>) => {
          requests.push(req);
          const r = script(req);
          return {
            content: r.content,
            stop_reason: r.stop_reason,
            usage: { input_tokens: 500, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: r.searches ?? 2, web_fetch_requests: 0 } },
          };
        },
      },
    },
  } as unknown as Anthropic;
  return { client, requests };
}

describe('agent cycle', () => {
  it('verifies, resumes paused turns, discovers and saves through the API', async () => {
    const { call, account } = setup();
    call('PATCH', '/agent/settings', { perCycle: 1, discoverPerCycle: 2 });
    const besar = account('Besar Steakhouse');
    let paused = false;
    const { client, requests } = fakeClaude((req) => {
      const tools = req.tools as { name: string }[];
      if (tools.some((t) => t.name === 'report_verification')) {
        if (!paused) {
          paused = true;
          return { stop_reason: 'pause_turn', content: [{ type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://maps.example/besar', title: 'x', encrypted_content: '', page_age: null }] }] };
        }
        return {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'report_verification',
              input: {
                found: true,
                operating: 'yes',
                operating_source: null,
                fields: {
                  phone: { value: '+60 3-1111 1111', source: 'https://maps.example/besar', confidence: 'high' },
                  contact_name: null,
                  address: { value: 'Jalan Ampang, KL', source: 'https://maps.example/besar', confidence: 'medium' },
                  email: null,
                  website: null,
                  facebook: null,
                  instagram: null,
                  tiktok: null,
                  legal_name: null,
                },
                summary: 'Masih beroperasi.',
                sources: [],
              },
            },
          ],
        };
      }
      return {
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 't2',
            name: 'report_new_leads',
            input: {
              leads: [
                { name: 'Steak Baru', legal_name: null, state: 'Selangor', area: 'Shah Alam', address: null, phone: '019-8888888', contact_name: null, email: null, website: null, facebook: null, instagram: null, tiktok: null, rating: 4.5, size: null, why: 'Baru dibuka.', confidence: 'medium', sources: ['https://maps.example/baru'] },
                { name: 'No Source Cafe', legal_name: null, state: null, area: null, address: null, phone: '019-7777777', contact_name: null, email: null, website: null, facebook: null, instagram: null, tiktok: null, rating: null, size: null, why: '', confidence: 'low', sources: [] },
              ],
            },
          },
        ],
      };
    });
    const api: AgentApi = {
      get: async (path, params) => call('GET', path, undefined, Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))),
      post: async (path, body) => call('POST', path, body),
    };
    const out = await runAgentCycle({ client, api, today: TODAY, now: () => NOW });
    assert.equal(out.error, null);
    assert.ok(out.summary);
    // phone confirmed (same number, other format), address filled? medium -> to review.
    assert.deepEqual([out.summary.checked, out.summary.confirmed, out.summary.findings, out.summary.new_leads], [1, 1, 1, 1]);
    assert.equal(account('Besar Steakhouse').verified_at, NOW);
    assert.equal(besar.verified_at, null);
    // First request paused and was resent with the assistant turn appended.
    const verify = requests.filter((r) => (r.tools as { name: string }[]).some((t) => t.name === 'report_verification'));
    assert.equal(verify.length, 2);
    assert.equal((verify[1].messages as unknown[]).length, 2);
    const first = requests[0];
    assert.equal(first.model, 'claude-opus-5-5');
    assert.deepEqual(first.fallbacks, 'default');
    assert.deepEqual(first.output_config, { effort: 'medium' });
    assert.ok((first.tools as { type?: string }[]).some((t) => t.type === 'web_search_20260209'));
    const sum = call<AgentSummary>('GET', '/agent/summary');
    assert.equal(sum.today.calls, 2);
    assert.equal(sum.today.searches, 6);
  });

  it('records an account that fails and keeps going', async () => {
    const { call } = setup();
    call('PATCH', '/agent/settings', { perCycle: 2, discoverPerCycle: 0, model: 'claude-haiku-5-5' });
    const { client, requests } = fakeClaude(() => ({ stop_reason: 'refusal', content: [] }));
    const api: AgentApi = {
      get: async (path, params) => call('GET', path, undefined, Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))),
      post: async (path, body) => call('POST', path, body),
    };
    const out = await runAgentCycle({ client, api, today: TODAY, now: () => NOW });
    assert.equal(out.fatal, false);
    assert.match(out.error ?? '', /declined/);
    assert.equal(out.summary?.checked, 0);
    // Haiku: basic web search tool, no server-side fallback.
    assert.ok((requests[0].tools as { type?: string }[]).some((t) => t.type === 'web_search_20250305'));
    assert.equal(requests[0].fallbacks, undefined);
    const runs = call<{ error: string | null; calls: number }[]>('GET', '/agent/runs');
    assert.equal(runs[0].calls, 2);
    assert.match(runs[0].error ?? '', /declined/);
  });

  it('drops leads without a source or a way to reach them', () => {
    const leads = toCandidates(
      { category: 'penjual_perap_online', region: 'northern', exclude: [] },
      { leads: [{ name: 'Ok', sources: ['https://x.example'], phone: '0123456789' }, { name: 'No contact', sources: ['https://x.example'] }, { name: '', sources: ['https://x.example'], phone: '0123456789' }] },
    );
    assert.deepEqual(leads.map((l) => [l.name, l.phone, l.category]), [['Ok', '012-3456789', 'penjual_perap_online']]);
  });
});
