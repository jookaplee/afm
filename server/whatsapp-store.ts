// WhatsApp outreach: the leads that can be messaged, templates, settings and
// the log of messages opened from the dashboard. Sending happens in the
// user's own WhatsApp through a wa.me link; recording a message marks a new
// lead as contacted.

import { tx, type Db } from './schema.ts';
import { HttpError, type Query } from './http.ts';
import { INDUSTRIES, REGIONS, SEGMENTS } from '../shared/constants.ts';
import { normalizeWaSettings, phoneInfo, type WaSettings } from '../shared/whatsapp.ts';
import type { Paged, WaContact, WaMessageRow, WaSummary, WaTemplate } from '../shared/types.ts';

// ---------- Settings ----------

export function getSettings(db: Db): WaSettings {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'wa_settings'`).get() as { value: string } | undefined;
  try {
    return normalizeWaSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return normalizeWaSettings({});
  }
}

export function putSettings(db: Db, body: unknown): WaSettings {
  const next = normalizeWaSettings({ ...getSettings(db), ...(body && typeof body === 'object' ? body : {}) });
  db.prepare(`INSERT INTO meta (key, value) VALUES ('wa_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next));
  return next;
}

// ---------- Templates ----------

function templateInput(body: unknown): { name: string; body: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  const fields: Record<string, string> = {};
  if (!name) fields.name = 'required';
  else if (name.length > 60) fields.name = 'tooLong';
  if (!text) fields.body = 'required';
  else if (text.length > 1000) fields.body = 'tooLong';
  if (Object.keys(fields).length) throw new HttpError(400, 'Validation failed', { fields });
  return { name, body: text };
}

export const listTemplates = (db: Db): WaTemplate[] => db.prepare('SELECT * FROM wa_templates ORDER BY id').all() as unknown as WaTemplate[];

function getTemplate(db: Db, id: number): WaTemplate {
  const t = db.prepare('SELECT * FROM wa_templates WHERE id = ?').get(id) as unknown as WaTemplate | undefined;
  if (!t) throw new HttpError(404, 'Not found');
  return t;
}

export function createTemplate(db: Db, body: unknown, today: string): WaTemplate {
  const t = templateInput(body);
  const r = db.prepare('INSERT INTO wa_templates (name, body, created_at) VALUES (?, ?, ?)').run(t.name, t.body, today);
  return getTemplate(db, Number(r.lastInsertRowid));
}

export function updateTemplate(db: Db, id: number, body: unknown): WaTemplate {
  getTemplate(db, id);
  const t = templateInput(body);
  db.prepare('UPDATE wa_templates SET name = ?, body = ? WHERE id = ?').run(t.name, t.body, id);
  return getTemplate(db, id);
}

export function deleteTemplate(db: Db, id: number): void {
  getTemplate(db, id);
  db.prepare('DELETE FROM wa_templates WHERE id = ?').run(id);
}

// ---------- Contacts ----------

interface ContactDb extends Omit<WaContact, 'intl' | 'phone_type' | 'shared'> {}

function loadContacts(db: Db): WaContact[] {
  const rows = db
    .prepare(
      `SELECT l.id AS lead_id, l.name, l.company, l.account_id, a.area, a.agent_note AS note, l.region, l.segment, l.industry, l.status, l.score,
         r.name AS owner_name, l.phone, l.wa_status, l.wa_replied_at,
         (SELECT COUNT(*) FROM wa_messages m WHERE m.lead_id = l.id) AS sent_count,
         (SELECT MAX(created_at) FROM wa_messages m WHERE m.lead_id = l.id) AS last_sent_at,
         (SELECT t.name FROM wa_messages m LEFT JOIN wa_templates t ON t.id = m.template_id
            WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS last_template,
         (SELECT m.body FROM wa_messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS last_body
       FROM leads l
       LEFT JOIN accounts a ON a.id = l.account_id
       LEFT JOIN reps r ON r.id = l.owner_id
       WHERE l.phone IS NOT NULL AND TRIM(l.phone) <> ''`,
    )
    .all() as unknown as ContactDb[];
  const byDigits = new Map<string, number>();
  const info = rows.map((r) => phoneInfo(r.phone));
  for (const i of info) if (i.digits) byDigits.set(i.digits, (byDigits.get(i.digits) ?? 0) + 1);
  return rows.map((r, k) => ({
    ...r,
    intl: info[k].intl,
    phone_type: info[k].type,
    shared: info[k].digits ? (byDigits.get(info[k].digits!) ?? 1) - 1 : 0,
  }));
}

const str = (q: Query, k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);

/**
 * Leads with a phone number. Filters: `stage` (todo = not messaged yet and still
 * open, sent, replied, all), `type` (mobile, landline, invalid), `wa` (yes, no,
 * unknown), `region`, `segment`, `industry`, `search`.
 */
export function listContacts(db: Db, q: Query): Paged<WaContact> {
  let rows = loadContacts(db);
  const leadId = Number(q.lead_id);
  if (Number.isInteger(leadId) && leadId > 0) rows = rows.filter((r) => r.lead_id === leadId);
  const stage = str(q, 'stage') ?? 'all';
  if (stage === 'todo') rows = rows.filter((r) => !r.sent_count && !['converted', 'disqualified'].includes(r.status) && r.wa_status !== 'no');
  else if (stage === 'sent') rows = rows.filter((r) => r.sent_count > 0 && !r.wa_replied_at);
  else if (stage === 'replied') rows = rows.filter((r) => !!r.wa_replied_at);
  const type = str(q, 'type');
  if (type === 'mobile' || type === 'landline' || type === 'invalid') rows = rows.filter((r) => r.phone_type === type);
  else if (type === 'chat') rows = rows.filter((r) => !!r.intl);
  const wa = str(q, 'wa');
  if (wa === 'yes' || wa === 'no') rows = rows.filter((r) => r.wa_status === wa);
  else if (wa === 'unknown') rows = rows.filter((r) => !r.wa_status);
  const region = str(q, 'region');
  if (region && (REGIONS as readonly string[]).includes(region)) rows = rows.filter((r) => r.region === region);
  const segment = str(q, 'segment');
  if (segment && (SEGMENTS as readonly string[]).includes(segment)) rows = rows.filter((r) => r.segment === segment);
  const industry = str(q, 'industry');
  if (industry && (INDUSTRIES as readonly string[]).includes(industry)) rows = rows.filter((r) => r.industry === industry);
  const search = str(q, 'search')?.toLowerCase().trim();
  if (search) {
    const digits = search.replace(/\D/g, '');
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(search) || r.company.toLowerCase().includes(search) || (digits.length >= 3 && r.phone.replace(/\D/g, '').includes(digits)),
    );
  }
  // Like a chat list: the latest conversations first, then the best prospects.
  const sort = str(q, 'sort') ?? (stage === 'todo' ? 'score' : 'activity');
  const lastActivity = (r: WaContact) => [r.wa_replied_at, r.last_sent_at].filter(Boolean).sort().pop() ?? '';
  rows.sort((a, b) =>
    sort === 'activity'
      ? lastActivity(b).localeCompare(lastActivity(a)) || b.score - a.score || a.lead_id - b.lead_id
      : sort === 'name'
        ? a.company.localeCompare(b.company)
        : b.score - a.score || a.lead_id - b.lead_id,
  );
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(1000, Math.max(1, Number(q.pageSize) || 25));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize };
}

