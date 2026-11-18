// The standalone build runs the same router on sql.js (SQLite compiled to JS).
// These checks make sure it behaves like the node:sqlite server.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { SqlJsStatic } from 'sql.js';
import { initSchema } from '../schema.ts';
import { seed } from '../seed.ts';
import { createRouter } from '../routes.ts';
import { openDb } from '../db.ts';
import { wrapSqlJs } from '../../client/src/standalone/sqljs-db.ts';
import type { OverviewResponse, DealRow } from '../../shared/types.ts';

const TODAY = '2026-06-15';
const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js/dist/sql-asm-memory-growth.js') as () => Promise<SqlJsStatic>;

describe('standalone (sql.js) router', () => {
  it('produces the same analytics as the node:sqlite server', async () => {
    const SQL = await initSqlJs();
    const browserDb = wrapSqlJs(new SQL.Database());
    initSchema(browserDb);
    const a = seed(browserDb, { today: TODAY });
    const nodeDb = openDb(':memory:');
    const b = seed(nodeDb, { today: TODAY });
    assert.deepEqual(a, b);

    const opts = { today: () => TODAY, allowReset: true };
    const inBrowser = createRouter({ ...opts, db: browserDb }).handle;
    const onServer = createRouter({ ...opts, db: nodeDb }).handle;
    for (const path of ['/analytics/overview', '/analytics/sales', '/analytics/marketing']) {
      const x = inBrowser('GET', path, { segment: 'midmarket' }, undefined);
      const y = onServer('GET', path, { segment: 'midmarket' }, undefined);
      assert.equal(x.status, 200);
      // Compare as JSON, as the client receives it (node:sqlite rows have a null prototype).
      assert.deepEqual(JSON.parse(JSON.stringify(x.body)), JSON.parse(JSON.stringify(y.body)), path);
    }
    const ov = inBrowser('GET', '/analytics/overview', {}, undefined).body as OverviewResponse;
    assert.ok((ov.kpis.revenue.value ?? 0) > 0);
  });

  it('supports writes, validation errors and unknown routes', async () => {
    const SQL = await initSqlJs();
    const db = wrapSqlJs(new SQL.Database());
    initSchema(db);
    seed(db, { today: TODAY });
    const { handle } = createRouter({ db, today: () => TODAY });
    const created = handle('POST', '/deals', {}, {
      name: 'Ujian Pelayar',
      account_id: 1,
      owner_id: 1,
      stage: 'proposal',
      amount: 50_000,
      product: 'hr',
      type: 'new_business',
      source: 'sales',
      expected_close: '2026-08-01',
    });
    assert.equal(created.status, 201);
    const deal = created.body as DealRow;
    assert.ok(deal.id > 0);
    assert.equal(handle('PATCH', `/deals/${deal.id}`, {}, { stage: 'won' }).status, 200);
    assert.equal((handle('GET', `/deals/${deal.id}`, {}, undefined).body as DealRow).closed_at, TODAY);
    assert.equal(handle('DELETE', `/deals/${deal.id}`, {}, undefined).status, 204);
    assert.equal(handle('POST', '/deals', {}, { name: 'x' }).status, 400);
    assert.equal(handle('GET', '/nope', {}, undefined).status, 404);
    assert.equal(handle('DELETE', '/meta', {}, undefined).status, 405);
  });
});
