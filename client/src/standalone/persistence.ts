// Durable storage for the standalone build.
//
// The page never stores the whole database. It stores a *journal* of the
// changes people make (each create / update / delete API call), plus a small
// meta document with the date the demo data was generated from. On load the
// demo data is regenerated deterministically from that date and the journal
// is replayed on top, which reproduces exactly the same records and ids.

/** Bump when the demo-data generator changes in a way that alters ids. */
export const SEED_VERSION = 1;

export interface ChangeRecord {
  /** Which data generation the change belongs to (a reset starts a new one). */
  epoch: string;
  /** Ordering key (ms), strictly increasing within an epoch. */
  ts: number;
  method: string;
  path: string;
  /** The business date when the change was made (replayed with the same date). */
  today: string;
  body: unknown;
  /** Random id of the browser session that wrote it (diagnostics). */
  origin: string;
}

export interface Meta {
  epoch: string;
  /** Date the demo data was generated from. */
  anchor: string;
  seedVersion: number;
}

export interface Store {
  /** Where changes are kept: the artifact's shared database, or this browser only. */
  kind: 'cloud' | 'device';
  /** false: this viewer may read but not save changes. */
  canWrite: boolean;
  readMeta(): Promise<Meta | null>;
  writeMeta(meta: Meta): Promise<void>;
  /** Changes of one epoch with ts > afterTs, oldest first. */
  listChanges(epoch: string, afterTs?: number): Promise<ChangeRecord[]>;
  appendChange(change: ChangeRecord): Promise<void>;
  /** Best-effort clean-up of changes from earlier epochs. */
  pruneOtherEpochs(epoch: string): Promise<void>;
}

// ---------- claude.ai artifact `db` capability ----------

