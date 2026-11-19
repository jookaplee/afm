// WhatsApp outreach: the leads that can be messaged, templates, settings and
// the log of messages opened from the dashboard. Sending happens in the
// user's own WhatsApp through a wa.me link; recording a message marks a new
// lead as contacted.

import { tx, type Db } from './schema.ts';
import { HttpError, type Query } from './http.ts';
import { REGIONS, SEGMENTS } from '../shared/constants.ts';
import {
  normalizeWaAgentSettings,
  normalizeWaSettings,
  phoneInfo,
  type WaAgentContext,
  type WaAgentSettings,
  type WaSettings,
} from '../shared/whatsapp.ts';
import { normPhone } from '../shared/agent.ts';
import { regionOf } from './import-crm.ts';
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

// ---------- Agent settings ----------

export function getAgentSettings(db: Db): WaAgentSettings {
  const row = db.prepare(`SELECT value FROM meta WHERE key = 'wa_agent'`).get() as { value: string } | undefined;
  try {
    return normalizeWaAgentSettings(row ? JSON.parse(row.value) : {});
  } catch {
    return normalizeWaAgentSettings({});
  }
}

export function putAgentSettings(db: Db, body: unknown): WaAgentSettings {
  const next = normalizeWaAgentSettings({ ...getAgentSettings(db), ...(body && typeof body === 'object' ? body : {}) });
  db.prepare(`INSERT INTO meta (key, value) VALUES ('wa_agent', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(next));
  return next;
}

// ---------- Contacts ----------

interface ContactDb extends Omit<WaContact, 'intl' | 'phone_type' | 'shared'> {}

// "Sent" counts messages that really left (drafts waiting for approval do not).
const SENT = `m.direction = 'out' AND m.status <> 'draft'`;

function loadContacts(db: Db): WaContact[] {
  const rows = db
    .prepare(
      `SELECT l.id AS lead_id, l.name, l.company, l.account_id, a.area, a.agent_note AS note, l.region, l.segment, l.industry, l.business_id, l.status, l.score,
         r.name AS owner_name, l.phone, l.wa_status, l.wa_replied_at, l.wa_unread, l.wa_needs_human, l.wa_human_reason, l.wa_agent_off, l.wa_last_in_at,
         (SELECT COUNT(*) FROM wa_messages m WHERE m.lead_id = l.id AND ${SENT}) AS sent_count,
         (SELECT MAX(created_at) FROM wa_messages m WHERE m.lead_id = l.id AND ${SENT}) AS last_sent_at,
         (SELECT COUNT(*) FROM wa_messages m WHERE m.lead_id = l.id AND m.status = 'draft') AS drafts,
         (SELECT t.name FROM wa_messages m LEFT JOIN wa_templates t ON t.id = m.template_id
            WHERE m.lead_id = l.id AND ${SENT} ORDER BY m.id DESC LIMIT 1) AS last_template,
         lm.body AS last_body, lm.direction AS last_direction, lm.author AS last_author, lm.status AS last_status, lm.created_at AS last_at
       FROM leads l
       LEFT JOIN accounts a ON a.id = l.account_id
       LEFT JOIN reps r ON r.id = l.owner_id
       LEFT JOIN wa_messages lm ON lm.id = (SELECT MAX(id) FROM wa_messages m WHERE m.lead_id = l.id)
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
 * open, sent, replied, unread, human = needs staff, all), `type` (mobile,
 * landline, invalid, chat), `wa` (yes, no, unknown), `region`, `segment`,
 * `industry`, `business`, `search`, `lead_id`.
 */
export function listContacts(db: Db, q: Query): Paged<WaContact> {
  let rows = loadContacts(db);
  const leadId = Number(q.lead_id);
  if (Number.isInteger(leadId) && leadId > 0) rows = rows.filter((r) => r.lead_id === leadId);
  const stage = str(q, 'stage') ?? 'all';
  if (stage === 'todo') rows = rows.filter((r) => !r.sent_count && !r.wa_last_in_at && !['converted', 'disqualified'].includes(r.status) && r.wa_status !== 'no');
  else if (stage === 'sent') rows = rows.filter((r) => r.sent_count > 0 && !r.wa_replied_at);
  else if (stage === 'replied') rows = rows.filter((r) => !!r.wa_replied_at);
  else if (stage === 'unread') rows = rows.filter((r) => r.wa_unread > 0);
  else if (stage === 'human') rows = rows.filter((r) => !!r.wa_needs_human);
  const type = str(q, 'type');
  // Conversations a customer started stay visible whatever the number filter.
  if (type === 'mobile' || type === 'landline' || type === 'invalid') rows = rows.filter((r) => r.phone_type === type || !!r.wa_last_in_at);
  else if (type === 'chat') rows = rows.filter((r) => !!r.intl);
  const wa = str(q, 'wa');
  if (wa === 'yes' || wa === 'no') rows = rows.filter((r) => r.wa_status === wa);
  else if (wa === 'unknown') rows = rows.filter((r) => !r.wa_status);
  const region = str(q, 'region');
  if (region && (REGIONS as readonly string[]).includes(region)) rows = rows.filter((r) => r.region === region);
  const segment = str(q, 'segment');
  if (segment && (SEGMENTS as readonly string[]).includes(segment)) rows = rows.filter((r) => r.segment === segment);
  const industry = str(q, 'industry');
  if (industry) rows = rows.filter((r) => r.industry === industry);
  const business = Number(q.business);
  if (Number.isInteger(business) && business > 0) rows = rows.filter((r) => r.business_id === business);
  const search = str(q, 'search')?.toLowerCase().trim();
  if (search) {
    const digits = search.replace(/\D/g, '');
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(search) || r.company.toLowerCase().includes(search) || (digits.length >= 3 && r.phone.replace(/\D/g, '').includes(digits)),
    );
  }
  // Like a chat list: the latest conversations first, then the best prospects.
  const sort = str(q, 'sort') ?? (stage === 'todo' ? 'score' : 'activity');
  const lastActivity = (r: WaContact) => [r.wa_replied_at, r.last_sent_at, r.last_at].filter(Boolean).sort().pop() ?? '';
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

export function summary(db: Db, today: string, flags: { live: boolean; agentServer: boolean } = { live: false, agentServer: false }): WaSummary {
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
      (r) =>
        r.intl &&
        (r.phone_type === 'mobile' || r.wa_status === 'yes') &&
        !r.sent_count &&
        !r.wa_last_in_at &&
        !['converted', 'disqualified'].includes(r.status) &&
        r.wa_status !== 'no',
    ).length,
    contacted: rows.filter((r) => r.sent_count > 0).length,
    replied: rows.filter((r) => !!r.wa_replied_at).length,
    messages: count(`SELECT COUNT(*) AS n FROM wa_messages m WHERE ${SENT}`),
    messagesToday: count(`SELECT COUNT(*) AS n FROM wa_messages m WHERE ${SENT} AND substr(created_at, 1, 10) = ?`, today),
    unread: rows.filter((r) => r.wa_unread > 0).length,
    needsHuman: rows.filter((r) => !!r.wa_needs_human).length,
    drafts: count(`SELECT COUNT(*) AS n FROM wa_messages WHERE status = 'draft'`),
    live: flags.live,
    agentServer: flags.agentServer,
  };
}

