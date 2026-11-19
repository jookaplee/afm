// Product catalog and customer orders. Prices always come from the catalog
// (an order line keeps the price it was taken at), so neither a person typing
// fast nor the WhatsApp agent can invent a price. A confirmed order is recorded
// as a won deal, so it counts as revenue on the dashboards.

import { tx, type Db } from './schema.ts';
import { HttpError, type Query } from './http.ts';
import { ORDER_STATUSES, PRODUCT_CATEGORIES, type OrderStatus, type Product } from '../shared/constants.ts';
import type { CatalogProduct, OrderDetail, OrderItem, OrderRow, OrderSummary, Paged } from '../shared/types.ts';

const bad = (fields: Record<string, string>) => new HttpError(400, 'Validation failed', { fields });
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------- Catalog ----------

function productInput(body: unknown, partial: boolean) {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const fields: Record<string, string> = {};
  if (!partial || 'name' in b) {
    const name = text(b.name, 120);
    if (!name) fields.name = 'required';
    out.name = name;
  }
  if (!partial || 'category' in b) {
    if (!(PRODUCT_CATEGORIES as readonly unknown[]).includes(b.category)) fields.category = 'invalid';
    out.category = b.category;
  }
  if (!partial || 'unit' in b) {
    const unit = text(b.unit, 40);
    if (!unit) fields.unit = 'required';
    out.unit = unit;
  }
  if (!partial || 'price_sen' in b) {
    const p = num(b.price_sen);
    if (p === null || !Number.isInteger(p) || p < 0 || p > 1e9) fields.price_sen = 'invalid';
    out.price_sen = p;
  }
  for (const k of ['min_qty', 'stock'] as const) {
    if (!partial || k in b) {
      const v = num(b[k]);
      if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1e7)) fields[k] = 'invalid';
      out[k] = v;
    }
  }
  if (!partial || 'description' in b) out.description = text(b.description, 400);
  if (!partial || 'active' in b) out.active = b.active === false || b.active === 0 ? 0 : 1;
  if (Object.keys(fields).length) throw bad(fields);
  return out;
}

export function listProducts(db: Db, q: Query): CatalogProduct[] {
  const where = q.active === 'true' ? 'WHERE active = 1' : '';
  return db.prepare(`SELECT * FROM products ${where} ORDER BY active DESC, category, name`).all() as unknown as CatalogProduct[];
}

function getProduct(db: Db, id: number): CatalogProduct {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as unknown as CatalogProduct | undefined;
  if (!p) throw new HttpError(404, 'Not found');
  return p;
}

