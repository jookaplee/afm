// Importing a prospect list as the starting database (synthetic fixture data).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.ts';
import { importCrm, parseCrmInput, regionOf, safeUrl, scoreOf, tierOf } from '../import-crm.ts';
import { createRouter } from '../routes.ts';
import type { AccountRow, LeadRow, Paged, RepRow } from '../../shared/types.ts';

const TODAY = '2026-11-19';
const record = (over: Record<string, unknown>) => ({
  category: 'restoran_halal_western',
  name: 'Contoh Grill',
  salesValue: 150_000,
  company: 'Contoh Grill Enterprise',
  region: 'Johor, Melaka',
  primaryRegion: 'Johor',
  owner: 'Puan Contoh',
  phone: '012-0000001',
  ratingValue: 4.4,
  website: 'https://contoh.example',
  facebook: 'https://facebook.com/contoh',
  instagram: 'javascript:alert(1)',
  source: 'fixture.xlsx',
  ...over,
});
const fixture = [
  record({ name: 'Besar Steakhouse', salesValue: 2_500_000, primaryRegion: 'Kuala Lumpur', phone: '03-1111111' }),
  record({ name: 'Sederhana Cafe', category: 'kafe_premium_steak_bbq', salesValue: 450_000, primaryRegion: 'Pulau Pinang', phone: '04-2222222' }),
  record({ name: 'Kecil Perap', category: 'penjual_perap_online', salesValue: 80_000, primaryRegion: 'Kuantan', phone: '09-3333333' }),
  // Same business listed again under another category: merged.
  record({ name: 'Besar Steakhouse', category: 'kafe_premium_steak_bbq', salesValue: 2_500_000, primaryRegion: 'Selangor', phone: '03-1111111' }),
  record({ name: '   ', phone: '000' }),
  record({ name: 'Tanpa Kategori', category: 'hotel', primaryRegion: 'Seluruh Semenanjung', phone: '05-4444444' }),
];
const html = `<!doctype html><html><body><script id="category-meta" type="application/json">{"restoran_halal_western":{"label":"Restoran"}}</script>
<script id="lead-data" type="application/json">${JSON.stringify(fixture)}</script><script>var app = 1;</script></body></html>`;

describe('prospect list import', () => {
  it('parses the CRM HTML export and JSON alike', () => {
    assert.equal(parseCrmInput(html).leads.length, fixture.length);
    assert.equal(parseCrmInput(JSON.stringify(fixture)).leads.length, fixture.length);
    assert.equal(parseCrmInput(JSON.stringify({ leads: fixture })).leads.length, fixture.length);
    assert.throws(() => parseCrmInput('<html><body>nothing</body></html>'), /lead-data/);
  });

  it('maps sales to tiers, places to regions and keeps only web links', () => {
    assert.deepEqual([tierOf(1_000_000), tierOf(999_999), tierOf(300_000), tierOf(299_999)], ['enterprise', 'midmarket', 'midmarket', 'smb']);
    assert.equal(regionOf('N. Sembilan'), 'southern');
    assert.equal(regionOf('Perlis'), 'northern');
    assert.equal(regionOf('Terengganu'), 'east_coast');
    assert.equal(regionOf('KL'), 'klang_valley');
    assert.equal(regionOf('Bangsar'), 'klang_valley');
    assert.equal(regionOf('Seluruh Semenanjung'), 'klang_valley');
    assert.equal(regionOf('', 'Kota Kinabalu, Sabah'), 'sabah');
    assert.equal(safeUrl('javascript:alert(1)'), null);
    assert.equal(safeUrl('https://ok.example/x'), 'https://ok.example/x');
    assert.ok(scoreOf(record({ salesValue: 2_000_000, ratingValue: 5 })) > scoreOf(record({ salesValue: 50_000, ratingValue: 4 })));
  });

  it('replaces the database with accounts, leads and the default team', () => {
    const db = openDb(':memory:');
    const summary = importCrm(db, parseCrmInput(html), { today: TODAY });
    assert.deepEqual(summary, { reps: 3, accounts: 4, leads: 4, merged: 1, skipped: 1 });
    const { handle } = createRouter({ db, today: () => TODAY });
    const accounts = handle('GET', '/accounts', { pageSize: '10', sort: 'name', dir: 'asc' }, undefined).body as Paged<AccountRow>;
    const big = accounts.rows.find((a) => a.name === 'Besar Steakhouse')!;
    assert.equal(big.segment, 'enterprise');
    assert.equal(big.region, 'klang_valley');
    assert.equal(big.legal_name, 'Contoh Grill Enterprise');
    assert.equal(big.phone, '03-1111111');
    assert.equal(big.sales_estimate, 2_500_000);
    assert.deepEqual(JSON.parse(big.socials!), { facebook: 'https://facebook.com/contoh' });
    // A category the app did not know becomes a category of its own.
    assert.equal(accounts.rows.find((a) => a.name === 'Tanpa Kategori')!.industry, 'hotel');
    const leads = handle('GET', '/leads', { pageSize: '10' }, undefined).body as Paged<LeadRow>;
    assert.equal(leads.total, 4);
    assert.ok(leads.rows.every((l) => l.status === 'new' && l.channel === 'prospect_list' && l.account_id && l.created_at === TODAY));
    const deals = handle('GET', '/deals', {}, undefined).body as Paged<unknown>;
    assert.equal(deals.total, 0);
  });
});

describe('sales team', () => {
  it('adds reps, sets monthly quotas and validates the team', () => {
    const db = openDb(':memory:');
    importCrm(db, parseCrmInput(html), { today: TODAY });
    const { handle } = createRouter({ db, today: () => TODAY });
    const reps = handle('GET', '/reps', {}, undefined).body as RepRow[];
    assert.deepEqual(reps.map((r) => r.name).sort(), ['Pengurus Jualan', 'Sales 1', 'Sales 2']);
    const created = handle('POST', '/reps', {}, { name: 'Sales 3', role: 'AE', team: 'smb', monthly_quota: 50_000 });
    assert.equal(created.status, 201);
    const rep = created.body as RepRow;
    assert.equal(rep.monthly_quota, 50_000);
    // Quotas run from this month to the end of next year.
    const months = db.prepare('SELECT month FROM quotas WHERE rep_id = ? ORDER BY month').all(rep.id) as { month: string }[];
    assert.equal(months[0].month, '2026-11');
    assert.equal(months[months.length - 1].month, '2027-12');
    const updated = handle('PATCH', `/reps/${rep.id}`, {}, { monthly_quota: 0, active: 0 }).body as RepRow;
    assert.equal(updated.monthly_quota, null);
    assert.equal(updated.active, 0);
    assert.equal(handle('POST', '/reps', {}, { name: 'Salah', role: 'SDR', team: 'smb' }).status, 400);
    // The overview now has a target for the period.
    handle('PATCH', `/reps/1`, {}, { monthly_quota: 100_000 });
    const ov = handle('GET', '/analytics/overview', { from: '2026-11-01', to: '2026-11-30' }, undefined).body as { kpis: { target: number } };
    assert.equal(ov.kpis.target, 100_000);
  });
});
