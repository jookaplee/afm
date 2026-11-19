// Businesses of the group and lead categories (synthetic data, no network).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../db.ts';
import { initSchema } from '../schema.ts';
import { importCrm } from '../import-crm.ts';
import { seed } from '../seed.ts';
import { createRouter } from '../routes.ts';
import type { AgentPlan } from '../../shared/agent.ts';
import type { AccountRow, BusinessRow, LeadCategoryRow, LeadFacets, LeadRow, MetaResponse, Paged } from '../../shared/types.ts';

const TODAY = '2026-11-19';

function setup() {
  const db = openDb(':memory:');
  importCrm(
    db,
    {
      categories: { restoran_halal_western: { label: 'Restoran' }, kedai_runcit: { label: 'Kedai Runcit Mini' } },
      leads: [
        { category: 'restoran_halal_western', name: 'Grill Satu', owner: 'Encik Satu', phone: '012-1111111', primaryRegion: 'Selangor' },
        { category: 'kafe_premium_steak_bbq', name: 'Kafe Dua', owner: 'Puan Dua', phone: '012-2222222', primaryRegion: 'Johor' },
        { category: 'kedai_runcit', name: 'Runcit Tiga', owner: 'Encik Tiga', phone: '012-3333333', primaryRegion: 'Kedah' },
      ],
    },
    { today: TODAY },
  );
  const { handle } = createRouter({ db, today: () => TODAY });
  const call = <T,>(method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const res = handle(method, path, query, body);
    if (res.status >= 400) throw Object.assign(new Error(JSON.stringify(res.body)), { status: res.status, body: res.body });
    return res.body as T;
  };
  const fails = (method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const res = handle(method, path, query, body);
    assert.ok(res.status >= 400, `${method} ${path} should fail`);
    return res as { status: number; body: { error: string; details?: { fields?: Record<string, string> } } };
  };
  return { db, call, fails };
}

const leadBody = (over: Record<string, unknown>) => ({
  name: 'PIC Baharu',
  company: 'Syarikat Baharu',
  segment: 'smb',
  region: 'klang_valley',
  channel: 'referral',
  ...over,
});