export function createProduct(db: Db, body: unknown, today: string): CatalogProduct {
  const p = productInput(body, false);
  const r = db
    .prepare('INSERT INTO products (name, category, unit, price_sen, min_qty, stock, description, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(p.name as string, p.category as string, p.unit as string, p.price_sen as number, p.min_qty as number | null, p.stock as number | null, p.description as string | null, p.active as number, today);
  return getProduct(db, Number(r.lastInsertRowid));
}

export function updateProduct(db: Db, id: number, body: unknown): CatalogProduct {
  getProduct(db, id);
  const p = productInput(body, true);
  const keys = Object.keys(p);
  if (keys.length) db.prepare(`UPDATE products SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...(keys.map((k) => p[k]) as (string | number | null)[]), id);
  return getProduct(db, id);
}

export function deleteProduct(db: Db, id: number): void {
  getProduct(db, id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
}

/** Text search over the active catalog (for the WhatsApp agent's lookup tool). */
export function searchProducts(db: Db, query: string | null, category: string | null): CatalogProduct[] {
  let rows = listProducts(db, { active: 'true' });
  if (category && (PRODUCT_CATEGORIES as readonly string[]).includes(category)) rows = rows.filter((p) => p.category === category);
  const words = (query ?? '').toLowerCase().split(/\s+/).filter((w) => w.length > 1);
  if (words.length) {
    const scored = rows
      .map((p) => {
        const hay = `${p.name} ${p.description ?? ''} ${p.category} ${p.unit}`.toLowerCase();
        return { p, score: words.filter((w) => hay.includes(w)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    // Nothing matched: show the whole (category) list rather than nothing.
    if (scored.length) rows = scored.map((x) => x.p);
  }
  return rows.slice(0, 40);
}

// ---------- Orders ----------

const ORDER_SQL = `SELECT o.*, l.name AS lead_name, COALESCE(a.name, l.company) AS company, l.phone,
    (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS items_count,
    (SELECT GROUP_CONCAT(CASE WHEN i.qty = CAST(i.qty AS INTEGER) THEN CAST(CAST(i.qty AS INTEGER) AS TEXT) ELSE CAST(i.qty AS TEXT) END
       || ' ' || i.unit || ' ' || i.name, ', ') FROM order_items i WHERE i.order_id = o.id) AS items_summary
  FROM orders o
  LEFT JOIN leads l ON l.id = o.lead_id
  LEFT JOIN accounts a ON a.id = o.account_id`;

export function getOrder(db: Db, id: number): OrderDetail {
  const o = db.prepare(`${ORDER_SQL} WHERE o.id = ?`).get(id) as unknown as OrderRow | undefined;
  if (!o) throw new HttpError(404, 'Not found');
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(id) as unknown as OrderItem[];
  return { ...o, items };
}

export function listOrders(db: Db, q: Query): Paged<OrderRow> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (typeof q.status === 'string' && (ORDER_STATUSES as readonly string[]).includes(q.status)) {
    where.push('o.status = ?');
    params.push(q.status);
  } else if (q.status === 'open') where.push(`o.status IN ('pending', 'confirmed', 'processing')`);
  if (q.lead_id) {
    where.push('o.lead_id = ?');
    params.push(Number(q.lead_id));
  }
  if (typeof q.search === 'string' && q.search.trim()) {
    const s = `%${q.search.trim().replace(/[%_\\]/g, '\\$&')}%`;
    where.push(`(l.name LIKE ? ESCAPE '\\' OR l.company LIKE ? ESCAPE '\\' OR a.name LIKE ? ESCAPE '\\' OR CAST(o.id AS TEXT) = ?)`);
    params.push(s, s, s, q.search.trim().replace(/^#/, ''));
  }
  const sql = `${ORDER_SQL}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(1, Number(q.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 25));
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params) as { n: number }).n;
  const rows = db.prepare(`${sql} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) as unknown as OrderRow[];
  return { rows, total, page, pageSize };
}

export function orderSummary(db: Db, today: string): OrderSummary {
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all() as { status: OrderStatus; n: number }[]) counts[r.status] = r.n;
  const month = today.slice(0, 7);
  const m = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(total_sen), 0) AS v FROM orders WHERE status IN ('confirmed', 'processing', 'delivered') AND substr(created_at, 1, 7) = ?`)
    .get(month) as { n: number; v: number };
  const p = db.prepare(`SELECT COALESCE(SUM(total_sen), 0) AS v FROM orders WHERE status = 'pending'`).get() as { v: number };
  const d = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE substr(created_at, 1, 10) = ?').get(today) as { n: number };
  return { counts, todayCount: d.n, monthValueSen: m.v, monthCount: m.n, pendingValueSen: p.v };
}

interface LineInput {
  product_id: number;
  qty: number;
}

/** Order lines priced from the catalog. Rejects unknown or inactive products and bad quantities. */
function priceLines(db: Db, raw: unknown): { lines: Omit<OrderItem, 'id' | 'order_id'>[]; total: number } {
  if (!Array.isArray(raw) || raw.length === 0) throw bad({ items: 'required' });
  if (raw.length > 50) throw bad({ items: 'tooLong' });
  const lines: Omit<OrderItem, 'id' | 'order_id'>[] = [];
  let total = 0;
  raw.forEach((x, i) => {
    const l = (x ?? {}) as Partial<LineInput>;
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(Number(l.product_id)) as unknown as CatalogProduct | undefined;
    if (!p) throw bad({ [`items.${i}.product_id`]: 'invalid' });
    const qty = Number(l.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1e6) throw bad({ [`items.${i}.qty`]: 'invalid' });
    if (p.min_qty && qty < p.min_qty) throw bad({ [`items.${i}.qty`]: `min:${p.min_qty}` });
    const q = Math.round(qty * 1000) / 1000;
    lines.push({ product_id: p.id, name: p.name, unit: p.unit, qty: q, price_sen: p.price_sen });
    total += Math.round(q * p.price_sen);
  });
  return { lines, total };
}

function writeLines(db: Db, orderId: number, lines: Omit<OrderItem, 'id' | 'order_id'>[]) {
  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
  const ins = db.prepare('INSERT INTO order_items (order_id, product_id, name, unit, qty, price_sen) VALUES (?, ?, ?, ?, ?, ?)');
  for (const l of lines) ins.run(orderId, l.product_id, l.name, l.unit, l.qty, l.price_sen);
}

const stamp = (body: unknown) => {
  const at = (body as { at?: unknown } | null)?.at;
  return typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? at : new Date().toISOString();
};

const dateOrNull = (v: unknown, field: string) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad({ [field]: 'invalid' });
  return v;
};

