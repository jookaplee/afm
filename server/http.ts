import type { Db } from './db.ts';
import { isValidDate } from '../shared/dates.ts';

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export type Query = Record<string, unknown>;

export function str(q: Query, key: string): string | undefined {
  const v = q[key];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function oneOf<T extends string>(q: Query, key: string, allowed: readonly T[]): T | undefined {
  const v = str(q, key);
  if (v === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(v)) throw new HttpError(400, `Invalid value for "${key}"`);
  return v as T;
}

export function intParam(q: Query, key: string, opts: { min?: number; max?: number } = {}): number | undefined {
  const v = str(q, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    throw new HttpError(400, `Invalid value for "${key}"`);
  }
  return n;
}

export function dateParam(q: Query, key: string): string | undefined {
  const v = str(q, key);
  if (v === undefined) return undefined;
  if (!isValidDate(v)) throw new HttpError(400, `Invalid date for "${key}" (expected YYYY-MM-DD)`);
  return v;
}

// ---------- Body validation ----------

type FieldSpec =
  | { type: 'string'; required?: boolean; nullable?: boolean; maxLen?: number }
  | { type: 'int'; required?: boolean; nullable?: boolean; min?: number; max?: number }
  | { type: 'date'; required?: boolean; nullable?: boolean }
  | { type: 'enum'; values: readonly string[]; required?: boolean; nullable?: boolean }
  | { type: 'ref'; table: string; required?: boolean; nullable?: boolean };

export type Schema = Record<string, FieldSpec>;

/**
 * Validates a JSON body against a schema. With `partial`, missing fields are
 * skipped (PATCH semantics). Unknown fields are ignored. Throws 400 with a
 * per-field error map.
 */
export function validateBody(db: Db, body: unknown, schema: Schema, partial = false): Record<string, string | number | null> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Request body must be a JSON object');
  const input = body as Record<string, unknown>;
  const out: Record<string, string | number | null> = {};
  const errors: Record<string, string> = {};

  for (const [key, spec] of Object.entries(schema)) {
    let v = input[key];
    if (typeof v === 'string') v = v.trim();
    const missing = v === undefined || v === '';
    if (missing) {
      if (partial && v === undefined) continue;
      if (spec.required) errors[key] = 'required';
      else if (v === '' || !partial) out[key] = null;
      continue;
    }
    if (v === null) {
      if (spec.required || !spec.nullable) errors[key] = 'required';
      else out[key] = null;
      continue;
    }
    switch (spec.type) {
      case 'string':
        if (typeof v !== 'string') errors[key] = 'invalid';
        else if (spec.maxLen && v.length > spec.maxLen) errors[key] = 'too_long';
        else out[key] = v;
        break;
      case 'int': {
        const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
        if (!Number.isFinite(n) || !Number.isInteger(Math.round(n))) errors[key] = 'invalid';
        else if (spec.min !== undefined && n < spec.min) errors[key] = 'too_small';
        else if (spec.max !== undefined && n > spec.max) errors[key] = 'too_large';
        else out[key] = Math.round(n);
        break;
      }
      case 'date':
        if (!isValidDate(v)) errors[key] = 'invalid';
        else out[key] = v;
        break;
      case 'enum':
        if (typeof v !== 'string' || !spec.values.includes(v)) errors[key] = 'invalid';
        else out[key] = v;
        break;
      case 'ref': {
        const id = typeof v === 'number' ? v : Number(v);
        if (!Number.isInteger(id)) {
          errors[key] = 'invalid';
          break;
        }
        const row = db.prepare(`SELECT id FROM ${spec.table} WHERE id = ?`).get(id);
        if (!row) errors[key] = 'not_found';
        else out[key] = id;
        break;
      }
    }
  }
  if (Object.keys(errors).length) throw new HttpError(400, 'Validation failed', { fields: errors });
  return out;
}
