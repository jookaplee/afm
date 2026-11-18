import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../db.ts';
import { seed } from '../seed.ts';
import { createApp } from '../app.ts';
import { SEGMENTS } from '../../shared/constants.ts';
import type { DealRow, LeadRow, MarketingResponse, OverviewResponse, Paged, SalesResponse } from '../../shared/types.ts';

const TODAY = '2026-06-15';
let server: Server;
let base = '';

async function call<T = unknown>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
}
const get = <T>(path: string) => call<T>('GET', path);

const close = (a: number, b: number, eps = 2) => Math.abs(a - b) <= eps;

before(async () => {
  const db = openDb(':memory:');
  seed(db, { today: TODAY });
  const app = createApp({ db, today: () => TODAY, allowReset: false });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

describe('seed', () => {
  it('is deterministic for the same anchor date', () => {
    const a = seed(openDb(':memory:'), { today: TODAY });
    const b = seed(openDb(':memory:'), { today: TODAY });
    assert.deepEqual(a, b);
    assert.ok(a.deals > 300 && a.leads > 1000);
  });
});

describe('analytics', () => {
  it('overview: series add up to the headline numbers and the funnel narrows', async () => {
    const { status, body } = await get<OverviewResponse>('/analytics/overview');
    assert.equal(status, 200);
    assert.equal(body.period.from, '2026-01-01');
    assert.equal(body.period.to, TODAY);
    const seriesTotal = body.revenueSeries.reduce((s, r) => s + r.revenue, 0);
    assert.equal(seriesTotal, body.kpis.revenue.value);
    const bySource = body.revenueBySource.reduce((s, r) => s + r.marketing + r.sales + r.partner, 0);
    assert.equal(bySource, body.kpis.revenue.value);
    for (let i = 1; i < body.funnel.length; i++) assert.ok(body.funnel[i].count <= body.funnel[i - 1].count, 'funnel must not widen');
    assert.equal(body.funnel[0].count, body.kpis.leads.value);
    assert.ok(body.kpis.target && body.kpis.target > 0);
  });

  it('segments partition revenue', async () => {
    const all = (await get<OverviewResponse>('/analytics/overview')).body.kpis.revenue.value ?? 0;
    let parts = 0;
    for (const s of SEGMENTS) parts += (await get<OverviewResponse>(`/analytics/overview?segment=${s}`)).body.kpis.revenue.value ?? 0;
    assert.equal(parts, all);
  });

  it('uses weekly buckets for short ranges and compares with the preceding period', async () => {
    const { body } = await get<OverviewResponse>('/analytics/overview?from=2026-05-01&to=2026-05-31');
    assert.equal(body.period.granularity, 'week');
    assert.equal(body.period.prevTo, '2026-04-30');
    assert.equal(body.period.prevFrom, '2026-03-31');
  });

  it('marketing: channel rows add up and spend allocation is consistent across segments', async () => {
    const { body } = await get<MarketingResponse>('/analytics/marketing');
    const leads = body.channels.reduce((s, c) => s + c.leads, 0);
    assert.equal(leads, body.kpis.leads.value);
    const spend = body.channels.reduce((s, c) => s + c.spend, 0);
    assert.ok(close(spend, body.kpis.spend.value ?? 0, 10));
    let segSpend = 0;
    for (const s of SEGMENTS) segSpend += (await get<MarketingResponse>(`/analytics/marketing?segment=${s}`)).body.kpis.spend.value ?? 0;
    assert.ok(close(segSpend, body.kpis.spend.value ?? 0, 10), `segment spend ${segSpend} vs ${body.kpis.spend.value}`);
  });

  it('sales: leaderboard attainment matches won ÷ quota', async () => {
    const { body } = await get<SalesResponse>('/analytics/sales');
    assert.equal(body.reps.length, 10);
    for (const r of body.reps) {
      assert.ok(r.quota > 0);
      assert.ok(close((r.attainment ?? 0) * r.quota, r.won, 1));
    }
    const won = body.reps.reduce((s, r) => s + r.won, 0);
    assert.equal(won, body.kpis.revenue.value);
    const f = body.forecast;
    assert.equal(f.quarter, 'Q2 2026');
    assert.ok(f.projected >= f.won);
  });

  it('hides targets when a region filter is active', async () => {
    const { body } = await get<OverviewResponse>('/analytics/overview?region=sumatra');
    assert.equal(body.targetAvailable, false);
    assert.equal(body.kpis.target, null);
  });

  it('rejects invalid filters', async () => {
    assert.equal((await get('/analytics/overview?from=2026-13-01')).status, 400);
    assert.equal((await get('/analytics/overview?from=2026-06-01&to=2026-05-01')).status, 400);
    assert.equal((await get('/analytics/sales?segment=giant')).status, 400);
  });
});

describe('deals CRUD', () => {
  it('validates, creates, moves through stages and deletes', async () => {
    const bad = await call<{ details: { fields: Record<string, string> } }>('POST', '/deals', { name: 'x' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.details.fields.account_id, 'required');

    const created = await call<DealRow>('POST', '/deals', {
      name: 'Uji – Platform',
      account_id: 1,
      owner_id: 1,
      stage: 'prospecting',
      amount: 250_000_000,
      product: 'platform',
      type: 'new_business',
      source: 'sales',
      expected_close: '2026-09-30',
    });
    assert.equal(created.status, 201);
    const id = created.body.id;
    assert.equal(created.body.created_at, TODAY);
    assert.equal(created.body.closed_at, null);

    const noReason = await call('PATCH', `/deals/${id}`, { stage: 'lost' });
    assert.equal(noReason.status, 400);

    const won = await call<DealRow>('PATCH', `/deals/${id}`, { stage: 'won' });
    assert.equal(won.body.stage, 'won');
    assert.equal(won.body.closed_at, TODAY);

    const reopened = await call<DealRow>('PATCH', `/deals/${id}`, { stage: 'proposal' });
    assert.equal(reopened.body.closed_at, null);

    const list = await get<Paged<DealRow>>(`/deals?search=${encodeURIComponent('Uji – Platform')}`);
    assert.equal(list.body.total, 1);

    assert.equal((await call('DELETE', `/deals/${id}`)).status, 204);
    assert.equal((await get(`/deals/${id}`)).status, 404);
  });
});

describe('leads lifecycle', () => {
  it('qualifies and converts a lead into an account + deal', async () => {
    const lead = await call<LeadRow>('POST', '/leads', {
      name: 'Budi Uji',
      company: 'PT Uji Coba Sejahtera',
      industry: 'logistics',
      segment: 'midmarket',
      region: 'java',
      channel: 'linkedin',
    });
    assert.equal(lead.status, 201);
    assert.equal(lead.body.status, 'new');

    const mql = await call<LeadRow>('PATCH', `/leads/${lead.body.id}`, { status: 'mql' });
    assert.equal(mql.body.mql_at, TODAY);

    const conv = await call<{ lead: LeadRow; deal: DealRow }>('POST', `/leads/${lead.body.id}/convert`, {
      owner_id: 4,
      amount: 300_000_000,
      product: 'analytics',
      expected_close: '2026-10-01',
    });
    assert.equal(conv.status, 201);
    assert.equal(conv.body.lead.status, 'converted');
    assert.equal(conv.body.deal.source, 'marketing');
    assert.equal(conv.body.deal.channel, 'linkedin');
    assert.equal(conv.body.deal.account_name, 'PT Uji Coba Sejahtera');
    assert.ok(conv.body.lead.sql_at);

    const again = await call('POST', `/leads/${lead.body.id}/convert`, { owner_id: 4, amount: 1, product: 'hr', expected_close: '2026-10-01' });
    assert.equal(again.status, 409);
  });
});

describe('campaigns & accounts', () => {
  it('rejects a campaign that ends before it starts', async () => {
    const res = await call<{ details: { fields: Record<string, string> } }>('POST', '/campaigns', {
      name: 'Salah tanggal',
      channel: 'email',
      start_date: '2026-07-01',
      end_date: '2026-06-01',
      budget: 1_000_000,
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.details.fields.end_date, 'before_start');
  });

  it('derives campaign status from dates', async () => {
    const res = await call<{ status: string }>('POST', '/campaigns', {
      name: 'Webinar Juli',
      channel: 'events',
      start_date: '2026-07-01',
      end_date: '2026-07-31',
      budget: 50_000_000,
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'planned');
  });

  it('accepts explicit nulls for optional fields, as the forms send them', async () => {
    const camp = await call<{ id: number; status: string; spend: number }>('POST', '/campaigns', {
      name: 'Nurturing tanpa status',
      channel: 'email',
      start_date: '2026-06-01',
      end_date: '2026-06-30',
      budget: 10_000_000,
      spend: null,
      status: null,
    });
    assert.equal(camp.status, 201);
    assert.equal(camp.body.status, 'active');
    assert.equal(camp.body.spend, 0);
    const edited = await call<{ status: string }>('PATCH', `/campaigns/${camp.body.id}`, { end_date: '2026-06-10', status: null });
    assert.equal(edited.body.status, 'completed');

    const acc = await call<{ id: number; tier: string; employees: number }>('POST', '/accounts', {
      name: 'PT Null Aman',
      industry: 'retail',
      segment: 'smb',
      region: 'bali_nusra',
      employees: null,
      website: null,
      owner_id: null,
      tier: null,
    });
    assert.equal(acc.status, 201);
    assert.equal(acc.body.tier, 'tier3');
    assert.equal(acc.body.employees, 0);

    const lead = await call<LeadRow>('POST', '/leads', {
      name: 'Sari Null',
      company: 'PT Null Aman',
      industry: 'retail',
      segment: 'smb',
      region: 'bali_nusra',
      channel: 'content',
      email: null,
      title: null,
      campaign_id: null,
      owner_id: null,
      score: null,
    });
    assert.equal(lead.status, 201);
    assert.equal(lead.body.score, 20);
    const conv = await call<{ deal: DealRow }>('POST', `/leads/${lead.body.id}/convert`, {
      deal_name: null,
      owner_id: 8,
      amount: 40_000_000,
      product: 'hr',
      expected_close: '2026-08-01',
    });
    assert.equal(conv.status, 201);
    assert.match(conv.body.deal.name, /Null Aman/);
  });

  it('refuses to delete an account that still has deals', async () => {
    const withDeals = await get<Paged<{ id: number }>>('/accounts?customers=true&pageSize=1');
    const id = withDeals.body.rows[0].id;
    assert.equal((await call('DELETE', `/accounts/${id}`)).status, 409);
  });

  it('keeps reset disabled when not allowed', async () => {
    assert.equal((await call('POST', '/admin/reset', {})).status, 403);
  });
});