export function createOrder(db: Db, body: unknown): OrderDetail {
  const b = (body ?? {}) as Record<string, unknown>;
  const lead = db.prepare('SELECT id, account_id FROM leads WHERE id = ?').get(Number(b.lead_id)) as { id: number; account_id: number | null } | undefined;
  if (!lead) throw bad({ lead_id: 'required' });
  const { lines, total } = priceLines(db, b.items);
  const at = stamp(body);
  const source = b.source === 'whatsapp_agent' ? 'whatsapp_agent' : 'manual';
  return tx(db, () => {
    const r = db
      .prepare(
        `INSERT INTO orders (lead_id, account_id, status, total_sen, delivery_date, delivery_address, notes, source, created_at, updated_at)
         VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(lead.id, lead.account_id, total, dateOrNull(b.delivery_date, 'delivery_date'), text(b.delivery_address, 300), text(b.notes, 500), source, at, at);
    const id = Number(r.lastInsertRowid);
    writeLines(db, id, lines);
    return getOrder(db, id);
  });
}

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'delivered', 'cancelled'],
  processing: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

/** The order's main product line by value (for the deal it becomes). */
function mainLine(db: Db, orderId: number): Product {
  const rows = db
    .prepare(
      `SELECT p.category AS c, SUM(i.qty * i.price_sen) AS v FROM order_items i LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ? GROUP BY p.category ORDER BY v DESC`,
    )
    .all(orderId) as { c: string | null; v: number }[];
  const c = rows.find((r) => r.c && r.c !== 'other')?.c;
  return (c ?? 'beef') as Product;
}

/** Records a confirmed order as a won deal (creating the account from the lead if needed). */
function recordDeal(db: Db, order: OrderDetail, today: string): number | null {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(order.lead_id ?? -1) as
    | { id: number; name: string; company: string; industry: string; segment: string; region: string; owner_id: number | null; account_id: number | null; status: string; deal_id: number | null }
    | undefined;
  let accountId = order.account_id ?? lead?.account_id ?? null;
  if (!accountId && lead) {
    const r = db
      .prepare(`INSERT INTO accounts (name, industry, segment, region, employees, owner_id, tier, created_at, source) VALUES (?, ?, ?, ?, 0, ?, 'tier3', ?, 'WhatsApp')`)
      .run(lead.company, lead.industry, lead.segment, lead.region, lead.owner_id, today);
    accountId = Number(r.lastInsertRowid);
    db.prepare('UPDATE leads SET account_id = ? WHERE id = ?').run(accountId, lead.id);
  }
  if (!accountId) return null;
  const acc = db.prepare('SELECT owner_id, name FROM accounts WHERE id = ?').get(accountId) as { owner_id: number | null; name: string };
  const owner =
    lead?.owner_id ??
    acc.owner_id ??
    (db.prepare(`SELECT id FROM reps WHERE active = 1 ORDER BY role = 'AE' DESC, id LIMIT 1`).get() as { id: number } | undefined)?.id ??
    null;
  if (!owner) return null;
  const earlier = db.prepare(`SELECT 1 FROM deals WHERE account_id = ? AND stage = 'won'`).get(accountId);
  const r = db
    .prepare(
      `INSERT INTO deals (name, account_id, owner_id, stage, amount, product, type, source, channel, lead_id, created_at, expected_close, closed_at, stage_changed_at, next_step)
       VALUES (?, ?, ?, 'won', ?, ?, ?, 'sales', NULL, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      `Pesanan #${order.id} · ${acc.name}`,
      accountId,
      owner,
      Math.max(0, Math.round(order.total_sen / 100)),
      mainLine(db, order.id),
      earlier ? 'expansion' : 'new_business',
      lead?.id ?? null,
      today,
      today,
      today,
      today,
    );
  const dealId = Number(r.lastInsertRowid);
  if (lead && lead.status !== 'converted') {
    db.prepare(`UPDATE leads SET status = 'converted', converted_at = ?, deal_id = COALESCE(deal_id, ?) WHERE id = ?`).run(today, dealId, lead.id);
  }
  return dealId;
}

/**
 * Edits an order. Lines and delivery details only while it is pending; status
 * moves along pending -> confirmed -> processing -> delivered, or to cancelled.
 */
export function updateOrder(db: Db, id: number, body: unknown, today: string): OrderDetail {
  const b = (body ?? {}) as Record<string, unknown>;
  const cur = getOrder(db, id);
  const at = stamp(body);
  return tx(db, () => {
    const editing = ['items', 'delivery_date', 'delivery_address', 'notes'].some((k) => k in b);
    if (editing) {
      if (cur.status !== 'pending' && 'items' in b) throw new HttpError(409, 'Only a pending order can change its items');
      if (['delivered', 'cancelled'].includes(cur.status)) throw new HttpError(409, 'This order is closed');
      if ('items' in b) {
        const { lines, total } = priceLines(db, b.items);
        writeLines(db, id, lines);
        db.prepare('UPDATE orders SET total_sen = ? WHERE id = ?').run(total, id);
      }
      if ('delivery_date' in b) db.prepare('UPDATE orders SET delivery_date = ? WHERE id = ?').run(dateOrNull(b.delivery_date, 'delivery_date'), id);
      if ('delivery_address' in b) db.prepare('UPDATE orders SET delivery_address = ? WHERE id = ?').run(text(b.delivery_address, 300), id);
      if ('notes' in b) db.prepare('UPDATE orders SET notes = ? WHERE id = ?').run(text(b.notes, 500), id);
    }
    if ('status' in b && b.status !== cur.status) {
      const next = b.status as OrderStatus;
      if (!NEXT[cur.status].includes(next)) throw bad({ status: 'invalid' });
      db.prepare('UPDATE orders SET status = ?, cancel_reason = ? WHERE id = ?').run(next, next === 'cancelled' ? text(b.cancel_reason, 300) : null, id);
      if (next === 'confirmed' && !cur.deal_id) {
        const dealId = recordDeal(db, getOrder(db, id), today);
        if (dealId) db.prepare('UPDATE orders SET deal_id = ? WHERE id = ?').run(dealId, id);
      }
      // Cancelling after confirmation takes the revenue back out.
      if (next === 'cancelled' && cur.deal_id) {
        db.prepare(`UPDATE deals SET stage = 'lost', lost_reason = 'no_decision', closed_at = ?, stage_changed_at = ? WHERE id = ?`).run(today, today, cur.deal_id);
      }
    }
    // Keep the deal's amount in step if a confirmed order's total changed.
    const after = getOrder(db, id);
    if (after.deal_id && after.status !== 'cancelled') db.prepare('UPDATE deals SET amount = ? WHERE id = ?').run(Math.round(after.total_sen / 100), after.deal_id);
    db.prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(at, id);
    return getOrder(db, id);
  });
}
