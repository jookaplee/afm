// Data-management endpoints: deals, leads, campaigns, accounts.

import { tx, type Db } from './schema.ts';
import { HttpError, intParam, oneOf, str, validateBody, type Query, type Schema } from './http.ts';
import { DEAL_ROW_SQL } from './analytics.ts';
import { shortCompany } from './seed.ts';
import {
  ABM_TIERS,
  CAMPAIGN_STATUSES,
  CHANNELS,
  DEAL_TYPES,
  INDUSTRIES,
  LEAD_STATUSES,
  LOST_REASONS,
  OPEN_STAGES,
  PRODUCTS,
  REGIONS,
  REP_ROLES,
  SEGMENTS,
  SOURCES,
  STAGES,
} from '../shared/constants.ts';
import type { Account, AccountDetail, AccountRow, Campaign, Deal, DealRow, Lead, LeadRow, Paged, RepRow } from '../shared/types.ts';

type Params = (string | number | null)[];

function paging(q: Query) {
  const page = intParam(q, 'page', { min: 1 }) ?? 1;
  const pageSize = intParam(q, 'pageSize', { min: 1, max: 5000 }) ?? 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

/** `then` breaks ties before the final id tie-break (e.g. many accounts with no revenue yet). */
function orderBy(q: Query, allowed: Record<string, string>, fallback: string, then?: string): string {
  const sort = str(q, 'sort');
  const dir = str(q, 'dir') === 'asc' ? 'ASC' : 'DESC';
  const col = sort && allowed[sort] ? allowed[sort] : fallback;
  return `ORDER BY ${col} ${dir} NULLS LAST, ${then ? `${then}, ` : ''}id DESC`;
}

function paged<T>(db: Db, baseSql: string, params: Params, order: string, q: Query): Paged<T> {
  const { page, pageSize, offset } = paging(q);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${baseSql})`).get(...params) as { n: number }).n;
  const rows = db.prepare(`SELECT * FROM (${baseSql}) ${order} LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as unknown as T[];
  return { rows, total, page, pageSize };
}

