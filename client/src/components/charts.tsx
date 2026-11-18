import { useState, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, BarChart3, Minus, Table2 } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';
import type { Kpi } from '../../../shared/types.ts';
import { Hint } from './ui.tsx';

// ---------- Palette helpers ----------

/** Categorical slots in fixed order. Colour follows the entity, never its rank. */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
export const ORDINAL = ['var(--ord-1)', 'var(--ord-2)', 'var(--ord-3)', 'var(--ord-4)', 'var(--ord-5)'];

export const axisProps = {
  tick: { fill: 'var(--text-axis)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
} as const;
export const xAxisProps = {
  ...axisProps,
  axisLine: { stroke: 'var(--axis)' },
  tickMargin: 8,
} as const;
export const gridProps = { vertical: false, stroke: 'var(--grid)' } as const;

// ---------- Legend ----------

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'rect' | 'line';
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend" role="list">
      {items.map((it) => (
        <span className="legend-item" role="listitem" key={it.label}>
          <span className={it.kind === 'line' ? 'key-line' : 'key-rect'} style={{ background: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}

// ---------- Tooltip ----------

interface TooltipRow {
  name?: string | number;
  value?: number | string | (number | string)[];
  color?: string;
  dataKey?: string | number | ((obj: unknown) => unknown);
}

/** Recharts tooltip content: value leads (strong), the series name follows, keyed by a short line. */
export function tooltipContent(opts: {
  title: (label: string) => string;
  value: (v: number, key: string) => string;
  name?: (key: string) => string;
  hideZero?: boolean;
}) {
  return function TooltipBody(props: { active?: boolean; payload?: readonly TooltipRow[]; label?: string | number }) {
    const { active, payload, label } = props;
    if (!active || !payload?.length) return null;
    const rows = payload.filter((p) => !(opts.hideZero && Number(p.value) === 0));
    return (
      <div className="chart-tooltip">
        <div className="tt-title">{opts.title(String(label ?? ''))}</div>
        {rows.map((p) => {
          const key = String(p.dataKey ?? p.name ?? '');
          return (
            <div className="tt-row" key={key}>
              <span className="key-line" style={{ background: p.color }} aria-hidden />
              <strong>{opts.value(Number(p.value), key)}</strong>
              <span>{opts.name ? opts.name(key) : String(p.name ?? key)}</span>
            </div>
          );
        })}
      </div>
    );
  };
}

// ---------- Chart card with a table-view twin ----------

export interface TableView {
  columns: { label: string; align?: 'right' }[];
  rows: ReactNode[][];
}

export function ChartCard({
  title,
  sub,
  legend,
  table,
  children,
  actions,
  className,
}: {
  title: string;
  sub?: string;
  legend?: LegendItem[];
  table?: TableView;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [asTable, setAsTable] = useState(false);
  return (
    <section className={`card ${className ?? ''}`}>
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        <div className="page-actions">
          {actions}
          {table && (
            <button
              className="btn sm ghost icon"
              onClick={() => setAsTable((v) => !v)}
              aria-pressed={asTable}
              title={asTable ? t('common.showChart') : t('common.showTable')}
              aria-label={asTable ? t('common.showChart') : t('common.showTable')}
            >
              {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
            </button>
          )}
        </div>
      </div>
      {asTable && table ? (
        <div className="card-body flush table-scroll">
          <table className="data">
            <thead>
              <tr>
                {table.columns.map((c) => (
                  <th key={c.label} className={c.align}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((cell, j) => (
                    <td key={j} className={table.columns[j]?.align === 'right' ? 'right num' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          {legend && legend.length > 1 && <div style={{ paddingTop: 10 }}><Legend items={legend} /></div>}
          <div className="card-body">{children}</div>
        </>
      )}
    </section>
  );
}

// ---------- KPI tile ----------

export type DeltaMode = 'pct' | 'pp';

export function Sparkline({ values, width = 84, height = 28 }: { values: (number | null)[]; width?: number; height?: number }) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null && Number.isFinite(p.v));
  if (pts.length < 2) return null;
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i: number) => 3 + (i / Math.max(1, values.length - 1)) * (width - 6);
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} preserveAspectRatio="none" aria-hidden style={{ flex: '0 1 auto', minWidth: 0, maxWidth: '45%' }}>
      <path d={d} fill="none" stroke="var(--series-muted)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={3.5} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
    </svg>
  );
}

export function Delta({ kpi, mode = 'pct', upIsGood = true }: { kpi: Kpi; mode?: DeltaMode; upIsGood?: boolean }) {
  const { t, fmt } = useI18n();
  const { value, prev } = kpi;
  if (value === null || prev === null) return <span className="delta flat">{t('filter.vsPrev')}: —</span>;
  let diff: number;
  let text: string;
  if (mode === 'pp') {
    diff = value - prev;
    text = `${diff >= 0 ? '+' : '−'}${fmt.dec(Math.abs(diff) * 100)} pp`;
  } else {
    if (prev === 0) return <span className="delta flat">{t('filter.vsPrev')}: —</span>;
    diff = (value - prev) / Math.abs(prev);
    text = `${diff >= 0 ? '+' : '−'}${fmt.pct(Math.abs(diff))}`;
  }
  const flat = Math.abs(diff) < 0.0005;
  const good = flat ? null : diff > 0 === upIsGood;
  const cls = flat ? 'flat' : good ? 'good' : 'bad';
  const Icon = flat ? Minus : diff > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`delta ${cls}`} title={t('filter.vsPrev')}>
      <Icon aria-hidden />
      {text}
      <span className="sr-only"> {t('filter.vsPrev')}</span>
    </span>
  );
}

export function KpiTile({
  label,
  kpi,
  format,
  hint,
  mode,
  upIsGood,
  footer,
}: {
  label: string;
  kpi: Kpi;
  format: (v: number | null) => string;
  hint?: string;
  mode?: DeltaMode;
  upIsGood?: boolean;
  footer?: ReactNode;
}) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className="kpi-value">{format(kpi.value)}</div>
      <div className="kpi-foot">
        {footer ?? <Delta kpi={kpi} mode={mode} upIsGood={upIsGood} />}
        <Sparkline values={kpi.trend} />
      </div>
    </div>
  );
}

/** A plain stat tile with no comparison (e.g. a snapshot value). */
export function StatTile({ label, value, hint, sub }: { label: string; value: string; hint?: string; sub?: ReactNode }) {
  return (
    <div className="card kpi">
      <div className="kpi-label">
        {label}
        {hint && <Hint text={hint} />}
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-foot">
        <span className="delta flat">{sub}</span>
      </div>
    </div>
  );
}

// ---------- Meter ----------

export function Meter({ ratio, large, label }: { ratio: number | null; large?: boolean; label: string }) {
  const r = ratio ?? 0;
  const cls = r >= 0.9 ? '' : r >= 0.7 ? 'warning' : 'critical';
  return (
    <div
      className={`meter ${large ? 'lg' : ''}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(r * 100)}
    >
      <div className={`meter-fill ${cls}`} style={{ width: `${Math.min(100, r * 100)}%` }} />
      {r > 1 && <div className="meter-marker" style={{ left: `${(1 / r) * 100}%` }} aria-hidden />}
    </div>
  );
}

// ---------- Ranked horizontal bars (one hue) ----------

export function BarList({
  rows,
  color = 'var(--series-1)',
}: {
  rows: { key: string; label: ReactNode; value: number; display: string; title?: string }[];
  color?: string;
}) {
  const { t } = useI18n();
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length || max <= 0) return <div className="empty">{t('common.noData')}</div>;
  return (
    <div className="meter-list" role="list">
      {rows.map((r) => (
        <div className="meter-row" role="listitem" key={r.key} title={r.title}>
          <span className="funnel-name">{r.label}</span>
          <div className="funnel-track" style={{ height: 18 }}>
            <div
              className="funnel-bar"
              style={{ width: `${(r.value / max) * 100}%`, minWidth: r.value > 0 ? 2 : 0, background: color, borderRadius: '0 4px 4px 0', maxWidth: '100%' }}
            />
          </div>
          <span className="funnel-value" style={{ fontWeight: 500, minWidth: 64 }}>
            {r.display}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------- Funnel ----------

export function Funnel({ steps }: { steps: { key: string; label: string; count: number }[] }) {
  const { t, fmt } = useI18n();
  const max = Math.max(1, ...steps.map((s) => s.count));
  if (!steps.length || steps[0].count === 0) return <div className="empty">{t('common.noData')}</div>;
  return (
    <div className="funnel" role="list">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null;
        return (
          <div className="funnel-step" key={s.key} role="listitem">
            <div className="funnel-top">
              <span className="funnel-name">
                {s.label}
                {prev !== null && <span className="conv">{t('chart.conv', { pct: fmt.pct(prev > 0 ? s.count / prev : 0) })}</span>}
              </span>
              <span className="funnel-value">{fmt.num(s.count)}</span>
            </div>
            <div className="funnel-track" style={{ height: 14 }}>
              <div
                className="funnel-bar"
                style={{ width: `${(s.count / max) * 100}%`, minWidth: s.count > 0 ? 2 : 0, background: ORDINAL[i] ?? ORDINAL[4], borderRadius: '0 4px 4px 0' }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Value label above a column, rendered as one line (Recharts' default label wraps to the bar width). */
export function columnLabel(format: (v: number) => string) {
  return function ColumnLabel(props: { x?: number | string; y?: number | string; width?: number | string; value?: unknown }) {
    const x = Number(props.x ?? 0) + Number(props.width ?? 0) / 2;
    const y = Number(props.y ?? 0) - 8;
    return (
      <text x={x} y={y} textAnchor="middle" fill="var(--text-secondary)" fontSize={12}>
        {format(Number(props.value))}
      </text>
    );
  };
}

// ---------- Segmented bar (one whole split into <= 6 parts) ----------

export function SegmentedBar({
  parts,
  format,
}: {
  parts: { key: string; label: string; value: number; color: string }[];
  format: (v: number) => string;
}) {
  const { t, fmt } = useI18n();
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <div className="empty">{t('common.noData')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="seg-bar" role="img" aria-label={parts.map((p) => `${p.label}: ${format(p.value)}`).join(', ')}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <div key={p.key} style={{ flex: `${p.value} 1 0`, background: p.color }} title={`${p.label}: ${format(p.value)} (${fmt.pct(p.value / total)})`} />
          ))}
      </div>
      <div className="meter-list">
        {parts.map((p) => (
          <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}>
            <span className="legend-item">
              <span className="key-rect" style={{ background: p.color }} aria-hidden />
              {p.label}
            </span>
            <span className="num">
              <strong>{format(p.value)}</strong> <span className="muted">· {fmt.pct(p.value / total)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
