export class ApiError extends Error {
  status: number;
  fields: Record<string, string>;
  constructor(status: number, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

export function withParams(path: string, params?: Params): string {
  if (!params) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  if (import.meta.env.VITE_STANDALONE === 'true') {
    const { localRequest } = await import('../standalone/local-api.ts');
    const res = await localRequest(method, path, body);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const data = (res.body ?? {}) as { error?: string; details?: { fields?: Record<string, string> } };
    if (res.status >= 400) throw new ApiError(res.status, data.error ?? 'Error', data.details?.fields ?? {});
    return res.body as T;
  }
  const res = await fetch(`/api${path}`, {
    method,
    signal,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, data.error ?? res.statusText, data.details?.fields ?? {});
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, params?: Params, signal?: AbortSignal) => request<T>('GET', withParams(path, params), undefined, signal),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  del: (path: string) => request<void>('DELETE', path),
};
