import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reps (
  id     INTEGER PRIMARY KEY,
  name   TEXT NOT NULL,
  email  TEXT NOT NULL,
  role   TEXT NOT NULL CHECK (role IN ('AE', 'SDR')),
  team   TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

-- Monthly revenue quota per account executive.
CREATE TABLE IF NOT EXISTS quotas (
  rep_id INTEGER NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  month  TEXT NOT NULL,
  amount INTEGER NOT NULL,
  PRIMARY KEY (rep_id, month)
);

CREATE TABLE IF NOT EXISTS accounts (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  industry   TEXT NOT NULL,
  segment    TEXT NOT NULL,
  region     TEXT NOT NULL,
  employees  INTEGER NOT NULL DEFAULT 0,
  website    TEXT,
  owner_id   INTEGER REFERENCES reps(id) ON DELETE SET NULL,
  tier       TEXT NOT NULL DEFAULT 'tier3',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_segment ON accounts(segment, region);

CREATE TABLE IF NOT EXISTS campaigns (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  channel    TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL,
  budget     INTEGER NOT NULL DEFAULT 0,
  spend      INTEGER NOT NULL DEFAULT 0,
  status     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  email        TEXT,
  title        TEXT,
  company      TEXT NOT NULL,
  industry     TEXT NOT NULL,
  segment      TEXT NOT NULL,
  region       TEXT NOT NULL,
  channel      TEXT NOT NULL,
  campaign_id  INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  status       TEXT NOT NULL,
  score        INTEGER NOT NULL DEFAULT 0,
  owner_id     INTEGER REFERENCES reps(id) ON DELETE SET NULL,
  account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  deal_id      INTEGER,
  created_at   TEXT NOT NULL,
  mql_at       TEXT,
  sql_at       TEXT,
  converted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_account ON leads(account_id);

CREATE TABLE IF NOT EXISTS deals (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  account_id       INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  owner_id         INTEGER NOT NULL REFERENCES reps(id),
  stage            TEXT NOT NULL,
  amount           INTEGER NOT NULL,
  product          TEXT NOT NULL,
  type             TEXT NOT NULL,
  source           TEXT NOT NULL,
  channel          TEXT,
  campaign_id      INTEGER REFERENCES campaigns(id) ON DELETE SET NULL,
  lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL,
  expected_close   TEXT NOT NULL,
  closed_at        TEXT,
  stage_changed_at TEXT NOT NULL,
  lost_reason      TEXT,
  next_step        TEXT
);
CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
CREATE INDEX IF NOT EXISTS idx_deals_closed ON deals(closed_at);
CREATE INDEX IF NOT EXISTS idx_deals_account ON deals(account_id);

CREATE TABLE IF NOT EXISTS activities (
  id         INTEGER PRIMARY KEY,
  rep_id     INTEGER NOT NULL REFERENCES reps(id) ON DELETE CASCADE,
  deal_id    INTEGER REFERENCES deals(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  lead_id    INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  date       TEXT NOT NULL,
  subject    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_rep ON activities(rep_id, date);
CREATE INDEX IF NOT EXISTS idx_activities_account ON activities(account_id, date);
`;

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function isEmpty(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM reps').get() as { n: number };
  return row.n === 0;
}

export function clearAll(db: Db): void {
  db.exec(`
    DELETE FROM activities; DELETE FROM deals; DELETE FROM leads; DELETE FROM campaigns;
    DELETE FROM accounts; DELETE FROM quotas; DELETE FROM reps; DELETE FROM meta;
  `);
}

/** Runs fn inside a transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