describe('businesses and lead categories', () => {
  it('starts with one business, the imported categories and the fallback', () => {
    const { call } = setup();
    const meta = call<MetaResponse>('GET', '/meta');
    assert.equal(meta.businesses.length, 1);
    assert.deepEqual(
      meta.categories.map((c) => [c.key, c.name, c.business_id === null]),
      [
        ['restoran_halal_western', 'Restoran Halal Western', false],
        ['kafe_premium_steak_bbq', 'Kafe Premium (Steak & BBQ)', false],
        // Unknown keys take the list's own label.
        ['kedai_runcit', 'Kedai Runcit Mini', false],
        // The fallback is for every business and always last.
        ['other', 'Lain-lain', true],
      ],
    );
    const cats = call<LeadCategoryRow[]>('GET', '/lead-categories');
    assert.deepEqual(
      cats.map((c) => [c.key, c.leads, c.accounts]),
      [
        ['restoran_halal_western', 1, 1],
        ['kafe_premium_steak_bbq', 1, 1],
        ['kedai_runcit', 1, 1],
        ['other', 0, 0],
      ],
    );
    const leads = call<Paged<LeadRow>>('GET', '/leads', undefined, { pageSize: 50 }).rows;
    assert.ok(leads.every((l) => l.business_id === meta.businesses[0].id));
  });

  it('gives a lead the business of its category, or the one chosen for a group-wide category', () => {
    const { call, fails } = setup();
    const first = call<MetaResponse>('GET', '/meta').businesses[0];
    const hotel = call<BusinessRow>('POST', '/businesses', { name: 'Joosons Hospitaliti', description: 'Bekalan linen hotel' });
    assert.equal(fails('POST', '/businesses', { name: 'joosons hospitaliti' }).status, 409, 'names are unique');
    const cat = call<LeadCategoryRow>('POST', '/lead-categories', { name: 'Hotel & Resort', business_id: hotel.id, description: 'Hotel 3-5 bintang' });
    assert.equal(cat.key, 'hotel_dan_resort');
    assert.equal(call<LeadCategoryRow>('POST', '/lead-categories', { name: 'Hotel & Resort', business_id: null }).key, 'hotel_dan_resort_2', 'keys stay unique');
    // The category decides the business, whatever is asked.
    const a = call<LeadRow>('POST', '/leads', leadBody({ industry: cat.key, business_id: first.id }));
    assert.equal(a.business_id, hotel.id);
    // Group-wide: the business asked for, else the default one.
    const b = call<LeadRow>('POST', '/leads', leadBody({ industry: 'other', business_id: hotel.id }));
    assert.equal(b.business_id, hotel.id);
    assert.equal(call<LeadRow>('POST', '/leads', leadBody({ industry: 'other' })).business_id, first.id);
    // Moving to a business category moves the business too.
    assert.equal(call<LeadRow>('PATCH', `/leads/${b.id}`, { industry: 'restoran_halal_western' }).business_id, first.id);
    // Unknown category: a field error.
    assert.equal(fails('POST', '/leads', leadBody({ industry: 'tiada' })).body.details?.fields?.industry, 'not_found');

    // Filters and counts.
    const hotelLeads = call<Paged<LeadRow>>('GET', '/leads', undefined, { business: String(hotel.id) });
    assert.deepEqual(hotelLeads.rows.map((l) => l.id), [a.id]);
    const facets = call<LeadFacets>('GET', '/leads/facets', undefined, { business: String(first.id) });
    assert.deepEqual(Object.fromEntries(facets.categories.map((c) => [c.key, c.n])), {
      restoran_halal_western: 2,
      kafe_premium_steak_bbq: 1,
      kedai_runcit: 1,
      other: 1,
    });
    assert.equal(facets.total, 5);
    assert.deepEqual(Object.fromEntries(facets.businesses.map((x) => [x.id, x.n])), { [first.id]: 5, [hotel.id]: 1 });
    assert.equal(call<Paged<LeadRow>>('GET', '/leads', undefined, { business: String(first.id), industry: 'other' }).total, 1);
  });

  it('moves leads with their category to another business', () => {
    const { call } = setup();
    const hotel = call<BusinessRow>('POST', '/businesses', { name: 'Perniagaan Dua' });
    const runcit = call<LeadCategoryRow[]>('GET', '/lead-categories').find((c) => c.key === 'kedai_runcit')!;
    call('PATCH', `/lead-categories/${runcit.id}`, { business_id: hotel.id, name_en: 'Mini marts', color: 5 });
    const leads = call<Paged<LeadRow>>('GET', '/leads', undefined, { business: String(hotel.id) }).rows;
    assert.deepEqual(leads.map((l) => l.company), ['Runcit Tiga']);
    const b = call<BusinessRow[]>('GET', '/businesses').find((x) => x.id === hotel.id)!;
    assert.deepEqual([b.leads, b.categories], [1, 1]);
  });

  it('deletes a category in use only by moving its leads and accounts', () => {
    const { call, fails } = setup();
    const cats = call<LeadCategoryRow[]>('GET', '/lead-categories');
    const kafe = cats.find((c) => c.key === 'kafe_premium_steak_bbq')!;
    const other = cats.find((c) => c.key === 'other')!;
    assert.equal(fails('DELETE', `/lead-categories/${kafe.id}`).body.details?.fields?.move_to, 'required');
    assert.equal(fails('DELETE', `/lead-categories/${kafe.id}`, undefined, { move_to: 'kafe_premium_steak_bbq' }).status, 400);
    assert.deepEqual(call('DELETE', `/lead-categories/${kafe.id}`, undefined, { move_to: 'restoran_halal_western' }), { moved: 2 });
    const accounts = call<Paged<AccountRow>>('GET', '/accounts', undefined, { industry: 'restoran_halal_western' });
    assert.equal(accounts.total, 2);
    assert.equal(call<Paged<LeadRow>>('GET', '/leads', undefined, { industry: 'restoran_halal_western' }).total, 2);
    // The fallback stays.
    assert.equal(fails('DELETE', `/lead-categories/${other.id}`).status, 409);
    assert.equal(fails('PATCH', `/lead-categories/${other.id}`, { active: 0 }).status, 409);
    // An unused category goes without a target.
    const empty = call<LeadCategoryRow>('POST', '/lead-categories', { name: 'Kosong', business_id: null });
    assert.deepEqual(call('DELETE', `/lead-categories/${empty.id}`), { moved: 0 });
  });

  it('keeps at least one business, and only deletes one without leads', () => {
    const { call, fails } = setup();
    const [first] = call<BusinessRow[]>('GET', '/businesses');
    assert.equal(fails('DELETE', `/businesses/${first.id}`).status, 409);
    assert.equal(fails('PATCH', `/businesses/${first.id}`, { active: 0 }).status, 409);
    const two = call<BusinessRow>('POST', '/businesses', { name: 'Dua' });
    assert.equal(fails('DELETE', `/businesses/${first.id}`).status, 409, 'it has leads');
    call('POST', '/lead-categories', { name: 'Belum digunakan', business_id: two.id });
    call('DELETE', `/businesses/${two.id}`);
    assert.equal(call<BusinessRow[]>('GET', '/businesses').length, 1);
    assert.ok(!call<LeadCategoryRow[]>('GET', '/lead-categories').some((c) => c.name === 'Belum digunakan'), 'its unused categories go too');
  });

  it('lets the AI agent search the categories marked for it, with their business', () => {
    const { call } = setup();
    call('PATCH', '/agent/settings', { perCycle: 0, dailyCalls: 10, discoverPerCycle: 3 });
    const cats = call<LeadCategoryRow[]>('GET', '/lead-categories');
    for (const c of cats) if (c.key !== 'kedai_runcit') call('PATCH', `/lead-categories/${c.id}`, { ai_discover: 0 });
    const runcit = cats.find((c) => c.key === 'kedai_runcit')!;
    call('PATCH', `/lead-categories/${runcit.id}`, { description: 'Kedai runcit kecil di taman perumahan' });
    const plan = call<AgentPlan>('GET', '/agent/plan');
    assert.equal(plan.discover?.category, 'kedai_runcit');
    assert.equal(plan.discover?.brief, 'Kedai Runcit Mini: Kedai runcit kecil di taman perumahan');
    assert.match(plan.discover?.business ?? '', /^Bekalan Daging & Makanan Laut: /);
    call('PATCH', `/lead-categories/${runcit.id}`, { active: 0 });
    assert.equal(call<AgentPlan>('GET', '/agent/plan').discover, null, 'nothing to search');
  });

  it('sets up categories for an older database and the demo data', () => {
    const db = openDb(':memory:');
    seed(db, { today: TODAY });
    db.exec('DELETE FROM lead_categories; DELETE FROM businesses; UPDATE leads SET business_id = NULL;');
    initSchema(db);
    const keys = (db.prepare('SELECT key FROM lead_categories ORDER BY sort').all() as { key: string }[]).map((r) => r.key);
    assert.deepEqual(keys, ['restoran_halal_western', 'kafe_premium_steak_bbq', 'penjual_perap_online', 'other']);
    const orphan = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE business_id IS NULL').get() as { n: number };
    assert.equal(orphan.n, 0);
  });
});
