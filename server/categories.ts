// Businesses of the group and their lead categories: the starting rows, and
// making sure every category key used by a lead or account exists.
//
// Leads and accounts store the category *key* (column `industry`, kept for
// older data and saved changes). Each lead also belongs to one business.

import type { Db } from './schema.ts';
import { FALLBACK_CATEGORY } from '../shared/constants.ts';

/** The first business, created when a database has none (rename it in the app). */
export const DEFAULT_BUSINESS = {
  name: 'Bekalan Daging & Makanan Laut',
  description:
    'Pembekal daging dan makanan laut sejuk beku halal (daging lembu, kambing, ayam, makanan laut) kepada perniagaan F&B di Malaysia. Pelanggan mestilah halal atau mesra Muslim.',
};

interface KnownCategory {
  name: string;
  name_en: string;
  description: string | null;
  color: number;
  /** null = for every business of the group. */
  groupWide?: boolean;
  discover: boolean;
}

/** Names and AI briefs for the categories of the original prospect list. */
export const KNOWN_CATEGORIES: Record<string, KnownCategory> = {
  restoran_halal_western: {
    name: 'Restoran Halal Western',
    name_en: 'Halal Western restaurants',
    description: 'Restoran makanan Barat halal: grill, steakhouse, burger dan western food.',
    color: 1,
    discover: true,
  },
  kafe_premium_steak_bbq: {
    name: 'Kafe Premium (Steak & BBQ)',
    name_en: 'Premium cafés (steak & BBQ)',
    description: 'Kafe premium dan restoran steak, BBQ atau yakiniku.',
    color: 2,
    discover: true,
  },
  penjual_perap_online: {
    name: 'Penjual Perap Online Western',
    name_en: 'Online marinade sellers',
    description:
      'Penjual daging perap dalam talian (ayam, daging lembu atau kambing perap sejuk beku) melalui Instagram, Facebook, TikTok Shop, Shopee atau WhatsApp.',
    color: 3,
    discover: true,
  },
  [FALLBACK_CATEGORY]: {
    name: 'Lain-lain',
    name_en: 'Other',
    description: null,
    color: 7,
    groupWide: true,
    discover: false,
  },
};

/** A stable key from a name: lowercase ASCII words joined with "_". */
export function slugKey(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' dan ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return s || 'kategori';
}

/** "restoran_halal_western" -> "Restoran halal western". */
function humanize(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

/** The business new leads go to when nothing else says: the first one (created if none). */
export function defaultBusinessId(db: Db): number {
  const row = db.prepare('SELECT id FROM businesses ORDER BY active DESC, sort, id LIMIT 1').get() as { id: number } | undefined;
  if (row) return row.id;
  const res = db.prepare('INSERT INTO businesses (name, description, active, sort) VALUES (?, ?, 1, 0)').run(DEFAULT_BUSINESS.name, DEFAULT_BUSINESS.description);
  return Number(res.lastInsertRowid);
}

export interface ResolvedCategory {
  key: string;
  business_id: number | null;
}

/**
 * Returns a function that finds a category by key, creating it when missing
 * (an imported list or an older database can carry keys not set up yet).
 */
export function categoryResolver(db: Db): (rawKey: string | null | undefined, label?: string | null) => ResolvedCategory {
  const find = db.prepare('SELECT key, business_id FROM lead_categories WHERE key = ?');
  const next = db.prepare(`SELECT COALESCE(MAX(CASE WHEN key <> '${FALLBACK_CATEGORY}' THEN sort END), -1) + 1 AS n, COUNT(*) AS c FROM lead_categories`);
  const ins = db.prepare(
    'INSERT INTO lead_categories (key, name, name_en, business_id, description, color, ai_discover, active, sort) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)',
  );
  const cache = new Map<string, ResolvedCategory>();
  return (rawKey, label) => {
    const key = rawKey && rawKey.trim() ? slugKey(rawKey) : FALLBACK_CATEGORY;
    const hit = cache.get(key);
    if (hit) return hit;
    let row = find.get(key) as ResolvedCategory | undefined;
    if (!row) {
      const known = KNOWN_CATEGORIES[key];
      const { n, c } = next.get() as { n: number; c: number };
      const business = known?.groupWide ? null : defaultBusinessId(db);
      const fallback = key === FALLBACK_CATEGORY;
      ins.run(
        key,
        known?.name ?? (label?.trim() ? label.trim().slice(0, 80) : humanize(key)),
        known?.name_en ?? null,
        business,
        known?.description ?? null,
        known?.color ?? (c % 8) + 1,
        (known ? known.discover : !fallback) ? 1 : 0,
        // The fallback stays last.
        fallback ? 1000 : n,
      );
      row = { key, business_id: business };
    }
    cache.set(key, row);
    return row;
  };
}

/**
 * Makes the business/category data consistent: a business exists, the fallback
 * category exists, every key used by a lead or account has a category, and
 * every lead has a business. Safe to run on every open.
 */
export function ensureCategories(db: Db, labels: Record<string, string> = {}): void {
  const resolve = categoryResolver(db);
  resolve(FALLBACK_CATEGORY);
  const known = Object.keys(KNOWN_CATEGORIES);
  const rank = (k: string) => (known.includes(k) ? known.indexOf(k) : known.length);
  const used = (db.prepare('SELECT industry AS k FROM leads UNION SELECT industry FROM accounts').all() as { k: string | null }[]).sort(
    (a, b) => rank(a.k ?? '') - rank(b.k ?? ''),
  );
  for (const { k } of used) {
    if (!k) continue;
    const r = resolve(k, labels[k]);
    // Keys are stored as given; a key that was not already clean is rewritten.
    if (r.key !== k) {
      db.prepare('UPDATE leads SET industry = ? WHERE industry = ?').run(r.key, k);
      db.prepare('UPDATE accounts SET industry = ? WHERE industry = ?').run(r.key, k);
    }
  }
  const missing = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE business_id IS NULL').get() as { n: number };
  if (missing.n > 0) {
    const fallback = defaultBusinessId(db);
    db.prepare(
      `UPDATE leads SET business_id = COALESCE((SELECT c.business_id FROM lead_categories c WHERE c.key = leads.industry), ?)
       WHERE business_id IS NULL`,
    ).run(fallback);
  }
}
