// Standalone persistence: changes are journaled to a store and replayed on load.
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SqlJsStatic } from 'sql.js';
import { createLocalApi } from '../../client/src/standalone/local-api.ts';
import { memoryStore } from '../../client/src/standalone/persistence.ts';
import type { DealRow, OverviewResponse, Paged } from '../../shared/types.ts';

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-asm-memory-growth.js') as () => Promise<SqlJsStatic>;
let SQL: SqlJsStatic;

const newDeal = (name: string) => ({
  name,
  account_id: 1,
  owner_id: 1,
  stage: 'proposal',
  amount: 70_000,
  product: 'platform',
  type: 'new_business',
  source: 'sales',
  expected_close: '2026-12-20',
});

before(async () => {
  SQL = await initSqlJs();
});

describe('standalone persistence', () => {
  it('keeps changes across a reload, replayed on the original data and dates', async () => {
    const store = memoryStore();
    const a = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const created = await a.request('POST', '/deals', newDeal('Simpanan Ujian'));
    assert.equal(created.status, 201);
    const id = (created.body as DealRow).id;
    assert.equal((await a.request('PATCH', `/deals/${id}`, { stage: 'won' })).status, 200);
    assert.equal(store.changes.length, 2);
    assert.equal(store.meta?.anchor, '2026-11-18');

    // "Reload" a week later: same records, same ids, original dates.
    const b = await createLocalApi({ SQL, store, today: () => '2026-11-25' });
    const deal = (await b.request('GET', `/deals/${id}`)).body as DealRow;
    assert.equal(deal.name, 'Simpanan Ujian');
    assert.equal(deal.stage, 'won');
    assert.equal(deal.created_at, '2026-11-18');
    assert.equal(deal.closed_at, '2026-11-18');
    const info = (await b.request('GET', '/_persistence')).body as { mode: string; savedChanges: number; anchor: string };
    assert.deepEqual(info, { mode: 'cloud', savedChanges: 2, anchor: '2026-11-18' });
    const ov1 = (await a.request('GET', '/analytics/overview?from=2026-01-01&to=2026-11-18')).body as OverviewResponse;
    const ov2 = (await b.request('GET', '/analytics/overview?from=2026-01-01&to=2026-11-18')).body as OverviewResponse;
    assert.equal(ov1.kpis.revenue.value, ov2.kpis.revenue.value);
  });

  it('starts from today when nothing has been saved yet', async () => {
    const store = memoryStore();
    store.meta = { epoch: 'e1', anchor: '2026-01-01', seedVersion: 1 };
    const api = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const info = (await api.request('GET', '/_persistence')).body as { anchor: string };
    assert.equal(info.anchor, '2026-11-18');
  });

  it('reset starts a fresh data set and drops old changes', async () => {
    const store = memoryStore();
    const a = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const id = ((await a.request('POST', '/deals', newDeal('Akan dibuang'))).body as DealRow).id;
    assert.equal((await a.request('POST', '/admin/reset', {})).status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(store.changes.length, 0);
    const b = await createLocalApi({ SQL, store, today: () => '2026-11-19' });
    const after = await b.request('GET', `/deals/${id}`);
    assert.ok(after.status === 404 || (after.body as DealRow).name !== 'Akan dibuang');
  });

  it('blocks changes for view-only viewers', async () => {
    const store = memoryStore(false);
    const api = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const res = await api.request('POST', '/deals', newDeal('Tidak dibenarkan'));
    assert.equal(res.status, 403);
    assert.equal((res.body as { code: string }).code, 'read_only');
    const list = (await api.request('GET', `/deals?search=${encodeURIComponent('Tidak dibenarkan')}`)).body as Paged<DealRow>;
    assert.equal(list.total, 0);
  });

  it('rolls back a change that could not be saved', async () => {
    const store = memoryStore();
    const api = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    store.failNextWrite = true;
    const res = await api.request('POST', '/deals', newDeal('Gagal disimpan'));
    assert.ok(res.status === 403 || res.status === 503);
    const list = (await api.request('GET', `/deals?search=${encodeURIComponent('Gagal disimpan')}`)).body as Paged<DealRow>;
    assert.equal(list.total, 0);
  });

  it('applies another tab’s saved changes before writing on top of them', async () => {
    const store = memoryStore();
    const tabA = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const tabB = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    const a = (await tabA.request('POST', '/deals', newDeal('Dari tab A'))).body as DealRow;
    const b = (await tabB.request('POST', '/deals', newDeal('Dari tab B'))).body as DealRow;
    assert.notEqual(a.id, b.id);
    assert.equal((await tabB.request('PATCH', `/deals/${b.id}`, { amount: 99_000 })).status, 200);
    const reloaded = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    assert.equal(((await reloaded.request('GET', `/deals/${a.id}`)).body as DealRow).name, 'Dari tab A');
    const db = (await reloaded.request('GET', `/deals/${b.id}`)).body as DealRow;
    assert.equal(db.name, 'Dari tab B');
    assert.equal(db.amount, 99_000);
  });
});

describe('browser storage (any host outside claude.ai)', () => {
  it('keeps changes in this browser across reloads', async () => {
    const { browserStore } = await import('../../client/src/standalone/persistence.ts');
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
    const store = browserStore(storage)!;
    assert.equal(store.kind, 'device');
    const a = await createLocalApi({ SQL, store, today: () => '2026-11-18' });
    assert.equal(((await a.request('GET', '/_persistence')).body as { mode: string }).mode, 'device');
    const id = ((await a.request('POST', '/deals', newDeal('Di pelayar ini'))).body as DealRow).id;
    const b = await createLocalApi({ SQL, store: browserStore(storage), today: () => '2026-11-20' });
    assert.equal(((await b.request('GET', `/deals/${id}`)).body as DealRow).name, 'Di pelayar ini');
  });

  it('is unavailable when storage throws (e.g. blocked site data)', async () => {
    const { browserStore } = await import('../../client/src/standalone/persistence.ts');
    const broken = {
      getItem: () => null,
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    assert.equal(browserStore(broken), null);
  });
});
