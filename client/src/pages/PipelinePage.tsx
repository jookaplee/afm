import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { AlertTriangle, Plus } from 'lucide-react';
import { REGIONS, SEGMENTS, STAGES, type LostReason, type Region, type Segment, type Stage } from '../../../shared/constants.ts';
import * as D from '../../../shared/dates.ts';
import type { DealRow, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMeta, useToast } from '../lib/app-context.tsx';
import { ErrorState, Loading, PageHeader, SearchInput, SelectFilter, StageBadge } from '../components/ui.tsx';
import { DealFormModal, LostReasonModal } from '../components/forms.tsx';

const MAX_CARDS = 40;

export default function PipelinePage() {
  const { t, fmt } = useI18n();
  const { meta, aes } = useMeta();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [segment, setSegment] = useState<Segment | undefined>();
  const [region, setRegion] = useState<Region | undefined>();
  const [showClosed, setShowClosed] = useState(false);
  const [editing, setEditing] = useState<DealRow | 'new' | null>(null);
  const [pendingLost, setPendingLost] = useState<DealRow | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const q = useDebounced(search);

  const params = { pageSize: 5000, search: q, owner, segment, region, sort: 'amount', dir: 'desc' };
  const open = useApi<Paged<DealRow>>('/deals', { ...params, stage: 'open' });
  const closed = useApi<Paged<DealRow>>(showClosed ? '/deals' : null, { ...params, stage: 'closed' });
  const cutoff = D.addDays(meta.today, -30);

  const [rows, setRows] = useState<DealRow[]>([]);
  useEffect(() => {
    const recentClosed = showClosed ? (closed.data?.rows ?? []).filter((d) => (d.closed_at ?? '') >= cutoff) : [];
    setRows([...(open.data?.rows ?? []), ...recentClosed]);
  }, [open.data, closed.data, showClosed, cutoff]);

  const byStage = useMemo(() => {
    const m = new Map<Stage, DealRow[]>(STAGES.map((s) => [s, []]));
    for (const d of rows) m.get(d.stage)?.push(d);
    for (const list of m.values()) list.sort((a, b) => b.amount - a.amount);
    return m;
  }, [rows]);

  const reloadAll = () => {
    open.reload();
    if (showClosed) closed.reload();
  };

  const move = async (deal: DealRow, stage: Stage, lostReason?: LostReason) => {
    const before = rows;
    setRows((rs) => rs.map((d) => (d.id === deal.id ? { ...d, stage } : d)));
    try {
      const updated = await api.patch<DealRow>(`/deals/${deal.id}`, { stage, ...(lostReason ? { lost_reason: lostReason } : {}) });
      setRows((rs) => rs.map((d) => (d.id === deal.id ? updated : d)));
      toast(t('pipeline.moved', { deal: deal.name, stage: t(`stage.${stage}`) }));
    } catch (e) {
      setRows(before);
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  const onDrop = (e: DragEvent, stage: Stage) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const deal = rows.find((d) => d.id === id);
    setDragId(null);
    if (!deal || deal.stage === stage) return;
    if (stage === 'lost') setPendingLost(deal);
    else void move(deal, stage);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('pipeline.title')}
        subtitle={t('pipeline.subtitle')}
        actions={
          <button className="btn primary" onClick={() => setEditing('new')}>
            <Plus aria-hidden />
            {t('deals.new')}
          </button>
        }
      />
      <div className="filter-bar">
        <SearchInput value={search} onChange={setSearch} />
        <select className="select" aria-label={t('col.owner')} value={owner} onChange={(e) => setOwner(e.target.value)}>
          <option value="">{t('filter.allReps')}</option>
          {aes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <SelectFilter label={t('col.segment')} value={segment} onChange={setSegment} options={SEGMENTS} allLabel={t('filter.allSegments')} render={(v) => t(`segment.${v}`)} />
        <SelectFilter label={t('col.region')} value={region} onChange={setRegion} options={REGIONS} allLabel={t('filter.allRegions')} render={(v) => t(`region.${v}`)} />
        <label className="legend-item" style={{ marginLeft: 4 }}>
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
          {t('pipeline.showClosed')}
        </label>
      </div>
      <p className="sr-only">{t('pipeline.dragHint')}</p>

      {open.error && !open.data ? (
        <ErrorState onRetry={reloadAll} />
      ) : !open.data ? (
        <Loading />
      ) : (
        <div className={`kanban ${open.loading ? 'refetching' : ''}`}>
          {STAGES.map((stage) => {
            const list = byStage.get(stage) ?? [];
            const total = list.reduce((s, d) => s + d.amount, 0);
            return (
              <section
                key={stage}
                className={`kanban-col ${over === stage ? 'drop' : ''}`}
                aria-label={t(`stage.${stage}`)}
                onDragOver={(e) => {
                  if (dragId === null) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (over !== stage) setOver(stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
                }}
                onDrop={(e) => onDrop(e, stage)}
              >
                <div className="kanban-head">
                  <div className="title">
                    <StageBadge stage={stage} />
                    <span className="muted num">{fmt.num(list.length)}</span>
                  </div>
                  <div className="sub">{fmt.moneyCompact(total)}</div>
                </div>
                <div className="kanban-list">
                  {list.slice(0, MAX_CARDS).map((d) => {
                    const overdue = d.stage !== 'won' && d.stage !== 'lost' && d.expected_close < meta.today;
                    return (
                      <div
                        role="button"
                        tabIndex={0}
                        key={d.id}
                        className={`deal-card ${dragId === d.id ? 'dragging' : ''}`}
                        draggable
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setEditing(d);
                          }
                        }}
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', String(d.id));
                          e.dataTransfer.effectAllowed = 'move';
                          setDragId(d.id);
                        }}
                        onDragEnd={() => {
                          setDragId(null);
                          setOver(null);
                        }}
                        onClick={() => setEditing(d)}
                      >
                        <span className="cell-main">{d.account_name}</span>
                        <span className="cell-sub">{d.name}</span>
                        <span className="amount num">{fmt.moneyCompact(d.amount)}</span>
                        <span className="meta">
                          <span>{d.owner_name}</span>
                          <span
                            className="legend-item"
                            style={overdue ? { color: 'var(--warning-text)', fontWeight: 600 } : undefined}
                            title={overdue ? t('risk.overdue', { n: D.diffDays(d.expected_close, meta.today) }) : undefined}
                          >
                            {overdue && <AlertTriangle aria-hidden style={{ width: 12, height: 12 }} />}
                            {fmt.date(d.closed_at ?? d.expected_close)}
                            {overdue && <span className="sr-only">{t('risk.overdue', { n: D.diffDays(d.expected_close, meta.today) })}</span>}
                          </span>
                        </span>
                      </div>
                    );
                  })}
                  {list.length > MAX_CARDS && <div className="kanban-more">{t('pipeline.moreCards', { n: fmt.num(list.length - MAX_CARDS) })}</div>}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {editing && (
        <DealFormModal
          deal={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
      {pendingLost && (
        <LostReasonModal
          dealName={pendingLost.name}
          onCancel={() => setPendingLost(null)}
          onConfirm={(reason) => {
            const d = pendingLost;
            setPendingLost(null);
            void move(d, 'lost', reason);
          }}
        />
      )}
    </div>
  );
}
