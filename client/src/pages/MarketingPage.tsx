import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CHANNELS, SOURCES } from '../../../shared/constants.ts';
import type { CampaignPerformance, ChannelPerformance, MarketingResponse } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDashboardFilters } from '../lib/filters.ts';
import { downloadCsv } from '../lib/csv.ts';
import { FilterBar } from '../components/FilterBar.tsx';
import { CampaignStatusBadge, Card, ErrorState, Loading, PageHeader } from '../components/ui.tsx';
import { BarList, ChartCard, Funnel, KpiTile, SERIES, SegmentedBar, axisProps, gridProps, tooltipContent, xAxisProps } from '../components/charts.tsx';
import { DataTable, useClientSort, type Column } from '../components/DataTable.tsx';

const TOP_CAMPAIGNS = 10;
const channelColor = (c: string) => SERIES[CHANNELS.indexOf(c as (typeof CHANNELS)[number])];

export default function MarketingPage() {
  const { t, fmt } = useI18n();
  const { params } = useDashboardFilters();
  const { data, error, loading, reload } = useApi<MarketingResponse>('/analytics/marketing', params);

  const channelCols = useMemo<Column<ChannelPerformance>[]>(
    () => [
      {
        key: 'channel',
        header: t('col.channel'),
        sortValue: (r) => t(`channel.${r.channel}`),
        render: (r) => (
          <span className="legend-item">
            <span className="key-rect" style={{ background: channelColor(r.channel) }} aria-hidden />
            {t(`channel.${r.channel}`)}
          </span>
        ),
        nowrap: true,
      },
      { key: 'spend', header: t('col.spend'), align: 'right', sortValue: (r) => r.spend, render: (r) => fmt.moneyCompact(r.spend), nowrap: true },
      { key: 'leads', header: t('col.leads'), align: 'right', sortValue: (r) => r.leads, render: (r) => fmt.num(r.leads) },
      { key: 'cpl', header: t('col.cpl'), align: 'right', sortValue: (r) => r.cpl, render: (r) => fmt.moneyCompact(r.cpl), nowrap: true },
      { key: 'mqls', header: t('col.mqls'), align: 'right', sortValue: (r) => r.mqls, render: (r) => fmt.num(r.mqls) },
      { key: 'sqls', header: t('col.sqls'), align: 'right', sortValue: (r) => r.sqls, render: (r) => fmt.num(r.sqls) },
      { key: 'opps', header: t('col.opps'), align: 'right', sortValue: (r) => r.opps, render: (r) => fmt.num(r.opps) },
      { key: 'pipeline', header: t('col.pipeline'), align: 'right', sortValue: (r) => r.pipeline, render: (r) => fmt.moneyCompact(r.pipeline), nowrap: true },
      { key: 'revenue', header: t('col.revenue'), align: 'right', sortValue: (r) => r.revenue, render: (r) => fmt.moneyCompact(r.revenue), nowrap: true },
      { key: 'roi', header: t('col.roi'), align: 'right', sortValue: (r) => r.roi, render: (r) => fmt.pct0(r.roi) },
    ],
    [t, fmt],
  );
  const campaignCols = useMemo<Column<CampaignPerformance>[]>(
    () => [
      {
        key: 'name',
        header: t('col.campaign'),
        sortValue: (r) => r.name,
        render: (r) => (
          <div>
            <div className="cell-main">{r.name}</div>
            <div className="cell-sub legend-item">
              <span className="key-rect" style={{ background: channelColor(r.channel) }} aria-hidden />
              {t(`channel.${r.channel}`)}
            </div>
          </div>
        ),
      },
      { key: 'status', header: t('col.status'), sortValue: (r) => r.status, render: (r) => <CampaignStatusBadge status={r.status} /> },
      { key: 'spend', header: t('col.spend'), align: 'right', sortValue: (r) => r.periodSpend, render: (r) => fmt.moneyCompact(r.periodSpend), nowrap: true },
      { key: 'leads', header: t('col.leads'), align: 'right', sortValue: (r) => r.leads, render: (r) => fmt.num(r.leads) },
      { key: 'cpl', header: t('col.cpl'), align: 'right', sortValue: (r) => r.cpl, render: (r) => fmt.moneyCompact(r.cpl), nowrap: true },
      { key: 'mqls', header: t('col.mqls'), align: 'right', sortValue: (r) => r.mqls, render: (r) => fmt.num(r.mqls) },
      { key: 'sqls', header: t('col.sqls'), align: 'right', sortValue: (r) => r.sqls, render: (r) => fmt.num(r.sqls) },
      { key: 'pipeline', header: t('col.pipeline'), align: 'right', sortValue: (r) => r.pipeline, render: (r) => fmt.moneyCompact(r.pipeline), nowrap: true },
      { key: 'revenue', header: t('col.revenue'), align: 'right', sortValue: (r) => r.revenue, render: (r) => fmt.moneyCompact(r.revenue), nowrap: true },
      { key: 'roi', header: t('col.roi'), align: 'right', sortValue: (r) => r.roi, render: (r) => fmt.pct0(r.roi) },
    ],
    [t, fmt],
  );
  const channelSort = useClientSort(data?.channels ?? [], channelCols, { key: 'pipeline', dir: 'desc' });
  const campaignSort = useClientSort(data?.campaigns ?? [], campaignCols, { key: 'pipeline', dir: 'desc' });

  const header = <PageHeader title={t('marketing.title')} subtitle={t('marketing.subtitle')} />;
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

  const exportCampaigns = () =>
    downloadCsv(
      `campaigns_${period.from}_${period.to}.csv`,
      [
        t('col.campaign'),
        t('col.channel'),
        t('col.status'),
        t('field.startDate'),
        t('field.endDate'),
        t('col.budget'),
        t('col.spend'),
        t('col.leads'),
        t('col.mqls'),
        t('col.sqls'),
        t('col.opps'),
        t('col.pipeline'),
        t('col.revenue'),
        t('col.roi'),
        t('col.cpl'),
      ],
      campaignSort.sorted.map((c) => [
        c.name,
        t(`channel.${c.channel}`),
        t(`campaignStatus.${c.status}`),
        c.start_date,
        c.end_date,
        c.budget,
        c.periodSpend,
        c.leads,
        c.mqls,
        c.sqls,
        c.opps,
        c.pipeline,
        c.revenue,
        c.roi === null ? '' : c.roi.toFixed(3),
        c.cpl === null ? '' : Math.round(c.cpl),
      ]),
    );

  return (
    <div className="page">
      {header}
      <FilterBar />
      {error && <ErrorState onRetry={reload} />}
      <div className={`stack ${loading ? 'refetching' : ''}`}>
        <div className="grid kpis">
          <KpiTile label={t('kpi.spend')} hint={t('hint.spend')} kpi={kpis.spend} format={fmt.moneyCompact} upIsGood={false} />
          <KpiTile label={t('kpi.leads')} hint={t('hint.leads')} kpi={kpis.leads} format={fmt.num} />
          <KpiTile label={t('kpi.cpl')} hint={t('hint.cpl')} kpi={kpis.cpl} format={fmt.moneyCompact} upIsGood={false} />
          <KpiTile label={t('kpi.mqls')} kpi={kpis.mqls} format={fmt.num} />
          <KpiTile label={t('kpi.pipelineSourced')} hint={t('hint.pipelineSourced')} kpi={kpis.pipelineSourced} format={fmt.moneyCompact} />
          <KpiTile label={t('kpi.revenueSourced')} hint={t('hint.revenueSourced')} kpi={kpis.revenueSourced} format={fmt.moneyCompact} />
          <KpiTile label={t('kpi.roi')} hint={t('hint.roi')} kpi={kpis.roi} format={fmt.pct0} />
          <KpiTile label={t('kpi.cac')} hint={t('hint.cac')} kpi={kpis.cac} format={fmt.moneyCompact} upIsGood={false} />
        </div>

        <div className="grid cols-3-1">
          <ChartCard
            title={t('chart.leadsByChannel')}
            sub={t('chart.leadsByChannelSub', { g: t(`gran.${g}`) })}
            legend={CHANNELS.map((c, i) => ({ label: t(`channel.${c}`), color: SERIES[i] }))}
            table={{
              columns: [{ label: t('col.period') }, ...CHANNELS.map((c) => ({ label: t(`channel.${c}`), align: 'right' as const }))],
              rows: data.leadsByChannel.map((r) => [fmt.bucketLong(r.bucket, g), ...CHANNELS.map((c) => fmt.num(r[c]))]),
            }}
          >
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.leadsByChannel} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis dataKey="bucket" {...xAxisProps} tickFormatter={(v: string) => fmt.bucket(v, g)} minTickGap={12} />
                <YAxis {...axisProps} tickFormatter={fmt.axis} width={44} allowDecimals={false} />
                <Tooltip
                  cursor={{ fill: 'var(--hover-wash)' }}
                  content={tooltipContent({ title: (l) => fmt.bucketLong(l, g), value: (v) => fmt.num(v), name: (k) => t(`channel.${k}`) })}
                />
                {CHANNELS.map((c, i) => (
                  <Bar
                    key={c}
                    dataKey={c}
                    stackId="leads"
                    fill={SERIES[i]}
                    stroke="var(--surface-1)"
                    strokeWidth={1}
                    maxBarSize={24}
                    radius={i === CHANNELS.length - 1 ? [4, 4, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
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
            title={t('chart.channelPipeline')}
            sub={t('chart.channelPipelineSub')}
            table={{
              columns: [{ label: t('col.channel') }, { label: t('col.pipeline'), align: 'right' }, { label: t('col.revenue'), align: 'right' }],
              rows: data.channels.map((c) => [t(`channel.${c.channel}`), fmt.money(c.pipeline), fmt.money(c.revenue)]),
            }}
          >
            <BarList
              rows={[...data.channels]
                .sort((a, b) => b.pipeline - a.pipeline)
                .map((c) => ({ key: c.channel, label: t(`channel.${c.channel}`), value: c.pipeline, display: fmt.moneyCompact(c.pipeline) }))}
            />
          </ChartCard>
          <ChartCard
            title={t('chart.sourceMix')}
            sub={t('chart.sourceMixSub')}
            table={{
              columns: [{ label: t('col.source') }, { label: t('col.pipeline'), align: 'right' }, { label: t('col.revenue'), align: 'right' }],
              rows: data.sourceMix.map((s) => [t(`source.${s.source}`), fmt.money(s.pipeline), fmt.money(s.revenue)]),
            }}
          >
            <SegmentedBar
              format={fmt.moneyCompact}
              parts={SOURCES.map((s, i) => ({
                key: s,
                label: t(`source.${s}`),
                value: data.sourceMix.find((x) => x.source === s)?.pipeline ?? 0,
                color: SERIES[i],
              }))}
            />
          </ChartCard>
        </div>

        <Card title={t('chart.channelTable')} sub={t('chart.channelTableSub')} flush>
          <DataTable columns={channelCols} rows={channelSort.sorted} rowKey={(r) => r.channel} sort={channelSort.sort} onSort={channelSort.setSort} />
        </Card>

        <Card
          title={t('chart.campaigns')}
          sub={t('chart.campaignsSub')}
          flush
          actions={
            <div className="page-actions">
              <button className="btn sm" onClick={exportCampaigns}>
                <Download aria-hidden />
                {t('common.export')}
              </button>
            </div>
          }
        >
          <DataTable
            columns={campaignCols}
            rows={campaignSort.sorted.slice(0, TOP_CAMPAIGNS)}
            rowKey={(r) => r.id}
            sort={campaignSort.sort}
            onSort={campaignSort.setSort}
          />
          {campaignSort.sorted.length > TOP_CAMPAIGNS && (
            <div className="pager">
              <span>{t('common.rows', { from: 1, to: TOP_CAMPAIGNS, total: campaignSort.sorted.length })}</span>
              <Link to="/campaigns">{t('common.viewAll')}</Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
