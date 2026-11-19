// Endpoints for the businesses of the group and their lead categories, and the
// category/business rules that leads and accounts follow.

import { tx, type Db } from './schema.ts';
import { HttpError, str, validateBody, type Query, type Schema } from './http.ts';
import { FALLBACK_CATEGORY } from '../shared/constants.ts';
import type { BusinessRow, LeadCategory, LeadCategoryRow } from '../shared/types.ts';
import { defaultBusinessId, slugKey, type ResolvedCategory } from './categories.ts';

const ACTIVE_LEAD = `l.status IN ('new','mql','sql')`;

// ---------- Businesses ----------

const BUSINESS_ROW_SQL = `
  SELECT b.*,
    (SELECT COUNT(*) FROM leads l WHERE l.business_id = b.id) AS leads,
    (SELECT COUNT(*) FROM leads l WHERE l.business_id = b.id AND ${ACTIVE_LEAD}) AS active_leads,
    (SELECT COUNT(*) FROM lead_categories c WHERE c.business_id = b.id) AS categories
  FROM businesses b`;

const businessSchema: Schema = {
  name: { type: 'string', required: true, maxLen: 80 },
  description: { type: 'string', nullable: true, maxLen: 1000 },
  active: { type: 'int', nullable: true, min: 0, max: 1 },
  sort: { type: 'int', nullable: true, min: 0, max: 100000 },
};

export function listBusinesses(db: Db): BusinessRow[] {
  return db.prepare(`${BUSINESS_ROW_SQL} ORDER BY b.sort, b.id`).all() as unknown as BusinessRow[];
}

function getBusiness(db: Db, id: number): BusinessRow {
  const row = db.prepare(`${BUSINESS_ROW_SQL} WHERE b.id = ?`).get(id) as BusinessRow | undefined;
  if (!row) throw new HttpError(404, 'Business not found');
  return row;
}

function sameName(db: Db, table: 'businesses' | 'lead_categories', name: string, extra: { sql: string; params: (number | null)[] }, exceptId?: number) {
  const row = db
    .prepare(`SELECT id FROM ${table} WHERE lower(name) = lower(?) ${extra.sql} ${exceptId ? 'AND id <> ?' : ''} LIMIT 1`)
    .get(name, ...extra.params, ...(exceptId ? [exceptId] : []));
  return Boolean(row);
}

export function createBusiness(db: Db, body: unknown): BusinessRow {
  const data = validateBody(db, body, businessSchema);
  if (sameName(db, 'businesses', String(data.name), { sql: '', params: [] })) throw new HttpError(409, 'A business with this name already exists', undefined, 'duplicate_name');
  const { n } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM businesses').get() as { n: number };
  const res = db
    .prepare('INSERT INTO businesses (name, description, active, sort) VALUES (?, ?, ?, ?)')
    .run(data.name, data.description, data.active ?? 1, data.sort ?? n);
  return getBusiness(db, Number(res.lastInsertRowid));
}

