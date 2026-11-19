import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import type { Business, LeadCategory, MetaResponse, Rep } from '../../../shared/types.ts';
import { api } from './api.ts';
import { load, save } from './storage.ts';
import { useI18n } from './i18n.tsx';
import { OWN_THEME } from './env.ts';
import { Alert } from '../components/ui.tsx';

// ---------- Meta (reps, campaigns, business date) ----------

interface MetaValue {
  meta: MetaResponse;
  reload: () => void;
  repName: (id: number | null | undefined) => string;
  aes: Rep[];
  sdrs: Rep[];
  /** Every active rep (lead owners can be any role). */
  activeReps: Rep[];
  /** Businesses of the group, in order. */
  businesses: Business[];
  /** More than one active business: show business choices. */
  multiBusiness: boolean;
  bizName: (id: number | null | undefined) => string;
  /** Lead categories, in order (archived ones included). */
  categories: LeadCategory[];
  category: (key: string | null | undefined) => LeadCategory | undefined;
  /** A category's name in the current language (its key if unknown). */
  catName: (key: string | null | undefined) => string;
  /** Active categories a lead of this business can have (its own and the group-wide ones). */
  categoriesFor: (businessId: number | null | undefined) => LeadCategory[];
}

const MetaContext = createContext<MetaValue | null>(null);

export function MetaProvider({ children }: { children: ReactNode }) {
  const { t, lang } = useI18n();
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
    const businesses = meta.businesses ?? [];
    const categories = meta.categories ?? [];
    const bizById = new Map(businesses.map((b) => [b.id, b.name]));
    const catByKey = new Map(categories.map((c) => [c.key, c]));
    return {
      meta,
      reload,
      repName: (id) => (id ? (byId.get(id) ?? '—') : '—'),
      aes: meta.reps.filter((r) => r.role === 'AE' && r.active),
      sdrs: meta.reps.filter((r) => r.role === 'SDR' && r.active),
      activeReps: meta.reps.filter((r) => r.active),
      businesses,
      multiBusiness: businesses.filter((b) => b.active).length > 1,
      bizName: (id) => (id ? (bizById.get(id) ?? '—') : '—'),
      categories,
      category: (key) => (key ? catByKey.get(key) : undefined),
      catName: (key) => {
        if (!key) return '—';
        const c = catByKey.get(key);
        return c ? (lang === 'en' && c.name_en ? c.name_en : c.name) : key;
      },
      categoriesFor: (businessId) => categories.filter((c) => c.active && (c.business_id == null || businessId == null || c.business_id === businessId)),
    };
  }, [meta, reload, lang]);

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
    if (!OWN_THEME) return; // the hosting page sets the viewer's theme
    const root = document.documentElement;
    if (mode === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', mode);
    save('afm.theme', mode === 'system' ? null : mode);
  }, [mode]);
  const cycle = useCallback(() => setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system')), []);
  return { mode, cycle };
}

// ---------- Confirm dialog ----------
// An in-page replacement for window.confirm(), which some hosts (and embedded
// views) suppress.

interface ConfirmRequest {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}
type ConfirmFn = (req: ConfirmRequest) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<ConfirmFn>(
    (r) =>
      new Promise<boolean>((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setReq(r);
      }),
    [],
  );
  const done = (ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setReq(null);
  };
  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {req && (
        <Alert
          title={t('common.confirmTitle')}
          message={req.message}
          cancelLabel={t('common.cancel')}
          confirmLabel={req.confirmLabel ?? t('common.confirm')}
          destructive={req.danger}
          onCancel={() => done(false)}
          onConfirm={() => done(true)}
        />
      )}
    </ConfirmContext.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmContext);
