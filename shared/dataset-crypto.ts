// Password protection for a prospect list published on a public page.
//
// The dataset is encrypted with AES-256-GCM under a key derived from a password
// (PBKDF2-SHA256), so only ciphertext is committed to the repository and served
// by GitHub Pages; the browser decrypts it after the password is entered.
// Uses Web Crypto, available both in Node 22+ and in browsers on HTTPS/localhost.

export interface SealedDataset {
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  /** base64 */
  salt: string;
  /** base64 */
  iv: string;
  /** base64 ciphertext of the dataset JSON (UTF-8), GCM tag included */
  ct: string;
}

// Spelled via globalThis so the file type-checks with both DOM and Node typings.
type Subtle = typeof globalThis.crypto.subtle;
export type DatasetKey = Awaited<ReturnType<Subtle['importKey']>>;

/** OWASP 2023 guidance for PBKDF2-HMAC-SHA256. */
export const DEFAULT_ITERATIONS = 600_000;

function subtle(): Subtle {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('webcrypto_unavailable');
  return s;
}

const toB64 = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Case, spaces and dashes don't matter when typing the password. */
export function normalizePassword(p: string): string {
  return p.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A random password that is easy to type on a phone, e.g. "k7mq-2vhx-9tnc-w4pr" (80 bits). */
export function generatePassword(groups = 4): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(groups * 4 * 2));
  const chars: string[] = [];
  for (let i = 0; chars.length < groups * 4 && i < bytes.length; i++) {
    // Rejection sampling keeps every character equally likely.
    if (bytes[i] < 256 - (256 % alphabet.length)) chars.push(alphabet[bytes[i] % alphabet.length]);
  }
  if (chars.length < groups * 4) return generatePassword(groups);
  return Array.from({ length: groups }, (_, g) => chars.slice(g * 4, g * 4 + 4).join('')).join('-');
}

export async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<DatasetKey> {
  const material = await subtle().importKey('raw', new TextEncoder().encode(normalizePassword(password)), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    true, // exportable, so a device can remember it instead of the password
    ['encrypt', 'decrypt'],
  );
}

export async function sealDataset(text: string, password: string, iterations = DEFAULT_ITERATIONS): Promise<SealedDataset> {
  if (normalizePassword(password).length < 12) throw new Error('password_too_short');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Rejects (OperationError) when the key is wrong or the data was altered. */
export async function openDataset(sealed: SealedDataset, key: DatasetKey): Promise<string> {
  const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct));
  return new TextDecoder().decode(plain);
}

export function keyForPassword(sealed: SealedDataset, password: string): Promise<DatasetKey> {
  return deriveKey(password, fromB64(sealed.salt), sealed.iter);
}

export async function exportKey(key: DatasetKey): Promise<string> {
  return toB64(new Uint8Array(await subtle().exportKey('raw', key)));
}

export function importKey(b64: string): Promise<DatasetKey> {
  return subtle().importKey('raw', fromB64(b64), { name: 'AES-GCM' }, true, ['decrypt']);
}

export function isSealedDataset(v: unknown): v is SealedDataset {
  const s = v as SealedDataset;
  return !!s && s.v === 1 && s.kdf === 'PBKDF2-SHA256' && typeof s.salt === 'string' && typeof s.iv === 'string' && typeof s.ct === 'string' && Number.isInteger(s.iter) && s.iter > 0;
}
