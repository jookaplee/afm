// Adapts a sql.js Database to the small synchronous API the server code uses
// (the same shape as node:sqlite's DatabaseSync), so seed/analytics/crud run
// unchanged in the browser.
import type { Database, SqlValue as SqlJsValue, Statement } from 'sql.js';
import type { Db, SqlValue } from '../../../server/schema.ts';

export function wrapSqlJs(raw: Database): Db {
  const cache = new Map<string, Statement>();
  const stmt = (sql: string): Statement => {
    let st = cache.get(sql);
    if (!st) {
      st = raw.prepare(sql);
      cache.set(sql, st);
    }
    return st;
  };
  const norm = (params: SqlValue[]): SqlJsValue[] => params.map((p) => (p === undefined ? null : p));
  const rows = (sql: string, params: SqlValue[], limit = Infinity): Record<string, SqlJsValue>[] => {
    const st = stmt(sql);
    try {
      st.bind(norm(params));
      const out: Record<string, SqlJsValue>[] = [];
      while (out.length < limit && st.step()) out.push(st.getAsObject());
      return out;
    } finally {
      st.reset();
    }
  };

  return {
    exec(sql) {
      raw.exec(sql);
    },
    prepare(sql) {
      return {
        all: (...params) => rows(sql, params),
        get: (...params) => rows(sql, params, 1)[0],
        run: (...params) => {
          stmt(sql).run(norm(params));
          const id = raw.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0];
          return { lastInsertRowid: Number(id ?? 0), changes: raw.getRowsModified() };
        },
      };
    },
  };
}
