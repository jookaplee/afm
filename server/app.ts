import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Db } from './db.ts';
import { HttpError, type Query } from './http.ts';
import { marketing, overview, parseFilters, sales } from './analytics.ts';
import * as crud from './crud.ts';
import { seed } from './seed.ts';
import type { MetaResponse } from '../shared/types.ts';

export interface AppOptions {
  db: Db;
  /** Returns the business date used for "today" (overridable for tests). */
  today: () => string;
  appName?: string;
  allowReset?: boolean;
  staticDir?: string;
}

function idParam(req: Request): number {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(400, 'Invalid id');
  return id;
}

export function createApp(opts: AppOptions) {
  const { db, today } = opts;
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  const api = express.Router();
  const q = (req: Request) => req.query as Query;

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });

  api.get('/meta', (_req, res) => {
    const range = db.prepare('SELECT MIN(created_at) AS min, MAX(created_at) AS max FROM deals').get() as { min: string | null; max: string | null };
    const body: MetaResponse = {
      today: today(),
      appName: opts.appName ?? 'AFM',
      reps: db.prepare('SELECT * FROM reps ORDER BY role, name').all() as unknown as MetaResponse['reps'],
      campaigns: db.prepare('SELECT id, name, channel, status FROM campaigns ORDER BY start_date DESC').all() as unknown as MetaResponse['campaigns'],
      dataRange: { min: range.min ?? today(), max: range.max ?? today() },
    };
    res.json(body);
  });

  // Analytics
  api.get('/analytics/overview', (req, res) => {
    res.json(overview(db, parseFilters(q(req), today()), today()));
  });
  api.get('/analytics/sales', (req, res) => {
    res.json(sales(db, parseFilters(q(req), today()), today()));
  });
  api.get('/analytics/marketing', (req, res) => {
    res.json(marketing(db, parseFilters(q(req), today()), today()));
  });

  // Deals
  api.get('/deals', (req, res) => {
    res.json(crud.listDeals(db, q(req)));
  });
  api.get('/deals/:id', (req, res) => {
    res.json(crud.getDeal(db, idParam(req)));
  });
  api.post('/deals', (req, res) => {
    res.status(201).json(crud.createDeal(db, req.body, today()));
  });
  api.patch('/deals/:id', (req, res) => {
    res.json(crud.updateDeal(db, idParam(req), req.body, today()));
  });
  api.delete('/deals/:id', (req, res) => {
    crud.deleteDeal(db, idParam(req));
    res.status(204).end();
  });

  // Leads
  api.get('/leads', (req, res) => {
    res.json(crud.listLeads(db, q(req)));
  });
  api.get('/leads/:id', (req, res) => {
    res.json(crud.getLead(db, idParam(req)));
  });
  api.post('/leads', (req, res) => {
    res.status(201).json(crud.createLead(db, req.body, today()));
  });
  api.patch('/leads/:id', (req, res) => {
    res.json(crud.updateLead(db, idParam(req), req.body, today()));
  });
  api.post('/leads/:id/convert', (req, res) => {
    res.status(201).json(crud.convertLead(db, idParam(req), req.body, today()));
  });
  api.delete('/leads/:id', (req, res) => {
    crud.deleteLead(db, idParam(req));
    res.status(204).end();
  });

  // Campaigns
  api.get('/campaigns', (req, res) => {
    res.json(crud.listCampaigns(db, q(req)));
  });
  api.post('/campaigns', (req, res) => {
    res.status(201).json(crud.createCampaign(db, req.body, today()));
  });
  api.patch('/campaigns/:id', (req, res) => {
    res.json(crud.updateCampaign(db, idParam(req), req.body, today()));
  });
  api.delete('/campaigns/:id', (req, res) => {
    crud.deleteCampaign(db, idParam(req));
    res.status(204).end();
  });

  // Accounts
  api.get('/accounts', (req, res) => {
    res.json(crud.listAccounts(db, q(req)));
  });
  api.get('/accounts/summary', (req, res) => {
    res.json(crud.accountSummary(db, q(req)));
  });
  api.get('/accounts/:id', (req, res) => {
    res.json(crud.getAccount(db, idParam(req)));
  });
  api.post('/accounts', (req, res) => {
    res.status(201).json(crud.createAccount(db, req.body, today()));
  });
  api.patch('/accounts/:id', (req, res) => {
    res.json(crud.updateAccount(db, idParam(req), req.body));
  });
  api.delete('/accounts/:id', (req, res) => {
    crud.deleteAccount(db, idParam(req));
    res.status(204).end();
  });

  // Admin
  api.post('/admin/reset', (_req, res) => {
    if (!opts.allowReset) throw new HttpError(403, 'Reset is disabled on this server');
    res.json(seed(db, { today: today() }));
  });

  api.use((_req, _res) => {
    throw new HttpError(404, 'Not found');
  });

  app.use('/api', api);

  // Production: serve the built single-page app.
  if (opts.staticDir && existsSync(opts.staticDir)) {
    const index = resolve(opts.staticDir, 'index.html');
    app.use(express.static(opts.staticDir, { index: false, maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !req.accepts('html')) return next();
      res.sendFile(index);
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
