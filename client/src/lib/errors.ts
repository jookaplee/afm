import { ApiError } from './api.ts';
import type { TFn } from './i18n.tsx';

const KNOWN = new Set(['read_only', 'persist_failed']);

/** A message for the viewer: translated for known reasons, else the server's text. */
export function errorMessage(e: unknown, t: TFn): string {
  if (e instanceof ApiError && e.code && KNOWN.has(e.code)) return t(`error.${e.code}`);
  return e instanceof Error && e.message ? e.message : t('error.generic');
}
