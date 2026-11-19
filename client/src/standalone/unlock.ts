// Opens a password-protected prospect list embedded in the page
// (<script id="crm-dataset-sealed">, see `npm run seal`). The decrypted data only
// ever lives in this tab's memory; a device that should remember the password
// keeps the derived AES key (not the password) in localStorage, or in
// sessionStorage for this visit only.
import { exportKey, importKey, isSealedDataset, keyForPassword, openDataset, type SealedDataset } from '../../../shared/dataset-crypto.ts';

const KEY = 'joosons.datasetKey';

let unlocked: string | null = null;

/** The decrypted dataset JSON, once the page has been unlocked. */
export function unlockedDataset(): string | null {
  return unlocked;
}

/** The sealed dataset embedded in the page, if any. */
export function sealedDataset(): SealedDataset | null {
  const doc = (globalThis as { document?: { getElementById(id: string): { textContent: string | null } | null } }).document;
  const text = doc?.getElementById('crm-dataset-sealed')?.textContent;
  if (!text) return null;
  try {
    const v: unknown = JSON.parse(text);
    return isSealedDataset(v) ? v : null;
  } catch {
    return null;
  }
}

function storages(): Storage[] {
  const out: Storage[] = [];
  try {
    out.push(localStorage);
  } catch {
    /* blocked */
  }
  try {
    out.push(sessionStorage);
  } catch {
    /* blocked */
  }
  return out;
}

/** Tries a key this device remembered. False when there is none or it no longer fits. */
export async function unlockWithSavedKey(sealed: SealedDataset): Promise<boolean> {
  for (const s of storages()) {
    try {
      const raw = s.getItem(KEY);
      if (!raw) continue;
      const saved = JSON.parse(raw) as { salt?: string; key?: string };
      // A re-sealed dataset has a new salt: the old key cannot open it.
      if (saved.salt !== sealed.salt || !saved.key) throw new Error('stale key');
      unlocked = await openDataset(sealed, await importKey(saved.key));
      return true;
    } catch {
      try {
        s.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }
  }
  return false;
}

/**
 * False for a wrong password. Throws only when the browser cannot decrypt at all
 * (no Web Crypto, e.g. a page opened over plain http).
 */
export async function unlockWithPassword(sealed: SealedDataset, password: string, remember: boolean): Promise<boolean> {
  const key = await keyForPassword(sealed, password);
  try {
    unlocked = await openDataset(sealed, key);
  } catch {
    return false;
  }
  try {
    forgetKey();
    (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify({ salt: sealed.salt, key: await exportKey(key) }));
  } catch {
    /* storage blocked: unlocked for this visit only */
  }
  return true;
}

/** Locks this device again; the password is needed on the next visit. */
export function forgetKey(): void {
  for (const s of storages()) {
    try {
      s.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