// ---------- Messages ----------

const stamp = (body: unknown) => {
  const at = (body as { at?: unknown } | null)?.at;
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? at : new Date().toISOString();
};

const OUT_STATUSES = ['opened', 'draft', 'queued', 'sent', 'delivered', 'read', 'failed'] as const;

/** A lead that was still "new" becomes "contacted" (mql) once something was actually sent. */
function markContacted(db: Db, leadId: number, today: string) {
  db.prepare(`UPDATE leads SET status = 'mql', mql_at = COALESCE(mql_at, ?) WHERE id = ? AND status = 'new'`).run(today, leadId);
}

/**
 * Records an outgoing message: opened in WhatsApp through wa.me (`opened`), sent
 * through the Business API (`queued`/`sent`), or an agent reply waiting for
 * approval (`draft`).
 */
export function recordMessage(db: Db, body: unknown, today: string): WaMessageRow {
  const b = (body ?? {}) as Record<string, unknown>;
  const leadId = Number(b.lead_id);
  const text = typeof b.body === 'string' ? b.body.trim() : '';
  const fields: Record<string, string> = {};
  if (!Number.isInteger(leadId) || leadId < 1) fields.lead_id = 'required';
  if (!text) fields.body = 'required';
  else if (text.length > 4000) fields.body = 'tooLong';
  const status = (b.status ?? 'opened') as string;
  if (!(OUT_STATUSES as readonly string[]).includes(status)) fields.status = 'invalid';
  const author = b.author === 'agent' ? 'agent' : 'user';
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
      .prepare(
        `INSERT INTO wa_messages (lead_id, account_id, phone, body, template_id, created_at, direction, author, status, wa_id, error)
         VALUES (?, ?, ?, ?, ?, ?, 'out', ?, ?, ?, NULL)`,
      )
      .run(lead.id, lead.account_id, lead.phone!, text, tpl?.id ?? null, at, author, status, typeof b.wa_id === 'string' ? b.wa_id.slice(0, 200) : null);
    if (status !== 'draft') markContacted(db, lead.id, today);
    // Someone answered: the conversation has been read.
    if (status !== 'draft') db.prepare('UPDATE leads SET wa_unread = 0 WHERE id = ?').run(lead.id);
    return getMessage(db, Number(r.lastInsertRowid));
  });
}

