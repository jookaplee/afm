import express, { type NextFunction, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Query } from './http.ts';
import { createRouter, type RouterOptions } from './routes.ts';
import { HttpError } from './http.ts';
import type { WaLive } from './wa-live.ts';

export interface AppOptions extends RouterOptions {
  staticDir?: string;
  /** WhatsApp Business Platform webhook, sending and the server-side WhatsApp agent. */
  waLive?: WaLive;
  /** Sign-in for the dashboard and API (HTTP Basic). The WhatsApp webhook stays open: Meta signs it. */
  auth?: { user: string; password: string };
}

const same = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

const fail = (res: Response, e: unknown) => {
  if (e instanceof HttpError) res.status(e.status).json({ error: e.message, ...(e.details ? { details: e.details } : {}) });
  else {
    console.error(e);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export function createApp(opts: AppOptions) {
  const { handle } = createRouter(opts);
  const app = express();
  app.disable('x-powered-by');

  if (opts.auth) {
    const { user, password } = opts.auth;
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/webhooks/whatsapp' || req.path === '/api/health') return next();
      const [scheme, encoded] = (req.get('authorization') ?? '').split(' ');
      if (scheme === 'Basic' && encoded) {
        const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
        if (same(u, user) && same(rest.join(':'), password)) return next();
      }
      res.set('WWW-Authenticate', 'Basic realm="JOOSONS", charset="UTF-8"').status(401).send('Sign in required');
    });
  }

  const wa = opts.waLive;
  if (wa) {
    // Meta's webhook: GET to verify the URL, POST (raw body, signed) for messages and delivery reports.
    app.get('/webhooks/whatsapp', (req: Request, res: Response) => {
      const challenge = wa.verify(req.query as Record<string, unknown>);
      if (challenge === null) res.sendStatus(403);
      else res.type('text/plain').send(challenge);
    });
    app.post('/webhooks/whatsapp', express.raw({ type: '*/*', limit: '2mb' }), (req: Request, res: Response) => {
      wa.handleWebhook(req.body as Buffer, req.get('x-hub-signature-256')).then(
        (status) => res.sendStatus(status),
        (e) => fail(res, e),
      );
    });
  }

  app.use(express.json({ limit: '100kb' }));

  if (wa) {
    // Send through the Business API (a new message, or an approved draft).
    app.post('/api/wa/send', (req: Request, res: Response) => {
      const b = (req.body ?? {}) as { lead_id?: unknown; body?: unknown; message_id?: unknown; template_id?: unknown };
      wa.send(Number(b.lead_id), String(b.body ?? ''), {
        draftId: Number(b.message_id) || undefined,
        templateId: Number(b.template_id) || null,
      }).then((m) => res.status(201).json(m), (e) => fail(res, e));
    });
    // Run the WhatsApp agent on one conversation now (server key).
    app.post('/api/wa/agent/run', (req: Request, res: Response) => {
      if (!wa.agentServer) return void res.status(409).json({ error: 'The WhatsApp agent runs in the browser on this server' });
      wa.runAgent(Number((req.body as { lead_id?: unknown })?.lead_id)).then((out) => res.json(out ?? { busy: true }), (e) => fail(res, e));
    });
  }

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