function like(v: string) {
  return `%${v.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function update(db: Db, table: string, id: number, data: Record<string, string | number | null>) {
  const cols = Object.keys(data);
  if (!cols.length) return;
  db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(data), id);
}

function insert(db: Db, table: string, data: Record<string, string | number | null>): number {
  const cols = Object.keys(data);
  const res = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...Object.values(data));
  return Number(res.lastInsertRowid);
}

function mustGet<T>(db: Db, sql: string, id: number, what: string): T {
  const row = db.prepare(sql).get(id) as T | undefined;
  if (!row) throw new HttpError(404, `${what} not found`);
  return row;
}

// ---------- Deals ----------

const dealSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 200 },
  account_id: { type: 'ref', table: 'accounts', required: true },
  owner_id: { type: 'ref', table: 'reps', required: true },
  stage: { type: 'enum', values: STAGES, required: true },
  amount: { type: 'int', required: true, min: 0, max: 1e15 },
  product: { type: 'enum', values: PRODUCTS, required: true },
  type: { type: 'enum', values: DEAL_TYPES, required: true },
  source: { type: 'enum', values: SOURCES, required: true },
  channel: { type: 'enum', values: CHANNELS, nullable: true },
  campaign_id: { type: 'ref', table: 'campaigns', nullable: true },
  expected_close: { type: 'date', required: true },
  lost_reason: { type: 'enum', values: LOST_REASONS, nullable: true },
  next_step: { type: 'string', nullable: true, maxLen: 300 },
};

export function getDeal(db: Db, id: number): DealRow {
  return mustGet<DealRow>(db, `${DEAL_ROW_SQL} WHERE d.id = ?`, id, 'Deal');
}

export function listDeals(db: Db, q: Query): Paged<DealRow> {
  const where: string[] = [];
  const params: Params = [];
  const search = str(q, 'search');
  if (search) {
    where.push('(d.name LIKE ? ESCAPE \'\\\' OR a.name LIKE ? ESCAPE \'\\\')');
    params.push(like(search), like(search));
  }
  const stage = str(q, 'stage');
  if (stage === 'open') where.push(`d.stage IN (${OPEN_STAGES.map((s) => `'${s}'`).join(',')})`);
  else if (stage === 'closed') where.push(`d.stage IN ('won','lost')`);
  else if (stage) {
    oneOf(q, 'stage', STAGES);
    where.push('d.stage = ?');
    params.push(stage);
  }
  const owner = intParam(q, 'owner', { min: 1 });
  if (owner) {
    where.push('d.owner_id = ?');
    params.push(owner);
  }
  const account = intParam(q, 'account', { min: 1 });
  if (account) {
    where.push('d.account_id = ?');
    params.push(account);
  }
  for (const [key, col, values] of [
    ['segment', 'a.segment', SEGMENTS],
    ['region', 'a.region', REGIONS],
    ['source', 'd.source', SOURCES],
    ['product', 'd.product', PRODUCTS],
  ] as const) {
    const v = oneOf(q, key, values);
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  const base = `${DEAL_ROW_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const order = orderBy(
    q,
    {
      name: 'name',
      account: 'account_name',
      amount: 'amount',
      stage: 'stage',
      owner: 'owner_name',
      expected_close: 'expected_close',
      created_at: 'created_at',
      closed_at: 'closed_at',
    },
    'created_at',
  );
  return paged<DealRow>(db, base, params, order, q);
}

/** Keeps closed_at / lost_reason / stage_changed_at consistent with the stage. */
function applyStageRules(data: Record<string, string | number | null>, prev: Deal | null, today: string) {
  const stage = (data.stage ?? prev?.stage) as Deal['stage'];
  const stageChanged = !prev || (data.stage !== undefined && data.stage !== prev.stage);
  if (stageChanged) data.stage_changed_at = today;
  if (stage === 'won' || stage === 'lost') {
    if (stageChanged || !prev?.closed_at) data.closed_at = today;
  } else {
    data.closed_at = null;
  }
  if (stage === 'lost') {
    const reason = data.lost_reason !== undefined ? data.lost_reason : prev?.lost_reason;
    if (!reason) throw new HttpError(400, 'Validation failed', { fields: { lost_reason: 'required' } });
  } else {
    data.lost_reason = null;
  }
  if (data.source !== undefined && data.source !== 'marketing') {
    data.channel = null;
    data.campaign_id = null;
  }
}

export function createDeal(db: Db, body: unknown, today: string): DealRow {
  const data = validateBody(db, body, dealSchema);
  applyStageRules(data, null, today);
  const id = insert(db, 'deals', { ...data, created_at: today });
  return getDeal(db, id);
}

export function updateDeal(db: Db, id: number, body: unknown, today: string): DealRow {
  const prev = mustGet<Deal>(db, 'SELECT * FROM deals WHERE id = ?', id, 'Deal');
  const data = validateBody(db, body, dealSchema, true);
  applyStageRules(data, prev, today);
  update(db, 'deals', id, data);
  return getDeal(db, id);
}

export function deleteDeal(db: Db, id: number): void {
  mustGet(db, 'SELECT id FROM deals WHERE id = ?', id, 'Deal');
  tx(db, () => {
    db.prepare('UPDATE leads SET deal_id = NULL WHERE deal_id = ?').run(id);
    db.prepare('DELETE FROM deals WHERE id = ?').run(id);
  });
}

// ---------- Leads ----------

const LEAD_ROW_SQL = `
  SELECT l.*, r.name AS owner_name, c.name AS campaign_name
  FROM leads l
  LEFT JOIN reps r ON r.id = l.owner_id
  LEFT JOIN campaigns c ON c.id = l.campaign_id`;

const leadSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 120 },
  email: { type: 'string', nullable: true, maxLen: 200 },
  phone: { type: 'string', nullable: true, maxLen: 40 },
  title: { type: 'string', nullable: true, maxLen: 120 },
  company: { type: 'string', required: true, maxLen: 200 },
  industry: { type: 'enum', values: INDUSTRIES, required: true },
  segment: { type: 'enum', values: SEGMENTS, required: true },
  region: { type: 'enum', values: REGIONS, required: true },
  channel: { type: 'enum', values: CHANNELS, required: true },
  campaign_id: { type: 'ref', table: 'campaigns', nullable: true },
  owner_id: { type: 'ref', table: 'reps', nullable: true },
  score: { type: 'int', nullable: true, min: 0, max: 100 },
};