interface DocSnap {
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}
interface QuerySnap {
  docs: (DocSnap & { id: string })[];
}
interface DocRef {
  get(): Promise<DocSnap>;
  set(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
}
interface QueryRef {
  where(field: string, op: string, value: unknown): QueryRef;
  orderBy(field: string, dir?: 'asc' | 'desc'): QueryRef;
  limit(n: number): QueryRef;
  get(): Promise<QuerySnap>;
}
interface CollectionRef extends QueryRef {
  doc(id?: string): DocRef;
}
interface ArtifactDb {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
}
interface ArtifactUser {
  can(name: string): Promise<boolean | null>;
}
interface ClaudeHost {
  use(name: string): Promise<unknown>;
}

const PAGE = 1000; // the store's maximum page size
const META = 'state/meta';
const CHANGES = 'changes';

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Connects to the artifact's shared document store when the page is shown by
 * a claude.ai viewer that grants it. Returns null anywhere else (a local file,
 * another host, a signed-out visitor): the app then keeps changes in memory.
 */
export async function connectArtifactStore(): Promise<Store | null> {
  const host = (globalThis as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return null;
  let db: ArtifactDb | null = null;
  let user: ArtifactUser | null = null;
  try {
    [db, user] = (await withTimeout(Promise.all([host.use('db'), host.use('user')]), 12_000, 'connect')) as [ArtifactDb | null, ArtifactUser | null];
  } catch {
    return null;
  }
  if (!db) return null;
  const store = db;
  let canWrite = true;
  try {
    // null = the platform did not say; let a refused write decide.
    canWrite = (await user?.can('data.write')) !== false;
  } catch {
    canWrite = true;
  }

  const toChange = (d: Record<string, unknown> | undefined): ChangeRecord | null => {
    if (!d || typeof d.ts !== 'number' || typeof d.method !== 'string' || typeof d.path !== 'string') return null;
    return {
      epoch: String(d.epoch),
      ts: d.ts,
      method: d.method,
      path: d.path,
      today: String(d.today),
      body: d.body ?? undefined,
      origin: String(d.origin ?? ''),
    };
  };

  return {
    kind: 'cloud',
    canWrite,
    async readMeta() {
      const snap = await withTimeout(store.doc(META).get(), 10_000, 'read meta');
      const d = snap.exists ? snap.data() : undefined;
      if (!d || typeof d.epoch !== 'string' || typeof d.anchor !== 'string') return null;
      return { epoch: d.epoch, anchor: d.anchor, seedVersion: Number(d.seedVersion ?? 0) };
    },
    async writeMeta(meta) {
      await store.doc(META).set({ ...meta });
    },
    async listChanges(epoch, afterTs = -1) {
      const out: ChangeRecord[] = [];
      let after = afterTs;
      for (;;) {
        const snap = await withTimeout(
          store.collection(CHANGES).where('epoch', '==', epoch).where('ts', '>', after).orderBy('ts').limit(PAGE).get(),
          10_000,
          'read changes',
        );
        for (const doc of snap.docs) {
          const c = toChange(doc.data());
          if (c) out.push(c);
        }
        if (snap.docs.length < PAGE || !out.length) break;
        after = out[out.length - 1].ts;
      }
      return out;
    },
    async appendChange(change) {
      const body: Record<string, unknown> = { ...change };
      if (body.body === undefined) delete body.body;
      await store.collection(CHANGES).doc().set(body);
    },
    async pruneOtherEpochs(epoch) {
      const snap = await store.collection(CHANGES).where('epoch', '!=', epoch).limit(200).get();
      for (const doc of snap.docs) await store.collection(CHANGES).doc(doc.id).delete();
    },
  };
}

// ---------- This browser's own storage (any other host, e.g. GitHub Pages) ----------

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const LS_META = 'joosons.meta';
const LS_CHANGES = 'joosons.changes';

/**
 * Keeps the journal in this browser (localStorage), so changes survive reloads
 * on this device. Returns null when storage is unavailable (private mode,
 * blocked site data).
 */
export function browserStore(storage?: KeyValueStorage): Store | null {
  let ls: KeyValueStorage;
  try {
    ls = storage ?? globalThis.localStorage;
    if (!ls) return null;
    const probe = 'joosons.probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
  } catch {
    return null;
  }
  const readChanges = (): ChangeRecord[] => {
    try {
      const v = JSON.parse(ls.getItem(LS_CHANGES) ?? '[]');
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  return {
    kind: 'device',
    canWrite: true,
    async readMeta() {
      try {
        const m = JSON.parse(ls.getItem(LS_META) ?? 'null');
        return m && typeof m.epoch === 'string' && typeof m.anchor === 'string' ? m : null;
      } catch {
        return null;
      }
    },
    async writeMeta(meta) {
      ls.setItem(LS_META, JSON.stringify(meta));
    },
    async listChanges(epoch, afterTs = -1) {
      return readChanges()
        .filter((c) => c.epoch === epoch && c.ts > afterTs)
        .sort((a, b) => a.ts - b.ts);
    },
    async appendChange(change) {
      // Re-read first: another tab of this browser may have added changes.
      const all = readChanges();
      all.push(change);
      ls.setItem(LS_CHANGES, JSON.stringify(all)); // throws when the quota is full
    },
    async pruneOtherEpochs(epoch) {
      ls.setItem(LS_CHANGES, JSON.stringify(readChanges().filter((c) => c.epoch === epoch)));
    },
  };
}

/** An in-memory Store, used by tests to simulate reloads. */
export function memoryStore(canWrite = true): Store & { changes: ChangeRecord[]; meta: Meta | null; failNextWrite: boolean } {
  const s = {
    kind: 'cloud' as const,
    canWrite,
    changes: [] as ChangeRecord[],
    meta: null as Meta | null,
    failNextWrite: false,
    async readMeta() {
      return s.meta ? { ...s.meta } : null;
    },
    async writeMeta(meta: Meta) {
      if (s.failNextWrite) {
        s.failNextWrite = false;
        throw Object.assign(new Error('refused'), { code: 'invalid_argument' });
      }
      s.meta = { ...meta };
    },
    async listChanges(epoch: string, afterTs = -1) {
      return s.changes.filter((c) => c.epoch === epoch && c.ts > afterTs).sort((a, b) => a.ts - b.ts).map((c) => JSON.parse(JSON.stringify(c)));
    },
    async appendChange(change: ChangeRecord) {
      if (s.failNextWrite) {
        s.failNextWrite = false;
        throw Object.assign(new Error('refused'), { code: 'invalid_argument' });
      }
      s.changes.push(JSON.parse(JSON.stringify(change)));
    },
    async pruneOtherEpochs(epoch: string) {
      s.changes = s.changes.filter((c) => c.epoch === epoch);
    },
  };
  return s;
}
