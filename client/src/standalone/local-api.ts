// In-browser API for the standalone build: the same router the Node server
// uses, backed by SQLite compiled to plain JavaScript (sql.js, asm.js build -
// no WebAssembly, so it runs under strict content-security policies too).
// Data is generated on load and lives in memory for the session.
import initSqlJs from 'sql.js/dist/sql-asm-memory-growth.js';
import { initSchema } from '../../../server/schema.ts';
import { seed } from '../../../server/seed.ts';
import { createRouter } from '../../../server/routes.ts';
import { todayLocal } from '../../../shared/dates.ts';
import { wrapSqlJs } from './sqljs-db.ts';

type Router = ReturnType<typeof createRouter>;
let ready: Promise<Router> | null = null;

function router(): Promise<Router> {
  ready ??= (async () => {
    const SQL = await initSqlJs();
    const db = wrapSqlJs(new SQL.Database());
    initSchema(db);
    const today = todayLocal();
    seed(db, { today });
    return createRouter({ db, today: () => today, appName: 'AFM', allowReset: true });
  })();
  return ready;
}

/** Same contract as an HTTP call: JSON in, JSON out, status code. */
export async function localRequest(method: string, pathAndQuery: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const r = await router();
  const url = new URL(pathAndQuery, 'http://local');
  const query: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  const res = r.handle(method, url.pathname, query, body === undefined ? undefined : JSON.parse(JSON.stringify(body)));
  return { status: res.status, body: res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body)) };
}