export function updateBusiness(db: Db, id: number, body: unknown): BusinessRow {
  getBusiness(db, id);
  const data = validateBody(db, body, businessSchema, true);
  if (data.name != null && sameName(db, 'businesses', String(data.name), { sql: '', params: [] }, id)) {
    throw new HttpError(409, 'A business with this name already exists', undefined, 'duplicate_name');
  }
  if (data.active === 0) {
    const others = db.prepare('SELECT COUNT(*) AS n FROM businesses WHERE active = 1 AND id <> ?').get(id) as { n: number };
    if (others.n === 0) throw new HttpError(409, 'Keep at least one active business', undefined, 'last_business');
  }
  if (data.active === null) delete data.active;
  if (data.sort === null) delete data.sort;
  const cols = Object.keys(data);
  if (cols.length) db.prepare(`UPDATE businesses SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(data), id);
  return getBusiness(db, id);
}

/** Only a business with no leads can go; its unused categories go with it. */
export function deleteBusiness(db: Db, id: number): void {
  const b = getBusiness(db, id);
  const total = db.prepare('SELECT COUNT(*) AS n FROM businesses').get() as { n: number };
  if (total.n <= 1) throw new HttpError(409, 'Keep at least one business', undefined, 'last_business');
  if (b.leads > 0) throw new HttpError(409, 'This business has leads; move them to another business first', undefined, 'business_has_leads');
  const used = db
    .prepare(
      `SELECT COUNT(*) AS n FROM lead_categories c WHERE c.business_id = ?
         AND (EXISTS (SELECT 1 FROM leads l WHERE l.industry = c.key) OR EXISTS (SELECT 1 FROM accounts a WHERE a.industry = c.key))`,
    )
    .get(id) as { n: number };
  if (used.n > 0) throw new HttpError(409, 'Categories of this business are in use; move or delete them first', undefined, 'categories_in_use');
  tx(db, () => {
    db.prepare('DELETE FROM lead_categories WHERE business_id = ?').run(id);
    db.prepare('DELETE FROM businesses WHERE id = ?').run(id);
  });
}

// ---------- Categories ----------

const CATEGORY_ROW_SQL = `
  SELECT c.*,
    (SELECT COUNT(*) FROM leads l WHERE l.industry = c.key) AS leads,
    (SELECT COUNT(*) FROM leads l WHERE l.industry = c.key AND ${ACTIVE_LEAD}) AS active_leads,
    (SELECT COUNT(*) FROM accounts a WHERE a.industry = c.key) AS accounts,
    (SELECT COUNT(DISTINCT d.account_id) FROM deals d JOIN accounts a ON a.id = d.account_id
       WHERE a.industry = c.key AND d.stage = 'won') AS customers
  FROM lead_categories c`;

const CATEGORY_ORDER = `ORDER BY c.key = '${FALLBACK_CATEGORY}', c.sort, c.id`;

const categorySchema: Schema = {
  name: { type: 'string', required: true, maxLen: 80 },
  name_en: { type: 'string', nullable: true, maxLen: 80 },
  business_id: { type: 'ref', table: 'businesses', nullable: true },
  description: { type: 'string', nullable: true, maxLen: 600 },
  color: { type: 'int', nullable: true, min: 1, max: 8 },
  ai_discover: { type: 'int', nullable: true, min: 0, max: 1 },
  active: { type: 'int', nullable: true, min: 0, max: 1 },
  sort: { type: 'int', nullable: true, min: 0, max: 100000 },
};

/** The light list every page needs (in /meta). */
export function categoryList(db: Db): LeadCategory[] {
  return db.prepare(`SELECT * FROM lead_categories c ${CATEGORY_ORDER}`).all() as unknown as LeadCategory[];
}

export function listCategories(db: Db): LeadCategoryRow[] {
  return db.prepare(`${CATEGORY_ROW_SQL} ${CATEGORY_ORDER}`).all() as unknown as LeadCategoryRow[];
}

function getCategory(db: Db, id: number): LeadCategoryRow {
  const row = db.prepare(`${CATEGORY_ROW_SQL} WHERE c.id = ?`).get(id) as LeadCategoryRow | undefined;
  if (!row) throw new HttpError(404, 'Category not found');
  return row;
}

const sameBusiness = (business: number | null) =>
  business == null ? { sql: 'AND business_id IS NULL', params: [] } : { sql: 'AND business_id = ?', params: [business] };

function uniqueKey(db: Db, name: string): string {
  const base = slugKey(name);
  const taken = new Set((db.prepare('SELECT key FROM lead_categories WHERE key = ? OR key LIKE ?').all(base, `${base}_%`) as { key: string }[]).map((r) => r.key));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

export function createCategory(db: Db, body: unknown): LeadCategoryRow {
  const data = validateBody(db, body, categorySchema);
  const business = (data.business_id as number | null) ?? null;
  if (sameName(db, 'lead_categories', String(data.name), sameBusiness(business))) throw new HttpError(409, 'A category with this name already exists', undefined, 'duplicate_name');
  const { n, c } = db
    .prepare(`SELECT COALESCE(MAX(CASE WHEN key <> '${FALLBACK_CATEGORY}' THEN sort END), -1) + 1 AS n, COUNT(*) AS c FROM lead_categories`)
    .get() as { n: number; c: number };
  const res = db
    .prepare(
      `INSERT INTO lead_categories (key, name, name_en, business_id, description, color, ai_discover, active, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      uniqueKey(db, String(data.name)),
      data.name,
      data.name_en,
      business,
      data.description,
      data.color ?? (c % 8) + 1,
      data.ai_discover ?? 1,
      data.active ?? 1,
      data.sort ?? n,
    );
  return getCategory(db, Number(res.lastInsertRowid));
}

export function updateCategory(db: Db, id: number, body: unknown): LeadCategoryRow {
  const prev = getCategory(db, id);
  const data = validateBody(db, body, categorySchema, true);
  if (data.name === null) delete data.name;
  for (const k of ['color', 'ai_discover', 'active', 'sort'] as const) if (data[k] === null) delete data[k];
  if (prev.key === FALLBACK_CATEGORY && data.active === 0) throw new HttpError(409, 'The fallback category cannot be archived', undefined, 'fallback_category');
  const business = data.business_id !== undefined ? (data.business_id as number | null) : prev.business_id;
  if (sameName(db, 'lead_categories', String(data.name ?? prev.name), sameBusiness(business), id)) {
    throw new HttpError(409, 'A category with this name already exists', undefined, 'duplicate_name');
  }
  tx(db, () => {
    const cols = Object.keys(data);
    if (cols.length) db.prepare(`UPDATE lead_categories SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(data), id);
    // Leads follow their category to its business.
    if (business != null && business !== prev.business_id) db.prepare('UPDATE leads SET business_id = ? WHERE industry = ?').run(business, prev.key);
  });
  return getCategory(db, id);
}

/** Deletes a category; leads and accounts in it move to `move_to` (required when it is in use). */
export function deleteCategory(db: Db, id: number, q: Query): { moved: number } {
  const cat = getCategory(db, id);
  if (cat.key === FALLBACK_CATEGORY) throw new HttpError(409, 'The fallback category cannot be deleted', undefined, 'fallback_category');
  const inUse = cat.leads + cat.accounts;
  const moveTo = str(q, 'move_to');
  let target: ResolvedCategory | null = null;
  if (inUse > 0) {
    if (!moveTo) throw new HttpError(400, 'This category is in use; choose a category to move its leads to', { fields: { move_to: 'required' } });
    if (moveTo === cat.key) throw new HttpError(400, 'Choose another category', { fields: { move_to: 'invalid' } });
    target = (db.prepare('SELECT key, business_id FROM lead_categories WHERE key = ?').get(moveTo) as ResolvedCategory | undefined) ?? null;
    if (!target) throw new HttpError(400, 'Category to move to not found', { fields: { move_to: 'not_found' } });
  }
  tx(db, () => {
    if (target) {
      db.prepare('UPDATE leads SET industry = ?, business_id = COALESCE(?, business_id) WHERE industry = ?').run(target.key, target.business_id, cat.key);
      db.prepare('UPDATE accounts SET industry = ? WHERE industry = ?').run(target.key, cat.key);
    }
    db.prepare('DELETE FROM lead_categories WHERE id = ?').run(id);
  });
  return { moved: inUse };
}

// ---------- Rules for leads and accounts ----------

/** The category with this key, or a 400 on the `industry` field. */
export function checkCategory(db: Db, key: unknown): ResolvedCategory {
  const row = typeof key === 'string' ? (db.prepare('SELECT key, business_id FROM lead_categories WHERE key = ?').get(key) as ResolvedCategory | undefined) : undefined;
  if (!row) throw new HttpError(400, 'Validation failed', { fields: { industry: 'not_found' } });
  return row;
}

/**
 * A lead's business: its category's business when the category belongs to one,
 * else the one asked for, else the one it had, else the default business.
 */
export function leadBusiness(db: Db, cat: ResolvedCategory, requested: number | null | undefined, prev: number | null | undefined): number {
  return cat.business_id ?? requested ?? prev ?? defaultBusinessId(db);
}

/** The category key a new lead from the agent gets: its own if it still exists, else the fallback. */
export function existingCategoryOr(db: Db, key: string | null | undefined): string {
  if (key && db.prepare('SELECT 1 FROM lead_categories WHERE key = ?').get(key)) return key;
  return FALLBACK_CATEGORY;
}
