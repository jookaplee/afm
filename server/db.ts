import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { initSchema } from './schema.ts';

export type { Db } from './schema.ts';
export { clearAll, isEmpty, tx } from './schema.ts';

/** Opens (and if needed creates) the SQLite database file used by the Node server. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL;');
  initSchema(db);
  return db;
}
