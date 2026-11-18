import { useEffect, useId, useRef, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
  Clock,
  Info,
  PlayCircle,
  Search,
  X,
  XCircle,
} from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';
import type { CampaignStatus, LeadStatus, Stage } from '../../../shared/constants.ts';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  flush,
  className,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className ?? ''}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <p>{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      <div className={flush ? 'card-body flush' : 'card-body'}>{children}</div>
    </section>
  );
}

export function Hint({ text }: { text: string }) {
  return (
    <span className="hint" title={text} aria-label={text} role="img">
      <Info aria-hidden />
    </span>
  );
}

const STAGE_DOT: Record<string, string> = {
  prospecting: 'var(--ord-1)',
  qualification: 'var(--ord-2)',
  proposal: 'var(--ord-3)',
  negotiation: 'var(--ord-4)',
};

export function StageBadge({ stage }: { stage: Stage }) {
  const { t } = useI18n();
  if (stage === 'won')
    return (
      <span className="badge good">
        <CheckCircle2 aria-hidden />
        {t('stage.won')}
      </span>
    );
  if (stage === 'lost')
    return (
      <span className="badge bad">
        <XCircle aria-hidden />
        {t('stage.lost')}
      </span>
    );
  return (
    <span className="badge">
      <span className="dot" style={{ background: STAGE_DOT[stage] }} aria-hidden />
      {t(`stage.${stage}`)}
    </span>
  );
}

export function LeadStatusBadge({ status }: { status: LeadStatus }) {
  const { t } = useI18n();
  const icon =
    status === 'converted' ? (
      <CheckCircle2 aria-hidden />
    ) : status === 'disqualified' ? (
      <XCircle aria-hidden />
    ) : status === 'new' ? (
      <Circle aria-hidden />
    ) : (
      <CircleDot aria-hidden />
    );
  const cls = status === 'converted' ? 'good' : status === 'disqualified' ? 'bad' : '';
  return (
    <span className={`badge ${cls}`}>
      {icon}
      {t(`leadStatus.${status}`)}
    </span>
  );
}

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const { t } = useI18n();
  const icon = status === 'active' ? <PlayCircle aria-hidden /> : status === 'planned' ? <Clock aria-hidden /> : <CheckCircle2 aria-hidden />;
  return (
    <span className={`badge ${status === 'active' ? 'good' : ''}`}>
      {icon}
      {t(`campaignStatus.${status}`)}
    </span>
  );
}

export function RiskBadge({ text }: { text: string }) {
  return (
    <span className="badge warn">
      <AlertTriangle aria-hidden />
      {text}
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <label className="search">
      <Search aria-hidden />
      <span className="sr-only">{placeholder ?? t('common.search')}</span>
      <input className="input" type="search" value={value} placeholder={placeholder ?? t('common.search')} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SelectFilter<T extends string>({
  value,
  onChange,
  options,
  allLabel,
  label,
  render,
}: {
  value: T | undefined | '';
  onChange: (v: T | undefined) => void;
  options: readonly T[];
  allLabel: string;
  label: string;
  render: (v: T) => string;
}) {
  return (
    <select className="select" aria-label={label} value={value ?? ''} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
      <option value="">{allLabel}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { key: T; label: string; count?: number }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {items.map((it) => (
        <button key={it.key} role="tab" className="tab" aria-selected={value === it.key} onClick={() => onChange(it.key)}>
          {it.label}
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t, fmt } = useI18n();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager">
      <span>{t('common.rows', { from: fmt.num(from), to: fmt.num(to), total: fmt.num(total) })}</span>
      <div className="row">
        <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft aria-hidden />
          {t('common.prev')}
        </button>
        <span className="num">
          {page} / {pages}
        </span>
        <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
          <ChevronRight aria-hidden />
        </button>
      </div>
    </div>
  );
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="error-box" role="alert">
      <p>{t('common.error')}</p>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function Loading() {
  const { t } = useI18n();
  return <div className="loading-box">{t('common.loading')}</div>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-x)');
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const els = ref.current.querySelectorAll<HTMLElement>('input, select, textarea, button, a[href]');
        if (!els.length) return;
        const firstEl = els[0];
        const lastEl = els[els.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button className="btn ghost icon modal-x" onClick={onClose} aria-label={t('common.close')}>
            <X aria-hidden />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({
  label,
  error,
  help,
  full,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  help?: string;
  full?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  const { t } = useI18n();
  return (
    <div className={`field ${full ? 'full' : ''}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <span className="err">{t(`common.${error}`)}</span> : help ? <span className="help">{help}</span> : null}
    </div>
  );
}
