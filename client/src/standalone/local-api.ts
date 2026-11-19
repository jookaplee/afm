// In-browser API for the standalone build: the same router the Node server
// uses, backed by SQLite compiled to plain JavaScript (sql.js, asm.js build -
// no WebAssembly, so it runs under strict content-security policies too).
//
// Persistence: when the page is opened in a claude.ai viewer that grants the
// artifact `db` capability, every successful change is appended to a journal
// there (see persistence.ts) and replayed on the next load. Anywhere else the
// data lives in memory for the session.
import type { SqlJsStatic } from 'sql.js';
import { initSchema, type Db } from '../../../server/schema.ts';
import { seed } from '../../../server/seed.ts';
import { createRouter, type ApiResult } from '../../../server/routes.ts';
import { todayLocal } from '../../../shared/dates.ts';
import { wrapSqlJs } from './sqljs-db.ts';
import { browserStore, connectArtifactStore, type ChangeRecord, type Store } from './persistence.ts';
import { datasetFingerprint, importCrm, parseCrmInput } from '../../../server/import-crm.ts';
import { sealedDataset, unlockedDataset } from './unlock.ts';

export type PersistenceMode = 'cloud' | 'device' | 'memory' | 'readonly';

export interface PersistenceInfo {
  mode: PersistenceMode;
  /** Changes replayed from storage on this load (plus any saved since). */
  savedChanges: number;
  /** Date the demo data was generated from. */
  anchor: string;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const randomId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

/** The data a fresh database starts from. `id` changes whenever the data would. */
export interface BaseData {
  id: string;
  load: (db: Db, today: string) => void;
}

/** Bump the version when the demo generator changes in a way that alters ids. */
export const DEMO_BASE: BaseData = { id: 'demo-2', load: (db, today) => void seed(db, { today }) };

/** Starting data from an imported prospect list (the CRM export JSON or HTML). */
export function crmBase(text: string): BaseData {
  const dataset = parseCrmInput(text);
  return { id: `crm-${datasetFingerprint(text)}`, load: (db, today) => void importCrm(db, dataset, { today }) };
}

/** Creates an API instance. `store` null = in-memory only. */
export async function createLocalApi(deps: { SQL: SqlJsStatic; store: Store | null; today?: () => string; base?: BaseData }) {
  const today = deps.today ?? todayLocal;
  const { SQL, store } = deps;
  const base = deps.base ?? DEMO_BASE;
  const origin = randomId();

  let mode: PersistenceMode = store ? (store.canWrite ? store.kind : 'readonly') : 'memory';
  const saving = () => mode === 'cloud' || mode === 'device';
  let db: Db;
  let handle: (m: string, p: string, q: Record<string, string>, b: unknown) => ApiResult;
  let anchor = today();
  let epoch = 'e1';
  let journal: ChangeRecord[] = [];
  /** Whether the stored meta document matches this session's epoch and anchor. */
  let metaSaved = false;
  /** Saved changes exist for different starting data and should be cleaned up. */
  let staleData = false;
  /** Business date seen by the router; overridden while replaying old changes. */
  let replayDate: string | null = null;

  const split = (pathAndQuery: string) => {
    const url = new URL(pathAndQuery, 'http://local');
    const query: Record<string, string> = {};
    url.searchParams.forEach((v, k) => {
      query[k] = v;
    });
    return { path: url.pathname, query };
  };

  const apply = (c: ChangeRecord): ApiResult => {
    const { path, query } = split(c.path);
    replayDate = c.today;
    try {
      return handle(c.method, path, query, c.body === undefined ? undefined : JSON.parse(JSON.stringify(c.body)));
    } finally {
      replayDate = null;
    }
  };

  /** Rebuilds the starting data from `seedDate` and replays `changes` on top. */
  const build = (seedDate: string, changes: ChangeRecord[]) => {
    const raw = new SQL.Database();
    db = wrapSqlJs(raw);
    initSchema(db);
    base.load(db, seedDate);
    handle = createRouter({ db, today: () => replayDate ?? today(), appName: 'JOOSONS', allowReset: true }).handle;
    anchor = seedDate;
    let failed = 0;
    for (const c of changes) if (apply(c).status >= 400) failed++;
    if (failed) console.warn(`[afm] ${failed} saved change(s) could not be replayed`);
    journal = [...changes];
  };

  // Initial load.
  let changes: ChangeRecord[] = [];
  if (store) {
    try {
      const meta = await store.readMeta();
      if (meta && meta.base === base.id) {
        epoch = meta.epoch;
        changes = await store.listChanges(epoch);
        if (changes.length) {
          anchor = meta.anchor;
          metaSaved = true;
        }
      } else if (meta) {
        // The starting data changed: earlier changes belong to other data. Start afresh;
        // they are removed once this session saves its first change.
        epoch = randomId();
        staleData = true;
      }
    } catch (err) {
      console.warn('[afm] could not read saved changes; continuing without saving', err);
      mode = 'memory';
      changes = [];
    }
  }
  // With no saved changes the demo data always starts from today.
  build(changes.length ? anchor : today(), changes);

  const lastTs = () => (journal.length ? journal[journal.length - 1].ts : 0);
  const err = (status: number, code: string, message: string): ApiResult => ({ status, body: { error: message, code } });

  /** Saves one change; on failure rebuilds from the saved journal so memory matches storage. */
  const persist = async (method: string, pathAndQuery: string, body: unknown): Promise<ApiResult | null> => {
    if (!store || !saving()) return null;
    const change: ChangeRecord = {
      epoch,
      ts: Math.max(Date.now(), lastTs() + 1),
      method,
      path: pathAndQuery,
      today: today(),
      body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)),
      origin,
    };
    try {
      if (!metaSaved) {
        await store.writeMeta({ epoch, anchor, base: base.id });
        metaSaved = true;
        if (staleData) {
          staleData = false;
          void store.pruneOtherEpochs(epoch).catch(() => {});
        }
      }
      await store.appendChange(change);
      journal.push(change);
      return null;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'invalid_argument' || code === 'not_granted' || code === 'revoked') mode = 'readonly';
      build(anchor, journal);
      return mode === 'readonly'
        ? err(403, 'read_only', 'You can view this page but not save changes.')
        : err(503, 'persist_failed', 'The change could not be saved. Please try again.');
    }
  };

  /** Applies changes other people saved since this page loaded, before writing on top of them. */
  const syncForeign = async () => {
    if (!store || !saving()) return;
    try {
      const newer = await store.listChanges(epoch, lastTs());
      for (const c of newer) {
        apply(c);
        journal.push(c);
      }
    } catch {
      /* best effort: the write below still orders after everything we know */
    }
  };

  const reset = async (): Promise<ApiResult> => {
    if (mode === 'readonly') return err(403, 'read_only', 'You can view this page but not save changes.');
    const date = today();
    if (store && saving()) {
      const next = randomId();
      try {
        await store.writeMeta({ epoch: next, anchor: date, base: base.id });
      } catch {
        return err(503, 'persist_failed', 'The change could not be saved. Please try again.');
      }
      epoch = next;
      metaSaved = true;
      void store.pruneOtherEpochs(next).catch(() => {});
    }
    build(date, []);
    const counts = db.prepare(
      `SELECT (SELECT COUNT(*) FROM reps) AS reps, (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM campaigns) AS campaigns,
              (SELECT COUNT(*) FROM leads) AS leads, (SELECT COUNT(*) FROM deals) AS deals, (SELECT COUNT(*) FROM activities) AS activities`,
    ).get();
    return { status: 200, body: counts };
  };

  // Writes run one at a time, in order.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  };

  async function request(method: string, pathAndQuery: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const m = method.toUpperCase();
    const { path, query } = split(pathAndQuery);
    let res: ApiResult;
    if (m === 'GET' && path === '/_persistence') {
      const info: PersistenceInfo = { mode, savedChanges: journal.length, anchor };
      res = { status: 200, body: info };
    } else if (!MUTATING.has(m)) {
      res = handle(m, path, query, undefined);
    } else {
      res = await serial(async () => {
        if (path === '/admin/reset') return reset();
        if (mode === 'readonly') return err(403, 'read_only', 'You can view this page but not save changes.');
        await syncForeign();
        const input = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
        const out = handle(m, path, query, input);
        if (out.status >= 400) return out;
        return (await persist(m, pathAndQuery, input)) ?? out;
      });
    }
    return { status: res.status, body: res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body)) };
  }

  return { request };
}

