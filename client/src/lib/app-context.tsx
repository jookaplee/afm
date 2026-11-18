import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { MetaResponse, Rep } from '../../../shared/types.ts';
import { api } from './api.ts';
import { load, save } from './storage.ts';
import { useI18n } from './i18n.tsx';

// ---------- Meta (reps, campaigns, business date) ----------

interface MetaValue {
  meta: MetaResponse;
  reload: () => void;
  repName: (id: number | null | undefined) => string;
  aes: Rep[];
  sdrs: Rep[];
}

const MetaContext = createContext<MetaValue | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    api
      .get<MetaResponse>('/meta')
      .then((m) => {
        setMeta(m);
        setError(null);
      })
      .catch((e: Error) => setError(e));
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const value = useMemo<MetaValue | null>(() => {
    if (!meta) return null;
    const byId = new Map(meta.reps.map((r) => [r.id, r.name]));
    return {
      meta,
      reload,
      repName: (id) => (id ? (byId.get(id) ?? '—') : '—'),
      aes: meta.reps.filter((r) => r.role === 'AE'),
      sdrs: meta.reps.filter((r) => r.role === 'SDR'),
    };
  }, [meta, reload]);

  if (error && !meta) {
    return (
      <div className="error-box">
        <p>{t('common.error')}</p>
        <button className="btn" onClick={reload}>
          {t('common.retry')}
        </button>
      </div>
    );
  }
  if (!value) return <div className="loading-box">{t('common.loading')}</div>;
  return <MetaContext.Provider value={value}>{children}</MetaContext.Provider>;
}

export function useMeta(): MetaValue {
  const v = useContext(MetaContext);
  if (!v) throw new Error('useMeta must be used inside MetaProvider');
  return v;
}

// ---------- Toasts ----------

type ToastKind = 'good' | 'bad';
interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}
const ToastContext = createContext<(text: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: ToastKind = 'good') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { id, text, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`}>
            {x.kind === 'good' ? <CheckCircle2 aria-hidden /> : <AlertCircle aria-hidden />}
            <span>{x.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

// ---------- Theme ----------

export type ThemeMode = 'system' | 'light' | 'dark';

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const v = load('afm.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  });
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    save('afm.theme', mode === 'system' ? null : mode);
  }, [mode]);
  const cycle = useCallback(() => setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system')), []);
  return { mode, cycle };
}