/** Finds the lead for a number, or creates one for a customer who wrote in first. */
function leadForPhone(db: Db, phone: string, name: string | null, today: string): number {
  const digits = normPhone(phone);
  if (digits) {
    const rows = db.prepare(`SELECT id, phone FROM leads WHERE phone IS NOT NULL ORDER BY (wa_last_in_at IS NULL), id`).all() as { id: number; phone: string }[];
    const hit = rows.find((r) => normPhone(r.phone) === digits);
    if (hit) return hit.id;
  }
  const display = digits ? `${digits.slice(0, 3)}-${digits.slice(3)}` : phone.slice(0, 40);
  const label = name?.trim().slice(0, 120) || display;
  const r = db
    .prepare(
      `INSERT INTO leads (name, email, phone, title, company, industry, segment, region, channel, campaign_id, status, score, owner_id, account_id, deal_id, created_at)
       VALUES (?, NULL, ?, 'WhatsApp', ?, 'other', 'smb', ?, 'whatsapp', NULL, 'new', 40, NULL, NULL, NULL, ?)`,
    )
    .run(label, display, label, regionOf(undefined), today);
  return Number(r.lastInsertRowid);
}

/**
 * Records a message from a customer (from the Business API webhook, or pasted in
 * by hand). Duplicate webhook deliveries (same `wa_id`) are ignored.
 */
export function recordInbound(db: Db, body: unknown, today: string): { lead_id: number; message: WaMessageRow; duplicate: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  const text = typeof b.body === 'string' ? b.body.trim().slice(0, 4000) : '';
  const waId = typeof b.wa_id === 'string' && b.wa_id ? b.wa_id.slice(0, 200) : null;
  if (!text) throw new HttpError(400, 'Validation failed', { fields: { body: 'required' } });
  if (waId) {
    const dup = db.prepare('SELECT id, lead_id FROM wa_messages WHERE wa_id = ?').get(waId) as { id: number; lead_id: number } | undefined;
    if (dup) return { lead_id: dup.lead_id, message: getMessage(db, dup.id), duplicate: true };
  }
  const at = stamp(body);
  return tx(db, () => {
    let leadId = Number(b.lead_id);
    if (!Number.isInteger(leadId) || leadId < 1 || !db.prepare('SELECT 1 FROM leads WHERE id = ?').get(leadId)) {
      if (typeof b.phone !== 'string' || !b.phone.trim()) throw new HttpError(400, 'Validation failed', { fields: { phone: 'required' } });
      leadId = leadForPhone(db, b.phone, typeof b.name === 'string' ? b.name : null, today);
    }
    const lead = db.prepare('SELECT id, account_id, phone FROM leads WHERE id = ?').get(leadId) as { id: number; account_id: number | null; phone: string };
    const r = db
      .prepare(
        `INSERT INTO wa_messages (lead_id, account_id, phone, body, template_id, created_at, direction, author, status, wa_id, error)
         VALUES (?, ?, ?, ?, NULL, ?, 'in', 'contact', 'received', ?, NULL)`,
      )
      .run(lead.id, lead.account_id, lead.phone, text, at, waId);
    // A message from the customer: unread, replied, and the number has WhatsApp.
    db.prepare(
      `UPDATE leads SET wa_last_in_at = ?, wa_unread = wa_unread + 1, wa_replied_at = COALESCE(wa_replied_at, ?), wa_status = 'yes' WHERE id = ?`,
    ).run(at, at, lead.id);
    return { lead_id: lead.id, message: getMessage(db, Number(r.lastInsertRowid)), duplicate: false };
  });
}

