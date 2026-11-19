// Database schema and helpers that work with any SQLite binding exposing the
// small synchronous API below: node:sqlite on the server, sql.js in the browser.

import { DEFAULT_WA_TEMPLATES } from '../shared/whatsapp.ts';

export type SqlValue = string | number | null;

export interface Stmt {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown;
  run(...params: SqlValue[]): { lastInsertRowid: number | bigint; changes: number | bigint };
}

export interface Db {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
}

export const SCHEMA = `
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
  created_at TEXT NOT NULL,
  legal_name     TEXT,
  contact_name   TEXT,
  phone          TEXT,
  sales_estimate INTEGER,
  rating         REAL,
  area           TEXT,
  socials        TEXT,
  source         TEXT,
  address        TEXT,
  email          TEXT,
  verified_at    TEXT,
  verify_status  TEXT,
  agent_note     TEXT
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
  phone        TEXT,
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

-- AI agent: one row per cycle (verification and/or discovery of new leads).
CREATE TABLE IF NOT EXISTS agent_runs (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT NOT NULL,
  model         TEXT,
  calls         INTEGER NOT NULL DEFAULT 0,
  checked       INTEGER NOT NULL DEFAULT 0,
  found         INTEGER NOT NULL DEFAULT 0,
  searches      INTEGER NOT NULL DEFAULT 0,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  error         TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at);

-- What the agent proposes: a corrected field, a closed business or a new lead.
CREATE TABLE IF NOT EXISTS agent_findings (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  payload     TEXT,
  confidence  TEXT NOT NULL,
  sources     TEXT,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TEXT NOT NULL,
  decided_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_findings_status ON agent_findings(status, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_findings_account ON agent_findings(account_id);

-- WhatsApp: message templates and every message opened from the dashboard.
CREATE TABLE IF NOT EXISTS wa_templates (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wa_messages (
  id          INTEGER PRIMARY KEY,
  lead_id     INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  account_id  INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  phone       TEXT NOT NULL,
  body        TEXT NOT NULL,
  template_id INTEGER REFERENCES wa_templates(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  -- out: from us; in: from the customer
  direction   TEXT NOT NULL DEFAULT 'out',
  -- user (a person), agent (the AI) or contact (the customer)
  author      TEXT NOT NULL DEFAULT 'user',
  -- opened (wa.me), draft (waiting for approval), sent/delivered/read/failed (Business API), received
  status      TEXT NOT NULL DEFAULT 'opened',
  wa_id       TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_wa_messages_lead ON wa_messages(lead_id, created_at);

-- Product catalog and orders (taken on WhatsApp by the agent or entered by hand).
CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  unit        TEXT NOT NULL,
  price_sen   INTEGER NOT NULL,
  min_qty     REAL,
  stock       REAL,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id               INTEGER PRIMARY KEY,
  lead_id          INTEGER REFERENCES leads(id) ON DELETE SET NULL,
  account_id       INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  status           TEXT NOT NULL,
  total_sen        INTEGER NOT NULL DEFAULT 0,
  delivery_date    TEXT,
  delivery_address TEXT,
  notes            TEXT,
  source           TEXT NOT NULL,
  deal_id          INTEGER REFERENCES deals(id) ON DELETE SET NULL,
  cancel_reason    TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_lead ON orders(lead_id);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL,
  qty        REAL NOT NULL,
  price_sen  INTEGER NOT NULL
);
`;

/** Columns added after the first release; older databases get them on open. */
const ADDED_COLUMNS: [table: string, column: string, type: string][] = [
  ['accounts', 'legal_name', 'TEXT'],
  ['accounts', 'contact_name', 'TEXT'],
  ['accounts', 'phone', 'TEXT'],
  ['accounts', 'sales_estimate', 'INTEGER'],
  ['accounts', 'rating', 'REAL'],
  ['accounts', 'area', 'TEXT'],
  ['accounts', 'socials', 'TEXT'],
  ['accounts', 'source', 'TEXT'],
  ['leads', 'phone', 'TEXT'],
  ['accounts', 'address', 'TEXT'],
  ['accounts', 'email', 'TEXT'],
  ['accounts', 'verified_at', 'TEXT'],
  ['accounts', 'verify_status', 'TEXT'],
  ['accounts', 'agent_note', 'TEXT'],
  ['leads', 'wa_status', 'TEXT'],
  ['leads', 'wa_replied_at', 'TEXT'],
  ['wa_messages', 'direction', "TEXT NOT NULL DEFAULT 'out'"],
  ['wa_messages', 'author', "TEXT NOT NULL DEFAULT 'user'"],
  ['wa_messages', 'status', "TEXT NOT NULL DEFAULT 'opened'"],
  ['wa_messages', 'wa_id', 'TEXT'],
  ['wa_messages', 'error', 'TEXT'],
  // WhatsApp conversation state per lead
  ['leads', 'wa_last_in_at', 'TEXT'],
  ['leads', 'wa_unread', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'wa_needs_human', 'INTEGER NOT NULL DEFAULT 0'],
  ['leads', 'wa_human_reason', 'TEXT'],
  ['leads', 'wa_agent_off', 'INTEGER NOT NULL DEFAULT 0'],
];

export function initSchema(db: Db): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  for (const [table, column, type] of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  if (!isEmpty(db)) ensureWaTemplates(db, new Date().toISOString().slice(0, 10));
}

/** Adds the starting WhatsApp templates once (also after a reset or import). */
export function ensureWaTemplates(db: Db, today: string): void {
  const flag = db.prepare(`SELECT 1 FROM meta WHERE key = 'wa_templates'`).get();
  if (flag) return;
  const ins = db.prepare('INSERT INTO wa_templates (name, body, created_at) VALUES (?, ?, ?)');
  for (const t of DEFAULT_WA_TEMPLATES) ins.run(t.name, t.body, today);
  db.prepare(`INSERT INTO meta (key, value) VALUES ('wa_templates', '1')`).run();
}

export function isEmpty(db: Db): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM reps').get() as { n: number };
  return row.n === 0;
}

export function clearAll(db: Db): void {
  db.exec(`
    DELETE FROM order_items; DELETE FROM orders; DELETE FROM products;
    DELETE FROM wa_messages; DELETE FROM wa_templates;
    DELETE FROM agent_findings; DELETE FROM agent_runs;
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
