import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ForecastInfo, RepPerformance, SalesResponse } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDashboardFilters } from '../lib/filters.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { Card, ErrorState, Hint, Loading, PageHeader, RiskBadge, StageBadge } from '../components/ui.tsx';
import { BarList, ChartCard, columnLabel, KpiTile, Meter, ORDINAL, StatTile, axisProps, gridProps, tooltipContent, xAxisProps } from '../components/charts.tsx';
import { DataTable, useClientSort, type Column } from '../components/DataTable.tsx';

export default function SalesPage() {
  const { t, fmt } = useI18n();
  const { params } = useDashboardFilters();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<SalesResponse>('/analytics/sales', params);

  const repCols = useMemo<Column<RepPerformance>[]>(
    () => [
      {
        key: 'name',
        header: t('col.rep'),
        sortValue: (r) => r.name,
        nowrap: true,
        render: (r) => (
          <div>
            <div className="cell-main">{r.name}</div>
            <div className="cell-sub">{t(`segment.${r.team}`)}</div>
          </div>
        ),
      },
      { key: 'won', header: t('col.won'), align: 'right', sortValue: (r) => r.won, render: (r) => fmt.moneyCompact(r.won), nowrap: true },
      { key: 'quota', header: t('col.quota'), align: 'right', sortValue: (r) => r.quota, render: (r) => fmt.moneyCompact(r.quota), nowrap: true },
      {
        key: 'attainment',
        header: t('col.attainment'),
        sortValue: (r) => r.attainment,
        width: 200,
        render: (r) => (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(80px,1fr) 44px', gap: 8, alignItems: 'center' }}>
            <Meter ratio={r.attainment} label={`${r.name}: ${fmt.pct0(r.attainment)}`} />
            <span className="num" style={{ textAlign: 'right' }}>
              {fmt.pct0(r.attainment)}
            </span>
          </div>
        ),
      },
      { key: 'wonCount', header: t('kpi.dealsWon'), align: 'right', sortValue: (r) => r.wonCount, render: (r) => fmt.num(r.wonCount) },
      { key: 'winRate', header: t('col.winRate'), align: 'right', sortValue: (r) => r.winRate, render: (r) => fmt.pct(r.winRate) },
      {
        key: 'cycle',
        header: t('col.cycle'),
        align: 'right',
        sortValue: (r) => r.avgCycle,
        render: (r) => (r.avgCycle === null ? '—' : t('common.days', { n: Math.round(r.avgCycle) })),
        nowrap: true,
      },
      { key: 'pipeline', header: t('col.openPipeline'), align: 'right', sortValue: (r) => r.openPipeline, render: (r) => fmt.moneyCompact(r.openPipeline), nowrap: true },
      { key: 'activities', header: t('col.activities'), align: 'right', sortValue: (r) => r.activities, render: (r) => fmt.num(r.activities) },
    ],
    [t, fmt],
  );
  const { sorted: reps, sort, setSort } = useClientSort(data?.reps ?? [], repCols, { key: 'won', dir: 'desc' });

  const header = <PageHeader title={t('sales.title')} subtitle={t('sales.subtitle')} />;
  if (!data) {
    return (
      <div className="page">
        {header}
        <FilterBar showOwner />
        {error ? <ErrorState onRetry={reload} /> : <Loading />}
      </div>
    );
  }
  const { kpis } = data;
  type RiskRow = SalesResponse['atRisk'][number];
  const riskCols: Column<RiskRow>[] = [
    {
      key: 'deal',
      header: t('col.deal'),
      render: (d) => (
        <div>
          <div className="cell-main">{d.name}</div>
          <div className="cell-sub">{d.account_name}</div>
        </div>
      ),
    },
    { key: 'owner', header: t('col.owner'), render: (d) => d.owner_name, nowrap: true },
    { key: 'stage', header: t('col.stage'), render: (d) => <StageBadge stage={d.stage} /> },
    {
      key: 'risk',
      header: t('col.risk'),
      render: (d) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {d.overdue_days > 0 && <RiskBadge text={t('risk.overdue', { n: d.overdue_days })} />}
          {d.days_in_stage > 45 && <RiskBadge text={t('risk.stalled', { n: d.days_in_stage })} />}
        </div>
      ),
    },
    { key: 'amount', header: t('col.amount'), align: 'right', render: (d) => fmt.money(d.amount), nowrap: true },
    { key: 'close', header: t('col.expectedClose'), align: 'right', render: (d) => fmt.date(d.expected_close), nowrap: true },
  ];

  return (
    <div className="page">
      {header}
      <FilterBar showOwner />
      {error && <ErrorState onRetry={reload} />}
      <div className={`stack ${loading ? 'refetching' : ''}`}>
        <div className="grid kpis">
          <KpiTile label={t('kpi.revenue')} hint={t('hint.revenue')} kpi={kpis.revenue} format={fmt.moneyCompact} />
          {data.targetAvailable && (
            <KpiTile label={t('kpi.attainment')} hint={t('hint.attainment')} kpi={kpis.attainment} format={fmt.pct0} mode="pp" />
          )}
          <KpiTile label={t('kpi.winRate')} hint={t('hint.winRate')} kpi={kpis.winRate} format={fmt.pct} mode="pp" />
          <KpiTile label={t('kpi.avgDealSize')} hint={t('hint.avgDealSize')} kpi={kpis.avgDealSize} format={fmt.moneyCompact} />
          <KpiTile
            label={t('kpi.salesCycle')}
            hint={t('hint.salesCycle')}
            kpi={kpis.salesCycle}
            format={(v) => (v === null ? '—' : t('common.days', { n: Math.round(v) }))}
            upIsGood={false}
          />
          <KpiTile label={t('kpi.dealsWon')} kpi={kpis.dealsWon} format={fmt.num} />
          <StatTile label={t('kpi.openPipeline')} hint={t('hint.openPipeline')} value={fmt.moneyCompact(kpis.openPipeline)} sub={t('kpi.snapshot')} />
          <StatTile
            label={t('kpi.weightedPipeline')}
            hint={t('hint.weightedPipeline')}
            value={fmt.moneyCompact(kpis.weightedPipeline)}
            sub={kpis.openPipeline ? fmt.pct0(kpis.weightedPipeline / kpis.openPipeline) : undefined}
          />
        </div>

        <div className="grid cols-2">
          <ForecastCard f={data.forecast} />
          <ChartCard
            title={t('chart.pipelineByStage')}
            sub={t('chart.pipelineByStageSub')}
            table={{
              columns: [
                { label: t('col.stage') },
                { label: t('col.count'), align: 'right' },
                { label: t('col.amount'), align: 'right' },
                { label: t('col.weighted'), align: 'right' },
              ],
              rows: data.pipelineByStage.map((s) => [t(`stage.${s.stage}`), fmt.num(s.count), fmt.money(s.amount), fmt.money(s.weighted)]),
            }}
          >
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={data.pipelineByStage} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="stage" {...xAxisProps} tickFormatter={(v: string) => t(`stage.${v}`)} />
                <YAxis {...axisProps} tickFormatter={fmt.axis} width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  content={tooltipContent({ title: (l) => t(`stage.${l}`), value: (v) => fmt.moneyCompact(v), name: () => t('col.amount') })}
                />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
                  {data.pipelineByStage.map((s, i) => (
                    <Cell key={s.stage} fill={ORDINAL[i]} />
                  ))}
                  <LabelList dataKey="amount" content={columnLabel(fmt.moneyCompact)} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <Card title={t('leaderboard.title')} sub={t('leaderboard.sub')} flush>
          <DataTable columns={repCols} rows={reps} rowKey={(r) => r.id} sort={sort} onSort={setSort} caption={t('leaderboard.title')} />
        </Card>

        <div className="grid cols-3">
          <ChartCard
            title={t('chart.winRateBySegment')}
            sub={t('chart.winRateBySegmentSub')}
            table={{
              columns: [{ label: t('col.segment') }, { label: t('col.won'), align: 'right' }, { label: t('col.lost'), align: 'right' }, { label: t('col.winRate'), align: 'right' }],
              rows: data.winRateBySegment.map((s) => [t(`segment.${s.segment}`), fmt.num(s.won), fmt.num(s.lost), fmt.pct(s.rate)]),
            }}
          >
            <BarList
              rows={data.winRateBySegment.map((s) => ({
                key: s.segment,
                label: t(`segment.${s.segment}`),
                value: s.rate ?? 0,
                display: fmt.pct(s.rate),
                title: `${fmt.num(s.won)} / ${fmt.num(s.won + s.lost)}`,
              }))}
            />
          </ChartCard>
          <ChartCard
            title={t('chart.lostReasons')}
            sub={t('chart.lostReasonsSub')}
            table={{
              columns: [{ label: t('col.reason') }, { label: t('col.count'), align: 'right' }, { label: t('col.amount'), align: 'right' }],
              rows: data.lostReasons.map((r) => [t(`lost.${r.reason}`), fmt.num(r.count), fmt.money(r.amount)]),
            }}
          >
            <BarList
              rows={data.lostReasons.map((r) => ({
                key: r.reason,
                label: t(`lost.${r.reason}`),
                value: r.count,
                display: fmt.num(r.count),
                title: fmt.moneyCompact(r.amount),
              }))}
            />
          </ChartCard>
          <ChartCard
            title={t('chart.revenueByProduct')}
            sub={t('chart.revenueByProductSub')}
            table={{
              columns: [{ label: t('col.product') }, { label: t('col.count'), align: 'right' }, { label: t('col.revenue'), align: 'right' }],
              rows: data.revenueByProduct.map((p) => [t(`product.${p.product}`), fmt.num(p.count), fmt.money(p.amount)]),
            }}
          >
            <BarList
              rows={data.revenueByProduct.map((p) => ({
                key: p.product,
                label: t(`product.${p.product}`),
                value: p.amount,
                display: fmt.moneyCompact(p.amount),
              }))}
            />
          </ChartCard>
        </div>

        <Card title={t('chart.atRisk')} sub={t('chart.atRiskSub')} flush>
          <DataTable columns={riskCols} rows={data.atRisk} rowKey={(d) => d.id} onRowClick={(d) => navigate(`/accounts/${d.account_id}`)} />
        </Card>
      </div>
    </div>
  );
}