export function summary(db: Db, today: string): WaSummary {
  const rows = loadContacts(db);
  const count = (sql: string, ...p: string[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  return {
    settings: getSettings(db),
    withPhone: rows.length,
    mobile: rows.filter((r) => r.phone_type === 'mobile').length,
    landline: rows.filter((r) => r.phone_type === 'landline').length,
    invalid: rows.filter((r) => r.phone_type === 'invalid').length,
    shared: rows.filter((r) => r.shared > 0).length,
    waYes: rows.filter((r) => r.wa_status === 'yes').length,
    waNo: rows.filter((r) => r.wa_status === 'no').length,
    // Mobiles, plus landlines confirmed to have WhatsApp, not messaged yet and still open.
    todo: rows.filter(
      (r) => r.intl && (r.phone_type === 'mobile' || r.wa_status === 'yes') && !r.sent_count && !['converted', 'disqualified'].includes(r.status) && r.wa_status !== 'no',
    ).length,
    contacted: rows.filter((r) => r.sent_count > 0).length,
    replied: rows.filter((r) => !!r.wa_replied_at).length,
    messages: count('SELECT COUNT(*) AS n FROM wa_messages'),
    messagesToday: count('SELECT COUNT(*) AS n FROM wa_messages WHERE substr(created_at, 1, 10) = ?', today),
  };
}

// ---------- Messages ----------

const stamp = (body: unknown) => {
  const at = (body as { at?: unknown } | null)?.at;
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? at : new Date().toISOString();
};

/**
 * Records a message opened in WhatsApp. A lead that was still "new" becomes
 * "contacted" (mql), as if it had been marked by hand.
 */
export function recordMessage(db: Db, body: unknown, today: string): WaMessageRow {
  const b = (body ?? {}) as Record<string, unknown>;
  const leadId = Number(b.lead_id);
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  const fields: Record<string, string> = {};
  if (!Number.isInteger(leadId) || leadId < 1) fields.lead_id = 'required';
  if (!text) fields.body = 'required';
  else if (text.length > 2000) fields.body = 'tooLong';
  if (Object.keys(fields).length) throw new HttpError(400, 'Validation failed', { fields });
  const lead = db.prepare('SELECT id, account_id, phone, status FROM leads WHERE id = ?').get(leadId) as
    | { id: number; account_id: number | null; phone: string | null; status: string }
    | undefined;
  if (!lead) throw new HttpError(404, 'Not found');
  const info = phoneInfo(lead.phone);
  if (!info.intl) throw new HttpError(400, 'Validation failed', { fields: { phone: 'invalid' } });
  const templateId = Number(b.template_id);
  const tpl = Number.isInteger(templateId) && templateId > 0 ? (db.prepare('SELECT id FROM wa_templates WHERE id = ?').get(templateId) as { id: number } | undefined) : undefined;
  const at = stamp(body);
  return tx(db, () => {
    const r = db
      .prepare('INSERT INTO wa_messages (lead_id, account_id, phone, body, template_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(lead.id, lead.account_id, lead.phone!, text, tpl?.id ?? null, at);
    if (lead.status === 'new') db.prepare(`UPDATE leads SET status = 'mql', mql_at = COALESCE(mql_at, ?) WHERE id = ?`).run(today, lead.id);
    return getMessage(db, Number(r.lastInsertRowid));
  });
}

const MESSAGE_SQL = `SELECT m.*, t.name AS template_name, l.name AS lead_name, l.company
  FROM wa_messages m LEFT JOIN wa_templates t ON t.id = m.template_id LEFT JOIN leads l ON l.id = m.lead_id`;

function getMessage(db: Db, id: number): WaMessageRow {
  return db.prepare(`${MESSAGE_SQL} WHERE m.id = ?`).get(id) as unknown as WaMessageRow;
}

export function listMessages(db: Db, q: Query): Paged<WaMessageRow> {
  const where: string[] = [];
  const params: number[] = [];
  if (q.lead_id) {
    where.push('m.lead_id = ?');
    params.push(Number(q.lead_id));
  }
  if (q.account_id) {
    where.push('m.account_id = ?');
    params.push(Number(q.account_id));
  }
  const sql = `${MESSAGE_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${sql} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as WaMessageRow[];
  return { rows, total, page, pageSize };
}

/** Marks whether a lead's number has WhatsApp and whether the lead replied. */
export function updateLeadWa(db: Db, id: number, body: unknown): { lead_id: number; wa_status: string | null; wa_replied_at: string | null } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!db.prepare('SELECT 1 FROM leads WHERE id = ?').get(id)) throw new HttpError(404, 'Not found');
  if ('wa_status' in b) {
    const v = b.wa_status;
    if (v !== null && v !== 'yes' && v !== 'no') throw new HttpError(400, 'Validation failed', { fields: { wa_status: 'invalid' } });
    db.prepare('UPDATE leads SET wa_status = ? WHERE id = ?').run(v as string | null, id);
  }
  if ('replied' in b) {
    db.prepare('UPDATE leads SET wa_replied_at = ? WHERE id = ?').run(b.replied ? stamp(body) : null, id);
    // Replying on WhatsApp proves the number has it.
    if (b.replied) db.prepare(`UPDATE leads SET wa_status = 'yes' WHERE id = ?`).run(id);
  }
  return db.prepare('SELECT id AS lead_id, wa_status, wa_replied_at FROM leads WHERE id = ?').get(id) as {
    lead_id: number;
    wa_status: string | null;
    wa_replied_at: string | null;
  };
}
