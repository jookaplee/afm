import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Query } from './http.ts';
import { createRouter, type RouterOptions } from './routes.ts';

export interface AppOptions extends RouterOptions {
  staticDir?: string;
}

export function createApp(opts: AppOptions) {
  const { handle } = createRouter(opts);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.use('/api', (req: Request, res: Response) => {
    const result = handle(req.method, req.path, req.query as Query, req.body);
    if (result.body === undefined) res.status(result.status).end();
    else res.status(result.status).json(result.body);
  });

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
    if (err && typeof err === 'object' && 'type' in err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
