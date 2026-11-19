// Storage side of the AI lead agent: what to check next, saving a cycle's
// results as findings (proposed corrections, possibly-closed businesses and new
// leads), and applying the ones a person accepts. Every write goes through the
// API, so the browser version records it in its change journal like any edit.

import { tx, type Db } from './schema.ts';
import { prospectInserter, type CrmRecord } from './import-crm.ts';
import { HttpError, type Query } from './http.ts';
import { REGIONS, type Region } from '../shared/constants.ts';
import { existingCategoryOr } from './categories-store.ts';
import {
  AGENT_FIELDS,
  SOCIAL_FIELDS,
  categoryBrief,
  cleanSources,
  cleanUrl,
  cleanValue,
  nameKey,
  normPhone,
  normalizeSettings,
  valueKey,
  type AgentAccountRecord,
  type AgentField,
  type AgentPlan,
  type AgentRunInput,
  type AgentRunSummary,
  type AgentSettings,
  type Candidate,
  type DiscoverTarget,
} from '../shared/agent.ts';
import type { AgentFindingRow, AgentRunRow, AgentSummary, Paged } from '../shared/types.ts';

// ---------- Settings ----------

export function getSettings(db: Db): AgentSettings {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'agent_settings'`).get() as { value: string } | undefined;
  try {
    return normalizeSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return normalizeSettings({});
  }
}

export function putSettings(db: Db, body: unknown): AgentSettings {
  const next = normalizeSettings({ ...getSettings(db), ...(body && typeof body === 'object' ? body : {}) });
  db.prepare(`INSERT INTO meta (key, value) VALUES ('agent_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next));
  return next;
}

// ---------- Plan ----------

const callsOn = (db: Db, day: string) =>
  (db.prepare('SELECT COALESCE(SUM(calls), 0) AS n FROM agent_runs WHERE substr(started_at, 1, 10) = ?').get(day) as { n: number }).n;

function daysBefore(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const ACCOUNT_RECORD_SQL = `SELECT id, name, legal_name, industry, region, area, address, phone, contact_name, email,
  website, socials, rating, verified_at,
  COALESCE((SELECT CASE WHEN COALESCE(c.description, '') = '' THEN c.name ELSE c.name || ': ' || c.description END
            FROM lead_categories c WHERE c.key = accounts.industry), industry) AS category_brief
  FROM accounts`;

interface DiscoverCategory {
  key: string;
  name: string;
  description: string | null;
  business_name: string | null;
  business_description: string | null;
}

/**
 * Discovery walks every category x region pair in turn, over the active
 * categories the agent may search (ai_discover) of active businesses.
 */
function discoverTarget(db: Db): DiscoverTarget | null {
  const cats = db
    .prepare(
      `SELECT c.key, c.name, c.description, b.name AS business_name, b.description AS business_description
       FROM lead_categories c LEFT JOIN businesses b ON b.id = c.business_id
       WHERE c.active = 1 AND c.ai_discover = 1 AND (c.business_id IS NULL OR b.active = 1)
       ORDER BY c.sort, c.id`,
    )
    .all() as unknown as DiscoverCategory[];
  if (!cats.length) return null;
  const done = (db.prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE kind IN ('discover', 'cycle')`).get() as { n: number }).n;
  const pairs: [DiscoverCategory, Region][] = REGIONS.flatMap((r) => cats.map((c) => [c, r] as [DiscoverCategory, Region]));
  const [cat, region] = pairs[done % pairs.length];
  const category = cat.key;
  // A category for every business: describe the group's active businesses.
  const business = cat.business_name
    ? categoryBrief(cat.business_name, cat.business_description)
    : (db.prepare('SELECT name, description FROM businesses WHERE active = 1 ORDER BY sort, id').all() as { name: string; description: string | null }[])
        .map((b) => categoryBrief(b.name, b.description))
        .join(' | ');
  const names = db
    .prepare('SELECT name FROM accounts WHERE industry = ? AND region = ? ORDER BY name LIMIT 200')
    .all(category, region) as { name: string }[];
  const pending = db
    .prepare(`SELECT payload FROM agent_findings WHERE kind = 'new_lead' AND status IN ('pending', 'rejected') ORDER BY id DESC LIMIT 200`)
    .all() as { payload: string }[];
  const exclude = names.map((n) => n.name);
  for (const p of pending) {
    try {
      const c = JSON.parse(p.payload) as Candidate;
      if (c.category === category) exclude.push(c.name);
    } catch {
      /* ignore */
    }
  }
  return { category, label: cat.name, brief: categoryBrief(cat.name, cat.description), business, region, exclude: [...new Set(exclude)].slice(0, 250) };
}

/**
 * What the next cycle should do, within the daily call limit. A specific
 * account (a manual "check now") is always allowed.
 */
export function plan(db: Db, q: Query, today: string): AgentPlan {
  const settings = getSettings(db);
  const used = callsOn(db, today);
  const left = Math.max(0, settings.dailyCalls - used);
  const accountId = Number(q.accountId);
  if (Number.isInteger(accountId) && accountId > 0) {
    const a = db.prepare(`${ACCOUNT_RECORD_SQL} WHERE id = ?`).get(accountId) as AgentAccountRecord | undefined;
    if (!a) throw new HttpError(404, 'Not found');
    return { settings, accounts: [a], discover: null, budget: { used, limit: settings.dailyCalls } };
  }
  const due = daysBefore(today, settings.reverifyDays);
  const accounts = db
    .prepare(
      `${ACCOUNT_RECORD_SQL}
       WHERE (verified_at IS NULL OR substr(verified_at, 1, 10) <= ?) AND COALESCE(verify_status, '') <> 'closed'
       ORDER BY verified_at IS NOT NULL, verified_at, tier, sales_estimate DESC NULLS LAST, id
       LIMIT ?`,
    )
    .all(due, Math.min(settings.perCycle, left)) as unknown as AgentAccountRecord[];
  const discover = settings.discoverPerCycle > 0 && left - accounts.length > 0 ? discoverTarget(db) : null;
  return { settings, accounts, discover, budget: { used, limit: settings.dailyCalls } };
}

// ---------- Applying values ----------

const COLUMN: Partial<Record<AgentField, string>> = {
  phone: 'phone',
  contact_name: 'contact_name',
  address: 'address',
  email: 'email',
  website: 'website',
  legal_name: 'legal_name',
};

interface AccountValues {
  id: number;
  name: string;
  phone: string | null;
  contact_name: string | null;
  address: string | null;
  email: string | null;
  website: string | null;
  legal_name: string | null;
  socials: string | null;
  verify_status: string | null;
}

function socialsOf(a: AccountValues): Record<string, string> {
  try {
    return a.socials ? (JSON.parse(a.socials) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function currentValue(a: AccountValues, field: AgentField): string | null {
  if (SOCIAL_FIELDS.includes(field)) return socialsOf(a)[field] ?? null;
  return (a[COLUMN[field] as keyof AccountValues] as string | null) ?? null;
}

const getAccount = (db: Db, id: number) =>
  db
    .prepare('SELECT id, name, phone, contact_name, address, email, website, legal_name, socials, verify_status FROM accounts WHERE id = ?')
    .get(id) as AccountValues | undefined;

/** Writes one field, keeping the account's own leads in step (imported PIC name and phone). */
function setField(db: Db, accountId: number, field: AgentField, value: string): void {
  const a = getAccount(db, accountId);
  if (!a) return;
  const old = currentValue(a, field);
  if (SOCIAL_FIELDS.includes(field)) {
    const socials = { ...socialsOf(a), [field]: value };
    db.prepare('UPDATE accounts SET socials = ? WHERE id = ?').run(JSON.stringify(socials), accountId);
    return;
  }
  db.prepare(`UPDATE accounts SET ${COLUMN[field]} = ? WHERE id = ?`).run(value, accountId);
  if (field === 'phone') {
    db.prepare('UPDATE leads SET phone = ? WHERE account_id = ? AND (phone IS NULL OR phone = ?)').run(value, accountId, old ?? '');
  } else if (field === 'contact_name') {
    db.prepare('UPDATE leads SET name = ? WHERE account_id = ? AND (name = ? OR name = ?)').run(value, accountId, old ?? '', a.name);
  } else if (field === 'email') {
    db.prepare('UPDATE leads SET email = ? WHERE account_id = ? AND (email IS NULL OR email = ?)').run(value, accountId, old ?? '');
  }
}

/** Once nothing is left to review for an account, "changes found" becomes "verified". */
function settleStatus(db: Db, accountId: number): void {
  const open = (db.prepare(`SELECT COUNT(*) AS n FROM agent_findings WHERE account_id = ? AND status = 'pending'`).get(accountId) as { n: number }).n;
  if (!open) db.prepare(`UPDATE accounts SET verify_status = 'ok' WHERE id = ? AND verify_status = 'changed'`).run(accountId);
}

// ---------- Recording a cycle ----------

const SIZE_SALES = { large: 1_000_000, medium: 300_000, small: 0 } as const;

function duplicateOf(db: Db, c: Candidate): boolean {
  const key = nameKey(c.name);
  const phone = normPhone(c.phone);
  const site = c.website ? valueKey('website', c.website) : null;
  const rows = db.prepare('SELECT name, phone, website FROM accounts').all() as { name: string; phone: string | null; website: string | null }[];
  for (const r of rows) {
    if (key && nameKey(r.name) === key) return true;
    if (phone && normPhone(r.phone) === phone) return true;
    if (site && r.website && valueKey('website', r.website) === site) return true;
  }
  const found = db.prepare(`SELECT payload FROM agent_findings WHERE kind = 'new_lead' AND status <> 'superseded'`).all() as { payload: string }[];
  for (const f of found) {
    try {
      const p = JSON.parse(f.payload) as Candidate;
      if (nameKey(p.name) === key || (phone && normPhone(p.phone) === phone)) return true;
    } catch {
      /* ignore */
    }
  }
  return false;
}

/** Saves one cycle: findings, auto-filled empty fields and each account's check date. */
export function recordRun(db: Db, body: unknown): AgentRunSummary {
  const input = body as AgentRunInput;
  if (!input || typeof input !== 'object' || !Array.isArray(input.results) || !Array.isArray(input.candidates)) {
    throw new HttpError(400, 'Invalid agent run');
  }
  const when = typeof input.finished_at === 'string' && input.finished_at ? input.finished_at : new Date().toISOString();
  const settings = getSettings(db);
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

  return tx(db, () => {
    const run = db
      .prepare(
        `INSERT INTO agent_runs (kind, started_at, finished_at, model, calls, checked, found, searches, input_tokens, output_tokens, error)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      )
      .run(
        ['verify', 'discover', 'cycle'].includes(input.kind) ? input.kind : 'cycle',
        typeof input.started_at === 'string' ? input.started_at : when,
        when,
        typeof input.model === 'string' ? input.model.slice(0, 60) : null,
        n(input.calls),
        input.results.length,
        n(input.searches),
        n(input.input_tokens),
        n(input.output_tokens),
        typeof input.error === 'string' ? input.error.slice(0, 1000) : null,
      );
    const runId = Number(run.lastInsertRowid);
    const insFinding = db.prepare(
      `INSERT INTO agent_findings (run_id, kind, account_id, field, old_value, new_value, payload, confidence, sources, note, status, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const summary: AgentRunSummary = { run_id: runId, checked: 0, findings: 0, auto: 0, confirmed: 0, new_leads: 0, duplicates: 0 };

    for (const r of input.results) {
      const a = getAccount(db, Number(r?.account_id));
      if (!a) continue;
      summary.checked++;
      let changed = false;
      for (const field of AGENT_FIELDS) {
        const f = r.fields?.[field];
        if (!f) continue;
        const value = cleanValue(field, f.value);
        const source = cleanUrl(f.source);
        if (!value || !source) continue;
        const confidence = ['high', 'medium', 'low'].includes(f.confidence) ? f.confidence : 'low';
        const cur = currentValue(a, field);
        const key = valueKey(field, value);
        if (valueKey(field, cur) === key) {
          summary.confirmed++;
          continue;
        }
        // Never propose the same value twice, or one a person already turned down.
        const earlier = db
          .prepare(`SELECT id, new_value, status FROM agent_findings WHERE account_id = ? AND field = ? AND status IN ('pending', 'rejected')`)
          .all(a.id, field) as { id: number; new_value: string; status: string }[];
        if (earlier.some((e) => valueKey(field, e.new_value) === key)) continue;
        for (const e of earlier) {
          if (e.status === 'pending') db.prepare(`UPDATE agent_findings SET status = 'superseded', decided_at = ? WHERE id = ?`).run(when, e.id);
        }
        const auto = settings.autoFillEmpty && !cur && confidence === 'high';
        if (auto) {
          setField(db, a.id, field, value);
          summary.auto++;
        } else {
          changed = true;
          summary.findings++;
        }
        insFinding.run(runId, 'update', a.id, field, cur, value, null, confidence, JSON.stringify([source]), null, auto ? 'auto' : 'pending', when, auto ? when : null);
      }
      const closedSource = r.operating === 'no' ? cleanUrl(r.operating_source) ?? cleanSources(r.sources)[0] ?? null : null;
      if (closedSource) {
        const open = db.prepare(`SELECT 1 FROM agent_findings WHERE account_id = ? AND kind = 'closed' AND status IN ('pending', 'rejected')`).get(a.id);
        if (!open) {
          insFinding.run(runId, 'closed', a.id, null, null, null, null, 'medium', JSON.stringify([closedSource]), r.summary || null, 'pending', when, null);
          summary.findings++;
        }
      }
      const status = r.found === false ? 'not_found' : closedSource ? 'closed' : changed ? 'changed' : 'ok';
      db.prepare('UPDATE accounts SET verified_at = ?, verify_status = ?, agent_note = ? WHERE id = ?').run(
        when,
        a.verify_status === 'closed' ? 'closed' : status,
        typeof r.summary === 'string' && r.summary ? r.summary.slice(0, 600) : null,
        a.id,
      );
      if (!changed) settleStatus(db, a.id);
    }

    for (const c of input.candidates) {
      if (!c || typeof c.name !== 'string' || !c.name.trim()) continue;
      if (duplicateOf(db, c)) {
        summary.duplicates++;
        continue;
      }
      insFinding.run(
        runId,
        'new_lead',
        null,
        null,
        null,
        c.name.slice(0, 160),
        JSON.stringify(c),
        ['high', 'medium', 'low'].includes(c.confidence) ? c.confidence : 'low',
        JSON.stringify(cleanSources(c.sources)),
        typeof c.why === 'string' ? c.why.slice(0, 300) : null,
        'pending',
        when,
        null,
      );
      summary.new_leads++;
    }

    db.prepare('UPDATE agent_runs SET found = ? WHERE id = ?').run(summary.findings + summary.auto + summary.new_leads, runId);
    return summary;
  });
}

// ---------- Deciding ----------

type Decision = 'accepted' | 'rejected';

function acceptNewLead(db: Db, payload: string, today: string): number {
  const c = JSON.parse(payload) as Candidate;
  const record: CrmRecord = {
    name: c.name,
    category: existingCategoryOr(db, c.category),
    company: c.legal_name ?? undefined,
    region: [c.area, c.state].filter(Boolean).join(', ') || undefined,
    primaryRegion: c.state ?? c.area ?? undefined,
    owner: c.contact_name ?? undefined,
    phone: c.phone ?? undefined,
    ratingValue: c.rating ?? undefined,
    salesValue: c.size ? SIZE_SALES[c.size] : 0,
    website: c.website ?? undefined,
    facebook: c.facebook ?? undefined,
    instagram: c.instagram ?? undefined,
    tiktok: c.tiktok ?? undefined,
    source: `Ejen AI · ${today}`,
  };
  return prospectInserter(db, today)(record, { address: c.address, email: c.email });
}

function decideOne(db: Db, id: number, status: Decision, now: string, today: string): void {
  const f = db.prepare('SELECT * FROM agent_findings WHERE id = ?').get(id) as unknown as AgentFindingDb | undefined;
  if (!f) throw new HttpError(404, 'Not found');
  if (f.status !== 'pending') return; // already decided (e.g. a second device)
  let accountId = f.account_id;
  if (status === 'accepted') {
    if (f.kind === 'update' && f.account_id && f.field && f.new_value) {
      setField(db, f.account_id, f.field as AgentField, f.new_value);
    } else if (f.kind === 'closed' && f.account_id) {
      db.prepare(`UPDATE accounts SET verify_status = 'closed' WHERE id = ?`).run(f.account_id);
      db.prepare(`UPDATE leads SET status = 'disqualified' WHERE account_id = ? AND status IN ('new', 'mql', 'sql')`).run(f.account_id);
    } else if (f.kind === 'new_lead' && f.payload) {
      accountId = acceptNewLead(db, f.payload, today);
      db.prepare(`UPDATE accounts SET verified_at = ?, verify_status = 'ok', agent_note = ? WHERE id = ?`).run(now, f.note, accountId);
    }
  } else if (f.kind === 'closed' && f.account_id) {
    // Still open after all: back to a normal status.
    db.prepare(`UPDATE accounts SET verify_status = 'ok' WHERE id = ? AND verify_status = 'closed'`).run(f.account_id);
  }
  db.prepare('UPDATE agent_findings SET status = ?, decided_at = ?, account_id = ? WHERE id = ?').run(status, now, accountId, id);
  if (f.kind === 'update' && f.account_id) settleStatus(db, f.account_id);
}

interface AgentFindingDb {
  id: number;
  kind: string;
  account_id: number | null;
  field: string | null;
  new_value: string | null;
  payload: string | null;
  note: string | null;
  status: string;
}

const decision = (v: unknown): Decision => {
  if (v === 'accepted' || v === 'rejected') return v;
  throw new HttpError(400, 'Validation failed', { fields: { status: 'invalid' } });
};

export function decide(db: Db, id: number, body: unknown, now: string, today: string): AgentFindingRow {
  const status = decision((body as { status?: unknown })?.status);
  tx(db, () => decideOne(db, id, status, now, today));
  return getFinding(db, id);
}

export function decideMany(db: Db, body: unknown, now: string, today: string): { decided: number } {
  const b = (body ?? {}) as { ids?: unknown; status?: unknown };
  const status = decision(b.status);
  const ids = Array.isArray(b.ids) ? b.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 500) : [];
  tx(db, () => {
    for (const id of ids) decideOne(db, id, status, now, today);
  });
  return { decided: ids.length };
}

// ---------- Reading ----------

const FINDING_SQL = `SELECT f.*, a.name AS account_name FROM agent_findings f LEFT JOIN accounts a ON a.id = f.account_id`;

function toRow(r: Record<string, unknown>): AgentFindingRow {
  const parse = <T,>(v: unknown, d: T): T => {
    try {
      return typeof v === 'string' ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  };
  return { ...(r as unknown as AgentFindingRow), sources: parse(r.sources, []), payload: parse(r.payload, null) };
}

export function getFinding(db: Db, id: number): AgentFindingRow {
  const r = db.prepare(`${FINDING_SQL} WHERE f.id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!r) throw new HttpError(404, 'Not found');
  return toRow(r);
}

export function listFindings(db: Db, q: Query): Paged<AgentFindingRow> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const status = typeof q.status === 'string' ? q.status : 'pending';
  if (status === 'decided') where.push(`f.status IN ('accepted', 'rejected', 'auto')`);
  else {
    where.push('f.status = ?');
    params.push(status);
  }
  if (typeof q.kind === 'string' && ['update', 'closed', 'new_lead'].includes(q.kind)) {
    where.push('f.kind = ?');
    params.push(q.kind);
  }
  if (q.accountId) {
    where.push('f.account_id = ?');
    params.push(Number(q.accountId));
  }
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 50));
  const sql = `${FINDING_SQL} WHERE ${where.join(' AND ')}`;
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
  const rows = db
    .prepare(`${sql} ORDER BY CASE f.confidence WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, f.id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as Record<string, unknown>[];
  return { rows: rows.map(toRow), total, page, pageSize };
}

export function listRuns(db: Db, q: Query): AgentRunRow[] {
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  return db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT ?').all(limit) as unknown as AgentRunRow[];
}

export function summary(db: Db, today: string, serverAgent: boolean): AgentSummary {
  const settings = getSettings(db);
  const count = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const due = daysBefore(today, settings.reverifyDays);
  const byStatus = (s: string) => count(`SELECT COUNT(*) AS n FROM agent_findings WHERE status = ?`, s);
  const pendingKind = (k: string) => count(`SELECT COUNT(*) AS n FROM agent_findings WHERE status = 'pending' AND kind = ?`, k);
  const last = db.prepare('SELECT * FROM agent_runs ORDER BY id DESC LIMIT 1').get() as unknown as AgentRunRow | undefined;
  const tokens = db
    .prepare(`SELECT COALESCE(SUM(input_tokens), 0) AS i, COALESCE(SUM(output_tokens), 0) AS o, COALESCE(SUM(searches), 0) AS s FROM agent_runs WHERE substr(started_at, 1, 10) = ?`)
    .get(today) as { i: number; o: number; s: number };
  return {
    settings,
    serverAgent,
    findings: {
      pending: byStatus('pending'),
      updates: pendingKind('update'),
      closed: pendingKind('closed'),
      newLeads: pendingKind('new_lead'),
      accepted: byStatus('accepted'),
      rejected: byStatus('rejected'),
      auto: byStatus('auto'),
    },
    accounts: {
      total: count('SELECT COUNT(*) AS n FROM accounts'),
      verified: count('SELECT COUNT(*) AS n FROM accounts WHERE verified_at IS NOT NULL'),
      due: count(`SELECT COUNT(*) AS n FROM accounts WHERE (verified_at IS NULL OR substr(verified_at, 1, 10) <= ?) AND COALESCE(verify_status, '') <> 'closed'`, due),
      closed: count(`SELECT COUNT(*) AS n FROM accounts WHERE verify_status = 'closed'`),
      notFound: count(`SELECT COUNT(*) AS n FROM accounts WHERE verify_status = 'not_found'`),
      fromAgent: count(`SELECT COUNT(*) AS n FROM accounts WHERE source LIKE 'Ejen AI%'`),
    },
    today: { calls: callsOn(db, today), limit: settings.dailyCalls, searches: tokens.s, inputTokens: tokens.i, outputTokens: tokens.o },
    lastRun: last ?? null,
  };
}
