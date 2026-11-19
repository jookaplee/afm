// Transport-independent API router. The Express server and the in-browser
// standalone build both call `handle`, so every endpoint behaves identically.

import type { Db } from './schema.ts';
import { HttpError, type Query } from './http.ts';
import { marketing, overview, parseFilters, sales } from './analytics.ts';
import * as crud from './crud.ts';
import { seed } from './seed.ts';
import type { MetaResponse } from '../shared/types.ts';

export interface RouterOptions {
  db: Db;
  /** Returns the business date used for "today" (overridable for tests). */
  today: () => string;
  appName?: string;
  allowReset?: boolean;
  /** Rebuilds the starting data for POST /admin/reset. Defaults to the demo data generator. */
  resetBase?: () => unknown;
}

export interface ApiResult {
  status: number;
  body?: unknown;
}

type Handler = (ctx: { params: Record<string, string>; query: Query; body: unknown }) => ApiResult | unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const src = path.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
    keys.push(k);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${src}/?$`), keys };
}

function id(params: Record<string, string>): number {
  const n = Number(params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Invalid id');
  return n;
}

const created = (body: unknown): ApiResult => ({ status: 201, body });
const noContent: ApiResult = { status: 204 };

export function createRouter(opts: RouterOptions) {
  const { db, today } = opts;
  const routes: Route[] = [];
  const on = (method: string, path: string, handler: Handler) => routes.push({ method, ...compile(path), handler });

  on('GET', '/health', () => ({ ok: true }));

  on('GET', '/meta', () => {
    const range = db.prepare('SELECT MIN(created_at) AS min, MAX(created_at) AS max FROM deals').get() as { min: string | null; max: string | null };
    const body: MetaResponse = {
      today: today(),
      appName: opts.appName ?? 'JOOSONS',
      reps: db.prepare('SELECT * FROM reps ORDER BY role, name').all() as unknown as MetaResponse['reps'],
      campaigns: db.prepare('SELECT id, name, channel, status FROM campaigns ORDER BY start_date DESC').all() as unknown as MetaResponse['campaigns'],
      dataRange: { min: range.min ?? today(), max: range.max ?? today() },
    };
    return body;
  });

  // Analytics
  on('GET', '/analytics/overview', ({ query }) => overview(db, parseFilters(query, today()), today()));
  on('GET', '/analytics/sales', ({ query }) => sales(db, parseFilters(query, today()), today()));
  on('GET', '/analytics/marketing', ({ query }) => marketing(db, parseFilters(query, today()), today()));

  // Deals
  on('GET', '/deals', ({ query }) => crud.listDeals(db, query));
  on('GET', '/deals/:id', ({ params }) => crud.getDeal(db, id(params)));
  on('POST', '/deals', ({ body }) => created(crud.createDeal(db, body, today())));
  on('PATCH', '/deals/:id', ({ params, body }) => crud.updateDeal(db, id(params), body, today()));
  on('DELETE', '/deals/:id', ({ params }) => {
    crud.deleteDeal(db, id(params));
    return noContent;
  });

  // Leads
  on('GET', '/leads', ({ query }) => crud.listLeads(db, query));
  on('GET', '/leads/:id', ({ params }) => crud.getLead(db, id(params)));
  on('POST', '/leads', ({ body }) => created(crud.createLead(db, body, today())));
  on('PATCH', '/leads/:id', ({ params, body }) => crud.updateLead(db, id(params), body, today()));
  on('POST', '/leads/:id/convert', ({ params, body }) => created(crud.convertLead(db, id(params), body, today())));
  on('DELETE', '/leads/:id', ({ params }) => {
    crud.deleteLead(db, id(params));
    return noContent;
  });

  // Campaigns
  on('GET', '/campaigns', ({ query }) => crud.listCampaigns(db, query));
  on('POST', '/campaigns', ({ body }) => created(crud.createCampaign(db, body, today())));
  on('PATCH', '/campaigns/:id', ({ params, body }) => crud.updateCampaign(db, id(params), body, today()));
  on('DELETE', '/campaigns/:id', ({ params }) => {
    crud.deleteCampaign(db, id(params));
    return noContent;
  });

  // Accounts
  on('GET', '/accounts', ({ query }) => crud.listAccounts(db, query));
  on('GET', '/accounts/summary', ({ query }) => crud.accountSummary(db, query));
  on('GET', '/accounts/:id', ({ params }) => crud.getAccount(db, id(params)));
  on('POST', '/accounts', ({ body }) => created(crud.createAccount(db, body, today())));
  on('PATCH', '/accounts/:id', ({ params, body }) => crud.updateAccount(db, id(params), body));
  on('DELETE', '/accounts/:id', ({ params }) => {
    crud.deleteAccount(db, id(params));
    return noContent;
  });

  // Sales team
  on('GET', '/reps', () => crud.listReps(db, today()));
  on('POST', '/reps', ({ body }) => created(crud.createRep(db, body, today())));
  on('PATCH', '/reps/:id', ({ params, body }) => crud.updateRep(db, id(params), body, today()));

  // Admin
  on('POST', '/admin/reset', () => {
    if (!opts.allowReset) throw new HttpError(403, 'Reset is disabled on this server');
    return opts.resetBase ? opts.resetBase() : seed(db, { today: today() });
  });

  /** Dispatches one API call. `path` is relative to /api (e.g. "/deals/3"). Never throws. */
  function handle(method: string, path: string, query: Query, body: unknown): ApiResult {
    try {
      let methodMismatch = false;
      for (const r of routes) {
        const m = r.pattern.exec(path);
        if (!m) continue;
        if (r.method !== method.toUpperCase()) {
          methodMismatch = true;
          continue;
        }
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const out = r.handler({ params, query, body });
        if (out && typeof out === 'object' && 'status' in out && typeof (out as ApiResult).status === 'number' && Object.keys(out).every((k) => k === 'status' || k === 'body')) {
          return out as ApiResult;
        }
        return { status: 200, body: out };
      }
      throw new HttpError(methodMismatch ? 405 : 404, methodMismatch ? 'Method not allowed' : 'Not found');
    } catch (err) {
      if (err instanceof HttpError) {
        return { status: err.status, body: { error: err.message, ...(err.details ? { details: err.details } : {}) } };
      }
      console.error(err);
      return { status: 500, body: { error: 'Internal server error' } };
    }
  }

  return { handle };
}