export function getLead(db: Db, id: number): LeadRow {
  return mustGet<LeadRow>(db, `${LEAD_ROW_SQL} WHERE l.id = ?`, id, 'Lead');
}

export function listLeads(db: Db, q: Query): Paged<LeadRow> {
  const where: string[] = [];
  const params: Params = [];
  const search = str(q, 'search');
  if (search) {
    where.push(`(l.name LIKE ? ESCAPE '\\' OR l.company LIKE ? ESCAPE '\\' OR l.email LIKE ? ESCAPE '\\' OR l.phone LIKE ? ESCAPE '\\')`);
    params.push(like(search), like(search), like(search), like(search));
  }
  const status = str(q, 'status');
  if (status === 'active') where.push(`l.status IN ('new','mql','sql')`);
  else if (status) {
    oneOf(q, 'status', LEAD_STATUSES);
    where.push('l.status = ?');
    params.push(status);
  }
  for (const [key, col, values] of [
    ['channel', 'l.channel', CHANNELS],
    ['segment', 'l.segment', SEGMENTS],
    ['region', 'l.region', REGIONS],
  ] as const) {
    const v = oneOf(q, key, values);
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  for (const [key, col] of [
    ['owner', 'l.owner_id'],
    ['campaign', 'l.campaign_id'],
    ['account', 'l.account_id'],
  ] as const) {
    const v = intParam(q, key, { min: 1 });
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  const base = `${LEAD_ROW_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const order = orderBy(
    q,
    { name: 'name', company: 'company', score: 'score', status: 'status', created_at: 'created_at', channel: 'channel' },
    'created_at',
    'score DESC',
  );
  return paged<LeadRow>(db, base, params, order, q);
}

export function createLead(db: Db, body: unknown, today: string): LeadRow {
  const data = validateBody(db, body, leadSchema);
  const id = insert(db, 'leads', { ...data, score: data.score ?? 20, status: 'new', created_at: today });
  return getLead(db, id);
}

const leadPatchSchema: Schema = {
  ...leadSchema,
  status: { type: 'enum', values: LEAD_STATUSES },
};

export function updateLead(db: Db, id: number, body: unknown, today: string): LeadRow {
  const prev = mustGet<Lead>(db, 'SELECT * FROM leads WHERE id = ?', id, 'Lead');
  const data = validateBody(db, body, leadPatchSchema, true);
  if (data.status !== undefined && data.status !== prev.status) {
    if (data.status === 'converted') throw new HttpError(400, 'Use POST /api/leads/:id/convert to convert a lead');
    if (prev.status === 'converted') throw new HttpError(409, 'A converted lead cannot change status');
    // Funnel timestamps record the first time a lead reached a stage.
    if ((data.status === 'mql' || data.status === 'sql') && !prev.mql_at) data.mql_at = today;
    if (data.status === 'sql' && !prev.sql_at) data.sql_at = today;
  }
  if (data.status === null) delete data.status;
  if (data.score === null) delete data.score;
  update(db, 'leads', id, data);
  return getLead(db, id);
}

const convertSchema: Schema = {
  deal_name: { type: 'string', nullable: true, maxLen: 200 },
  owner_id: { type: 'ref', table: 'reps', required: true },
  amount: { type: 'int', required: true, min: 0, max: 1e15 },
  product: { type: 'enum', values: PRODUCTS, required: true },
  expected_close: { type: 'date', required: true },
};

export function convertLead(db: Db, id: number, body: unknown, today: string): { lead: LeadRow; deal: DealRow } {
  const lead = mustGet<Lead>(db, 'SELECT * FROM leads WHERE id = ?', id, 'Lead');
  if (lead.status === 'converted' || lead.deal_id) throw new HttpError(409, 'Lead is already converted');
  if (lead.status === 'disqualified') throw new HttpError(409, 'A disqualified lead cannot be converted');
  const data = validateBody(db, body, convertSchema);
  return tx(db, () => {
    let accountId = lead.account_id;
    if (!accountId) {
      accountId = insert(db, 'accounts', {
        name: lead.company,
        industry: lead.industry,
        segment: lead.segment,
        region: lead.region,
        employees: 0,
        website: null,
        owner_id: data.owner_id,
        tier: lead.segment === 'enterprise' ? 'tier1' : lead.segment === 'midmarket' ? 'tier2' : 'tier3',
        created_at: today,
      });
    }
    const dealId = insert(db, 'deals', {
      name: (data.deal_name as string | null) || `${shortCompany(lead.company)} – Peluang baharu`,
      account_id: accountId,
      owner_id: data.owner_id,
      stage: 'qualification',
      amount: data.amount,
      product: data.product,
      type: 'new_business',
      source: 'marketing',
      channel: lead.channel,
      campaign_id: lead.campaign_id,
      lead_id: lead.id,
      created_at: today,
      expected_close: data.expected_close,
      closed_at: null,
      stage_changed_at: today,
      lost_reason: null,
      next_step: null,
    });
    update(db, 'leads', id, {
      status: 'converted',
      account_id: accountId,
      deal_id: dealId,
      mql_at: lead.mql_at ?? today,
      sql_at: lead.sql_at ?? today,
      converted_at: today,
    });
    return { lead: getLead(db, id), deal: getDeal(db, dealId) };
  });
}

export function deleteLead(db: Db, id: number): void {
  mustGet(db, 'SELECT id FROM leads WHERE id = ?', id, 'Lead');
  tx(db, () => {
    db.prepare('UPDATE deals SET lead_id = NULL WHERE lead_id = ?').run(id);
    db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  });
}

// ---------- Campaigns ----------

const campaignSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 200 },
  channel: { type: 'enum', values: CHANNELS, required: true },
  start_date: { type: 'date', required: true },
  end_date: { type: 'date', required: true },
  budget: { type: 'int', required: true, min: 0, max: 1e15 },
  spend: { type: 'int', nullable: true, min: 0, max: 1e15 },
  status: { type: 'enum', values: CAMPAIGN_STATUSES, nullable: true },
};

const CAMPAIGN_PERF_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id) AS leads,
    (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id AND l.mql_at IS NOT NULL) AS mqls,
    (SELECT COUNT(*) FROM leads l WHERE l.campaign_id = c.id AND l.sql_at IS NOT NULL) AS sqls,
    (SELECT COUNT(*) FROM deals d WHERE d.campaign_id = c.id) AS opps,
    COALESCE((SELECT SUM(amount) FROM deals d WHERE d.campaign_id = c.id), 0) AS pipeline,
    COALESCE((SELECT SUM(amount) FROM deals d WHERE d.campaign_id = c.id AND d.stage = 'won'), 0) AS revenue
  FROM campaigns c`;

export type CampaignRow = Campaign & { leads: number; mqls: number; sqls: number; opps: number; pipeline: number; revenue: number };

export function listCampaigns(db: Db, q: Query): Paged<CampaignRow> {
  const where: string[] = [];
  const params: Params = [];
  const search = str(q, 'search');
  if (search) {
    where.push(`c.name LIKE ? ESCAPE '\\'`);
    params.push(like(search));
  }
  const channel = oneOf(q, 'channel', CHANNELS);
  if (channel) {
    where.push('c.channel = ?');
    params.push(channel);
  }
  const status = oneOf(q, 'status', CAMPAIGN_STATUSES);
  if (status) {
    where.push('c.status = ?');
    params.push(status);
  }
  const base = `${CAMPAIGN_PERF_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const order = orderBy(
    q,
    { name: 'name', start_date: 'start_date', budget: 'budget', spend: 'spend', leads: 'leads', pipeline: 'pipeline', revenue: 'revenue', channel: 'channel' },
    'start_date',
  );
  return paged<CampaignRow>(db, base, params, order, q);
}

function getCampaign(db: Db, id: number): CampaignRow {
  return mustGet<CampaignRow>(db, `${CAMPAIGN_PERF_SQL} WHERE c.id = ?`, id, 'Campaign');
}

function statusFromDates(start: string, end: string, today: string): Campaign['status'] {
  return end < today ? 'completed' : start <= today ? 'active' : 'planned';
}

export function createCampaign(db: Db, body: unknown, today: string): CampaignRow {
  const data = validateBody(db, body, campaignSchema);
  if ((data.end_date as string) < (data.start_date as string)) {
    throw new HttpError(400, 'Validation failed', { fields: { end_date: 'before_start' } });
  }
  const id = insert(db, 'campaigns', {
    ...data,
    spend: data.spend ?? 0,
    status: data.status ?? statusFromDates(data.start_date as string, data.end_date as string, today),
  });
  return getCampaign(db, id);
}

export function updateCampaign(db: Db, id: number, body: unknown, today: string): CampaignRow {
  const prev = mustGet<Campaign>(db, 'SELECT * FROM campaigns WHERE id = ?', id, 'Campaign');
  const data = validateBody(db, body, campaignSchema, true);
  const start = (data.start_date ?? prev.start_date) as string;
  const end = (data.end_date ?? prev.end_date) as string;
  if (end < start) throw new HttpError(400, 'Validation failed', { fields: { end_date: 'before_start' } });
  if (data.spend === null) data.spend = 0;
  // An explicit null means "derive the status from the dates".
  if (data.status === null) data.status = statusFromDates(start, end, today);
  update(db, 'campaigns', id, data);
  return getCampaign(db, id);
}

export function deleteCampaign(db: Db, id: number): void {
  mustGet(db, 'SELECT id FROM campaigns WHERE id = ?', id, 'Campaign');
  tx(db, () => {
    db.prepare('UPDATE leads SET campaign_id = NULL WHERE campaign_id = ?').run(id);
    db.prepare('UPDATE deals SET campaign_id = NULL WHERE campaign_id = ?').run(id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
  });
}

// ---------- Accounts ----------

const ACCOUNT_ROW_SQL = `
  SELECT a.*, r.name AS owner_name,
    COALESCE((SELECT SUM(amount) FROM deals d WHERE d.account_id = a.id AND d.stage = 'won'), 0) AS won_revenue,
    COALESCE((SELECT SUM(amount) FROM deals d WHERE d.account_id = a.id AND d.stage NOT IN ('won','lost')), 0) AS open_pipeline,
    (SELECT COUNT(*) FROM deals d WHERE d.account_id = a.id AND d.stage NOT IN ('won','lost')) AS open_deals,
    (SELECT COUNT(*) FROM deals d WHERE d.account_id = a.id AND d.stage = 'won') AS won_deals,
    (SELECT COUNT(*) FROM leads l WHERE l.account_id = a.id) AS leads,
    (SELECT MAX(date) FROM activities act WHERE act.account_id = a.id) AS last_activity
  FROM accounts a
  LEFT JOIN reps r ON r.id = a.owner_id`;

const accountSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 200 },
  industry: { type: 'enum', values: INDUSTRIES, required: true },
  segment: { type: 'enum', values: SEGMENTS, required: true },
  region: { type: 'enum', values: REGIONS, required: true },
  employees: { type: 'int', nullable: true, min: 0, max: 10_000_000 },
  website: { type: 'string', nullable: true, maxLen: 200 },
  owner_id: { type: 'ref', table: 'reps', nullable: true },
  tier: { type: 'enum', values: ABM_TIERS, nullable: true },
  legal_name: { type: 'string', nullable: true, maxLen: 200 },
  contact_name: { type: 'string', nullable: true, maxLen: 120 },
  phone: { type: 'string', nullable: true, maxLen: 40 },
  sales_estimate: { type: 'int', nullable: true, min: 0, max: 1e15 },
  address: { type: 'string', nullable: true, maxLen: 300 },
  email: { type: 'string', nullable: true, maxLen: 120 },
};

function accountWhere(q: Query) {
  const where: string[] = [];
  const params: Params = [];
  const search = str(q, 'search');
  if (search) {
    where.push(
      `(a.name LIKE ? ESCAPE '\\' OR a.legal_name LIKE ? ESCAPE '\\' OR a.contact_name LIKE ? ESCAPE '\\' OR a.phone LIKE ? ESCAPE '\\' OR a.address LIKE ? ESCAPE '\\')`,
    );
    params.push(like(search), like(search), like(search), like(search), like(search));
  }
  for (const [key, col, values] of [
    ['segment', 'a.segment', SEGMENTS],
    ['region', 'a.region', REGIONS],
    ['industry', 'a.industry', INDUSTRIES],
    ['tier', 'a.tier', ABM_TIERS],
  ] as const) {
    const v = oneOf(q, key, values);
    if (v) {
      where.push(`${col} = ?`);
      params.push(v);
    }
  }
  const owner = intParam(q, 'owner', { min: 1 });
  if (owner) {
    where.push('a.owner_id = ?');
    params.push(owner);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listAccounts(db: Db, q: Query): Paged<AccountRow> {
  const w = accountWhere(q);
  const customersOnly = str(q, 'customers') === 'true';
  const base = `SELECT * FROM (${ACCOUNT_ROW_SQL} ${w.sql}) ${customersOnly ? 'WHERE won_deals > 0' : ''}`;
  const order = orderBy(
    q,
    {
      name: 'name',
      won_revenue: 'won_revenue',
      open_pipeline: 'open_pipeline',
      employees: 'employees',
      sales_estimate: 'sales_estimate',
      rating: 'rating',
      last_activity: 'last_activity',
      created_at: 'created_at',
      segment: 'segment',
    },
    'won_revenue',
    // Customers first, then accounts in play, then the biggest prospects.
    'won_revenue DESC, open_pipeline DESC, sales_estimate DESC NULLS LAST, rating DESC NULLS LAST',
  );
  return paged<AccountRow>(db, base, w.params, order, q);
}

export function accountSummary(db: Db, q: Query) {
  const w = accountWhere(q);
  const rows = db.prepare(`${ACCOUNT_ROW_SQL} ${w.sql}`).all(...w.params) as unknown as AccountRow[];
  const group = <K extends keyof AccountRow>(key: K, keys: readonly AccountRow[K][]) =>
    keys.map((k) => {
      const g = rows.filter((r) => r[key] === k);
      return {
        key: k,
        accounts: g.length,
        customers: g.filter((r) => r.won_deals > 0).length,
        revenue: g.reduce((s, r) => s + r.won_revenue, 0),
        pipeline: g.reduce((s, r) => s + r.open_pipeline, 0),
      };
    });
  return {
    totals: {
      accounts: rows.length,
      customers: rows.filter((r) => r.won_deals > 0).length,
      revenue: rows.reduce((s, r) => s + r.won_revenue, 0),
      pipeline: rows.reduce((s, r) => s + r.open_pipeline, 0),
    },
    bySegment: group('segment', SEGMENTS),
    byIndustry: group('industry', INDUSTRIES).sort((a, b) => b.revenue - a.revenue),
    byTier: group('tier', ABM_TIERS),
  };
}

export function getAccount(db: Db, id: number): AccountDetail {
  const account = mustGet<AccountRow>(db, `${ACCOUNT_ROW_SQL} WHERE a.id = ?`, id, 'Account');
  const deals = db.prepare(`${DEAL_ROW_SQL} WHERE d.account_id = ? ORDER BY d.created_at DESC`).all(id) as unknown as DealRow[];
  const leads = db.prepare(`${LEAD_ROW_SQL} WHERE l.account_id = ? ORDER BY l.created_at DESC`).all(id) as unknown as LeadRow[];
  const activities = db
    .prepare(
      `SELECT act.*, r.name AS rep_name FROM activities act JOIN reps r ON r.id = act.rep_id
       WHERE act.account_id = ? ORDER BY act.date DESC, act.id DESC LIMIT 50`,
    )
    .all(id) as unknown as AccountDetail['activities'];
  return { account, deals, leads, activities };
}

export function createAccount(db: Db, body: unknown, today: string): AccountRow {
  const data = validateBody(db, body, accountSchema);
  const id = insert(db, 'accounts', {
    ...data,
    employees: data.employees ?? 0,
    tier: data.tier ?? (data.segment === 'enterprise' ? 'tier1' : data.segment === 'midmarket' ? 'tier2' : 'tier3'),
    created_at: today,
  });
  return getAccount(db, id).account;
}

export function updateAccount(db: Db, id: number, body: unknown): AccountRow {
  const prev = mustGet<Account>(db, 'SELECT * FROM accounts WHERE id = ?', id, 'Account');
  const data = validateBody(db, body, accountSchema, true);
  if (data.employees === null) data.employees = 0;
  if (data.tier === null) {
    const segment = (data.segment ?? prev.segment) as string;
    data.tier = segment === 'enterprise' ? 'tier1' : segment === 'midmarket' ? 'tier2' : 'tier3';
  }
  update(db, 'accounts', id, data);
  return getAccount(db, id).account;
}

export function deleteAccount(db: Db, id: number): void {
  mustGet(db, 'SELECT id FROM accounts WHERE id = ?', id, 'Account');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM deals WHERE account_id = ?').get(id) as { n: number }).n;
  if (n > 0) throw new HttpError(409, 'Account has deals; delete or move them first');
  tx(db, () => {
    db.prepare('UPDATE leads SET account_id = NULL WHERE account_id = ?').run(id);
    db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  });
}


// ---------- Sales team (reps & monthly quotas) ----------

const repSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 120 },
  email: { type: 'string', nullable: true, maxLen: 200 },
  role: { type: 'enum', values: REP_ROLES, required: true },
  team: { type: 'enum', values: [...SEGMENTS, 'sdr'], required: true },
  active: { type: 'int', min: 0, max: 1 },
  monthly_quota: { type: 'int', nullable: true, min: 0, max: 1e15 },
};

const REP_ROW_SQL = (month: string) => `
  SELECT r.*,
    (SELECT amount FROM quotas q WHERE q.rep_id = r.id AND q.month = '${month}') AS monthly_quota,
    (SELECT COUNT(*) FROM deals d WHERE d.owner_id = r.id AND d.stage NOT IN ('won','lost')) AS open_deals,
    (SELECT COUNT(*) FROM accounts a WHERE a.owner_id = r.id) AS accounts
  FROM reps r`;

export function listReps(db: Db, today: string): RepRow[] {
  return db.prepare(`${REP_ROW_SQL(today.slice(0, 7))} ORDER BY r.active DESC, r.role, r.name`).all() as unknown as RepRow[];
}

function getRep(db: Db, id: number, today: string): RepRow {
  return mustGet<RepRow>(db, `${REP_ROW_SQL(today.slice(0, 7))} WHERE r.id = ?`, id, 'Rep');
}

/** Sets the same monthly quota from this month until the end of next year (earlier months keep theirs). */
function setQuota(db: Db, repId: number, amount: number, today: string): void {
  const del = db.prepare('DELETE FROM quotas WHERE rep_id = ? AND month = ?');
  const ins = db.prepare('INSERT INTO quotas (rep_id, month, amount) VALUES (?, ?, ?)');
  const year = Number(today.slice(0, 4));
  for (let y = year, m = Number(today.slice(5, 7)); y <= year + 1; m++) {
    if (m > 12) {
      m = 1;
      y++;
      if (y > year + 1) break;
    }
    const month = `${y}-${String(m).padStart(2, '0')}`;
    del.run(repId, month);
    if (amount > 0) ins.run(repId, month, amount);
  }
}

function checkRepTeam(role: unknown, team: unknown) {
  if (role === 'SDR' && team !== 'sdr') throw new HttpError(400, 'Validation failed', { fields: { team: 'invalid' } });
  if (role === 'AE' && team === 'sdr') throw new HttpError(400, 'Validation failed', { fields: { team: 'invalid' } });
}

export function createRep(db: Db, body: unknown, today: string): RepRow {
  const data = validateBody(db, body, repSchema);
  checkRepTeam(data.role, data.team);
  return tx(db, () => {
    const id = insert(db, 'reps', { name: data.name, email: data.email ?? '', role: data.role, team: data.team, active: data.active ?? 1 });
    if (typeof data.monthly_quota === 'number') setQuota(db, id, data.monthly_quota, today);
    return getRep(db, id, today);
  });
}

export function updateRep(db: Db, id: number, body: unknown, today: string): RepRow {
  const prev = mustGet<{ role: string; team: string }>(db, 'SELECT * FROM reps WHERE id = ?', id, 'Rep');
  const data = validateBody(db, body, repSchema, true);
  checkRepTeam(data.role ?? prev.role, data.team ?? prev.team);
  return tx(db, () => {
    const { monthly_quota, ...fields } = data;
    if (fields.email === null) fields.email = '';
    if (fields.active === null) delete fields.active;
    update(db, 'reps', id, fields);
    if (monthly_quota !== undefined) setQuota(db, id, Number(monthly_quota ?? 0), today);
    return getRep(db, id, today);
  });
}