const NEXT_STATUS: Record<string, string[]> = {
  draft: ['opened', 'queued', 'sent', 'failed'],
  queued: ['sent', 'delivered', 'read', 'failed'],
  sent: ['delivered', 'read', 'failed'],
  delivered: ['read'],
  failed: ['queued', 'sent'],
};

/**
 * Edits a draft's text, or moves a message along draft -> opened/queued/sent ->
 * delivered -> read (or failed). Leaving draft stamps the send time.
 */
export function updateMessage(db: Db, id: number, body: unknown, today: string): WaMessageRow {
  const b = (body ?? {}) as Record<string, unknown>;
  const m = getMessage(db, id);
  if (!m) throw new HttpError(404, 'Not found');
  return tx(db, () => {
    if ('body' in b) {
      if (m.status !== 'draft') throw new HttpError(409, 'Only a draft can be edited');
      const text = typeof b.body === 'string' ? b.body.trim() : '';
      if (!text) throw new HttpError(400, 'Validation failed', { fields: { body: 'required' } });
      db.prepare('UPDATE wa_messages SET body = ? WHERE id = ?').run(text.slice(0, 4000), id);
    }
    if (typeof b.wa_id === 'string') db.prepare('UPDATE wa_messages SET wa_id = ? WHERE id = ?').run(b.wa_id.slice(0, 200), id);
    if ('status' in b && b.status !== m.status) {
      const next = String(b.status);
      if (!(NEXT_STATUS[m.status] ?? []).includes(next)) throw new HttpError(400, 'Validation failed', { fields: { status: 'invalid' } });
      db.prepare('UPDATE wa_messages SET status = ?, error = ? WHERE id = ?').run(next, next === 'failed' && typeof b.error === 'string' ? b.error.slice(0, 300) : null, id);
      if (m.status === 'draft' && next !== 'failed') {
        db.prepare('UPDATE wa_messages SET created_at = ? WHERE id = ?').run(stamp(body), id);
        if (m.lead_id) {
          markContacted(db, m.lead_id, today);
          db.prepare('UPDATE leads SET wa_unread = 0 WHERE id = ?').run(m.lead_id);
        }
      }
    }
    return getMessage(db, id);
  });
}

/** Only drafts can be thrown away; sent messages stay on record. */
export function deleteMessage(db: Db, id: number): void {
  const m = getMessage(db, id);
  if (!m) throw new HttpError(404, 'Not found');
  if (m.status !== 'draft') throw new HttpError(409, 'Only a draft can be deleted');
  db.prepare('DELETE FROM wa_messages WHERE id = ?').run(id);
}

/** Business API delivery reports: sent -> delivered -> read, or failed. */
export function updateStatusByWaId(db: Db, waId: string, status: string, error: string | null): void {
  const m = db.prepare('SELECT id, status FROM wa_messages WHERE wa_id = ?').get(waId) as { id: number; status: string } | undefined;
  if (!m) return;
  const order = ['queued', 'sent', 'delivered', 'read'];
  if (status === 'failed') db.prepare(`UPDATE wa_messages SET status = 'failed', error = ? WHERE id = ?`).run(error, m.id);
  else if (order.indexOf(status) > order.indexOf(m.status)) db.prepare('UPDATE wa_messages SET status = ? WHERE id = ?').run(status, m.id);
}