function ForecastCard({ f }: { f: ForecastInfo }) {
  const { t, fmt } = useI18n();
  const parts = [
    { key: 'won', label: t('forecast.won'), value: f.won, color: 'var(--ord-5)' },
    { key: 'commit', label: t('forecast.commit'), value: f.commit, color: 'var(--ord-4)' },
    { key: 'best', label: t('forecast.bestCase'), value: f.bestCase, color: 'var(--ord-3)' },
    { key: 'pipe', label: t('forecast.pipeline'), value: f.pipeline, color: 'var(--ord-1)' },
  ];
  const sumParts = parts.reduce((s, p) => s + p.value, 0);
  const scale = Math.max(sumParts, f.quota ?? 0, 1);
  const remaining = f.quota !== null ? Math.max(0, f.quota - f.won) : null;
  const coverage = remaining ? (f.commit + f.bestCase + f.pipeline) / remaining : null;

  return (
    <Card title={t('forecast.title', { q: f.quarter })} sub={t('forecast.sub')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ position: 'relative', paddingTop: 4 }}>
          <div
            className="seg-bar"
            role="img"
            aria-label={parts.map((p) => `${p.label}: ${fmt.moneyCompact(p.value)}`).join(', ')}
            style={{ background: 'var(--ord-track)', borderRadius: 4 }}
          >
            {parts
              .filter((p) => p.value > 0)
              .map((p) => (
                <div key={p.key} style={{ width: `calc(${(p.value / scale) * 100}% - 2px)`, background: p.color, flex: 'none' }} title={`${p.label}: ${fmt.moneyCompact(p.value)}`} />
              ))}
          </div>
          {f.quota !== null && (
            <div
              className="meter-marker"
              style={{ left: `calc(${(f.quota / scale) * 100}% - 1px)`, top: 0, bottom: -4, height: 36 }}
              title={`${t('forecast.quota')}: ${fmt.moneyCompact(f.quota)}`}
              aria-hidden
            />
          )}
        </div>
        <div className="meter-list" style={{ gap: 8 }}>
          {parts.map((p) => (
            <div key={p.key} className="hero-row">
              <span className="legend-item">
                <span className="key-rect" style={{ background: p.color }} aria-hidden />
                {p.label}
              </span>
              <strong className="num">{fmt.moneyCompact(p.value)}</strong>
            </div>
          ))}
          <div className="hero-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <span className="legend-item">
              <span className="key-line" style={{ background: 'var(--text-primary)' }} aria-hidden />
              {t('forecast.quota')}
            </span>
            <strong className="num">{f.quota === null ? '—' : fmt.moneyCompact(f.quota)}</strong>
          </div>
          <div className="hero-row">
            <span>{t('forecast.projected')}</span>
            <strong className="num">
              {fmt.moneyCompact(f.projected)}
              {f.quota ? <span className="muted"> · {fmt.pct0(f.projected / f.quota)}</span> : null}
            </strong>
          </div>
          {f.quota !== null ? (
            <>
              <div className="hero-row">
                <span>{t('forecast.gap')}</span>
                <strong className="num">{fmt.moneyCompact(remaining)}</strong>
              </div>
              <div className="hero-row">
                <span className="legend-item">
                  {t('forecast.coverage')}
                  <Hint text={t('forecast.coverageHint')} />
                </span>
                <strong className="num">{coverage === null ? '—' : fmt.multiple(coverage)}</strong>
              </div>
            </>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {t('forecast.noQuota')}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