// ---------- The page's single instance ----------

let instance: ReturnType<typeof createLocalApi> | null = null;

function api() {
  // A locked page must never fall back to demo data: the base mismatch would
  // start a fresh journal and drop the changes saved with the prospect list.
  if (!instance && sealedDataset() && !unlockedDataset()) return Promise.reject(new Error('dataset_locked'));
  instance ??= (async () => {
    const [{ default: initSqlJs }, cloud] = await Promise.all([import('sql.js/dist/sql-asm-memory-growth.js'), connectArtifactStore()]);
    // Outside a claude.ai viewer (or when its database is unavailable) keep changes in this browser.
    const store = cloud ?? browserStore();
    const SQL = await initSqlJs();
    // A prospect list embedded in the page replaces the demo data: either plain
    // (<script id="crm-dataset">) or password-protected and already unlocked.
    const doc = (globalThis as { document?: { getElementById(id: string): { textContent: string | null } | null } }).document;
    const embedded = unlockedDataset() ?? doc?.getElementById('crm-dataset')?.textContent;
    let base = DEMO_BASE;
    if (embedded && embedded.trim()) {
      try {
        base = crmBase(embedded);
      } catch (e) {
        console.warn('[afm] embedded dataset could not be read; using demo data', e);
      }
    }
    return createLocalApi({ SQL, store, base });
  })();
  return instance;
}

/** Same contract as an HTTP call: JSON in, JSON out, status code. */
export async function localRequest(method: string, pathAndQuery: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  return (await api()).request(method, pathAndQuery, body);
}