const MESSAGE_SQL = `SELECT m.*, t.name AS template_name, l.name AS lead_name, l.company
  FROM wa_messages m LEFT JOIN wa_templates t ON t.id = m.template_id LEFT JOIN leads l ON l.id = m.lead_id`;

export function getMessage(db: Db, id: number): WaMessageRow {
  return db.prepare(`${MESSAGE_SQL} WHERE m.id = ?`).get(id) as unknown as WaMessageRow;
}

export function listMessages(db: Db, q: Query): Paged<WaMessageRow> {
  const where: string[] = [];
  const params: (number | string)[] = [];
  if (q.lead_id) {
    where.push('m.lead_id = ?');
    params.push(Number(q.lead_id));
  }
  if (q.account_id) {
    where.push('m.account_id = ?');
    params.push(Number(q.account_id));
  }
  if (q.direction === 'in' || q.direction === 'out') {
    where.push('m.direction = ?');
    params.push(q.direction);
  }
  // The log lists what was sent; a conversation also shows drafts and incoming messages.
  if (q.sent === 'true') where.push(`m.direction = 'out' AND m.status <> 'draft'`);
  const sql = `${MESSAGE_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${sql} ORDER BY m.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as WaMessageRow[];
  return { rows, total, page, pageSize };
}

/**
 * Conversation state for a lead: has WhatsApp or not, replied, read, needs a
 * person (with the reason), and the agent switched off for this chat.
 */
export function updateLeadWa(db: Db, id: number, body: unknown): Record<string, unknown> {
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
  if (b.read === true) db.prepare('UPDATE leads SET wa_unread = 0 WHERE id = ?').run(id);
  if ('needs_human' in b) {
    const reason = typeof b.reason === 'string' && b.reason.trim() ? b.reason.trim().slice(0, 300) : null;
    db.prepare('UPDATE leads SET wa_needs_human = ?, wa_human_reason = ? WHERE id = ?').run(b.needs_human ? 1 : 0, b.needs_human ? reason : null, id);
  }
  if ('agent_off' in b) db.prepare('UPDATE leads SET wa_agent_off = ? WHERE id = ?').run(b.agent_off ? 1 : 0, id);
  return db
    .prepare('SELECT id AS lead_id, wa_status, wa_replied_at, wa_unread, wa_needs_human, wa_human_reason, wa_agent_off FROM leads WHERE id = ?')
    .get(id) as Record<string, unknown>;
}

// ---------- Context for the WhatsApp agent ----------

export function agentContext(db: Db, leadId: number, today: string): WaAgentContext {
  const lead = db
    .prepare(
      `SELECT l.id, l.name, l.company, l.phone, l.status, a.area, l.region, l.wa_agent_off AS agent_off, l.wa_needs_human AS needs_human
       FROM leads l LEFT JOIN accounts a ON a.id = l.account_id WHERE l.id = ?`,
    )
    .get(leadId) as WaAgentContext['lead'] | undefined;
  if (!lead) throw new HttpError(404, 'Not found');
  const messages = (
    db
      .prepare(`SELECT direction, author, body, created_at AS at FROM wa_messages WHERE lead_id = ? AND status <> 'draft' ORDER BY created_at DESC, id DESC LIMIT 40`)
      .all(leadId) as WaAgentContext['messages']
  ).reverse();
  const orders = db
    .prepare(
      `SELECT o.id, o.status, o.total_sen, o.delivery_date, o.created_at,
         (SELECT GROUP_CONCAT(i.qty || ' ' || i.unit || ' ' || i.name, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_summary
       FROM orders o WHERE o.lead_id = ? ORDER BY o.id DESC LIMIT 5`,
    )
    .all(leadId) as WaAgentContext['orders'];
  const products = (db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get() as { n: number }).n;
  return { agent: getAgentSettings(db), sender: getSettings(db), today, lead, messages, orders, products };
}
