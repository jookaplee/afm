import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type Params } from './api.ts';

/**
 * Fetches `path` whenever it or its params change. The previous data is kept
 * while a refetch is in flight so charts hold their frame (no skeleton flash).
 */
export function useApi<T>(path: string | null, params?: Params) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}|${JSON.stringify(params ?? {})}` : null;
  const paramsRef = useRef(params);
  paramsRef.current = params;

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    setLoading(true);
    api
      .get<T>(path, paramsRef.current, ctrl.signal)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) => {
        if ((e as Error).name !== 'AbortError') setError(e as Error);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}
