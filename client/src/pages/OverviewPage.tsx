import { useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DealRow, OverviewResponse } from '../../../shared/types.ts';
import { SOURCES } from '../../../shared/constants.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDashboardFilters } from '../lib/filters.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { Card, ErrorState, Hint, Loading, PageHeader, StageBadge } from '../components/ui.tsx';
import { ChartCard, columnLabel, Delta, Funnel, KpiTile, Meter, ORDINAL, SERIES, gridProps, tooltipContent, xAxisProps, axisProps } from '../components/charts.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';

export default function OverviewPage() {
  const { t, fmt } = useI18n();
  const { params } = useDashboardFilters();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<OverviewResponse>('/analytics/overview', params);

  const header = <PageHeader title={t('overview.title')} subtitle={t('overview.subtitle')} />;
  if (!data) {
    return (
      <div className="page">
        {header}
        <FilterBar />
        {error ? <ErrorState onRetry={reload} /> : <Loading />}
      </div>
    );
  }

  const { kpis, period } = data;
  const g = period.granularity;
  const gLabel = t(`gran.${g}`);
  const target = kpis.target;
  const revenue = kpis.revenue.value ?? 0;
  const attainment = target ? revenue / target : null;
  // Draw the target line only once quotas exist for the period.
  const showTarget = data.targetAvailable && data.revenueSeries.some((r) => (r.target ?? 0) > 0);
  const noRevenue = data.revenueSeries.every((r) => !r.revenue);

  const closingCols: Column<DealRow>[] = [
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
    { key: 'amount', header: t('col.amount'), align: 'right', render: (d) => fmt.money(d.amount), nowrap: true },
    { key: 'close', header: t('col.expectedClose'), align: 'right', render: (d) => fmt.date(d.expected_close), nowrap: true },
  ];

  return (
    <div className="page">
      {header}
      <FilterBar />
      {error && <ErrorState onRetry={reload} />}
      <div className={`stack ${loading ? 'refetching' : ''}`}>
        {/* Hero: the one number this dashboard leads with */}
        <section className="card hero" aria-label={t('kpi.revenue')}>
          <div>
            <div className="kpi-label">
              {t('kpi.revenue')}
              <Hint text={t('hint.revenue')} />
            </div>
            <div className="hero-value">{fmt.moneyCompact(revenue)}</div>
            <Delta kpi={kpis.revenue} />
          </div>
          <div className="hero-meta">
            {target ? (
              <>
                <div className="hero-row">
                  <span>{t('kpi.ofTarget', { pct: fmt.pct0(attainment) })}</span>
                  <span>
                    {t('kpi.target')} <strong>{fmt.moneyCompact(target)}</strong>
                  </span>
                </div>
                <Meter ratio={attainment} large label={t('kpi.ofTarget', { pct: fmt.pct0(attainment) })} />
                <div className="hero-row">
                  <span>{revenue >= target ? t('kpi.ahead') : t('kpi.gap')}</span>
                  <strong>{fmt.moneyCompact(Math.abs(target - revenue))}</strong>
                </div>
              </>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                {target === null ? t('kpi.targetNA') : t('kpi.noTarget')}
              </p>
            )}
          </div>
        </section>

        <div className="grid kpis">
          <KpiTile label={t('kpi.newPipeline')} hint={t('hint.newPipeline')} kpi={kpis.newPipeline} format={fmt.moneyCompact} />
          <KpiTile label={t('kpi.winRate')} hint={t('hint.winRate')} kpi={kpis.winRate} format={fmt.pct} mode="pp" />
          <KpiTile label={t('kpi.avgDealSize')} hint={t('hint.avgDealSize')} kpi={kpis.avgDealSize} format={fmt.moneyCompact} />
          <KpiTile
            label={t('kpi.salesCycle')}
            hint={t('hint.salesCycle')}
            kpi={kpis.salesCycle}
            format={(v) => (v === null ? '—' : t('common.days', { n: Math.round(v) }))}
            upIsGood={false}
          />
          <KpiTile label={t('kpi.leads')} hint={t('hint.leads')} kpi={kpis.leads} format={fmt.num} />
          <KpiTile label={t('kpi.mqlToSql')} hint={t('hint.mqlToSql')} kpi={kpis.mqlToSql} format={fmt.pct} mode="pp" />
          <KpiTile label={t('kpi.cac')} hint={t('hint.cac')} kpi={kpis.cac} format={fmt.moneyCompact} upIsGood={false} />
          <KpiTile label={t('kpi.marketingRoi')} hint={t('hint.roi')} kpi={kpis.marketingRoi} format={fmt.pct0} />
        </div>

        <div className="grid cols-3-1">
          <ChartCard
            title={t('chart.revenueVsTarget')}
            sub={t('chart.revenueVsTargetSub', { g: gLabel })}
            empty={noRevenue && !showTarget}
            legend={[
              { label: t('col.revenue'), color: SERIES[0] },
              ...(showTarget ? [{ label: t('col.target'), color: 'var(--text-secondary)', kind: 'line' as const }] : []),
            ]}
            table={{
              columns: [{ label: t('col.period') }, { label: t('col.revenue'), align: 'right' }, { label: t('col.target'), align: 'right' }, { label: '%', align: 'right' }],
              rows: data.revenueSeries.map((r) => [
                fmt.bucketLong(r.bucket, g),
                fmt.money(r.revenue),
                fmt.money(r.target),
                r.target ? fmt.pct0(r.revenue / r.target) : '—',
              ]),
            }}
          >
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={data.revenueSeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...xAxisProps} tickFormatter={(v: string) => fmt.bucket(v, g)} minTickGap={12} />
                <YAxis {...axisProps} tickFormatter={fmt.axis} width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  content={tooltipContent({
                    title: (l) => fmt.bucketLong(l, g),
                    value: (v) => fmt.moneyCompact(v),
                    name: (k) => (k === 'revenue' ? t('col.revenue') : t('col.target')),
                  })}
                />
                <Bar dataKey="revenue" fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
                {showTarget && (
                  <Line
                    dataKey="target"
                    stroke="var(--text-secondary)"
                    strokeWidth={2}
                    dot={{ r: 4, fill: 'var(--text-secondary)', stroke: 'var(--surface-1)', strokeWidth: 2 }}
                    activeDot={{ r: 5, stroke: 'var(--surface-1)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={t('chart.funnel')}
            sub={t('chart.funnelSub')}
            table={{
              columns: [{ label: t('col.stage') }, { label: t('col.count'), align: 'right' }, { label: t('col.conversion'), align: 'right' }],
              rows: data.funnel.map((s, i) => [
                t(`funnel.${s.stage}`),
                fmt.num(s.count),
                i === 0 ? '—' : fmt.pct(data.funnel[i - 1].count ? s.count / data.funnel[i - 1].count : 0),
              ]),
            }}
          >
            <Funnel steps={data.funnel.map((s) => ({ key: s.stage, label: t(`funnel.${s.stage}`), count: s.count }))} />
          </ChartCard>
        </div>

        <div className="grid cols-2">
          <ChartCard
            title={t('chart.revenueBySource')}
            sub={t('chart.revenueBySourceSub', { g: gLabel })}
            empty={noRevenue}
            legend={SOURCES.map((s, i) => ({ label: t(`source.${s}`), color: SERIES[i] }))}
            table={{
              columns: [{ label: t('col.period') }, ...SOURCES.map((s) => ({ label: t(`source.${s}`), align: 'right' as const }))],
              rows: data.revenueBySource.map((r) => [fmt.bucketLong(r.bucket, g), ...SOURCES.map((s) => fmt.money(r[s]))]),
            }}
          >
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.revenueBySource} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...xAxisProps} tickFormatter={(v: string) => fmt.bucket(v, g)} minTickGap={12} />
                <YAxis {...axisProps} tickFormatter={fmt.axis} width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  content={tooltipContent({
                    title: (l) => fmt.bucketLong(l, g),
                    value: (v) => fmt.moneyCompact(v),
                    name: (k) => t(`source.${k}`),
                  })}
                />
                {SOURCES.map((s, i) => (
                  <Bar
                    key={s}
                    dataKey={s}
                    stackId="rev"
                    fill={SERIES[i]}
                    stroke="var(--surface-1)"
                    strokeWidth={1}
                    maxBarSize={24}
                    radius={i === SOURCES.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title={t('chart.pipelineByStage')}
            sub={t('chart.pipelineByStageSub')}
            empty={data.pipelineByStage.every((s) => !s.count)}
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
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.pipelineByStage} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="stage" {...xAxisProps} tickFormatter={(v: string) => t(`stage.${v}`)} />
                <YAxis {...axisProps} tickFormatter={fmt.axis} width={52} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  content={tooltipContent({
                    title: (l) => t(`stage.${l}`),
                    value: (v) => fmt.moneyCompact(v),
                    name: () => t('col.amount'),
                  })}
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

        <Card title={t('chart.closingSoon')} sub={t('chart.closingSoonSub')} flush>
          <DataTable
            columns={closingCols}
            rows={data.closingSoon}
            rowKey={(d) => d.id}
            onRowClick={(d) => navigate(`/accounts/${d.account_id}`)}
          />
        </Card>
      </div>
    </div>
  );
}
