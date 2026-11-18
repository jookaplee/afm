import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { ABM_TIERS, INDUSTRIES, REGIONS, SEGMENTS, type AbmTier, type Industry, type Region, type Segment } from '../../../shared/constants.ts';
import type { AccountRow, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { CAN_DOWNLOAD } from '../lib/env.ts';
import { ErrorState, PageHeader, Pager, SearchInput, SelectFilter, Switch } from '../components/ui.tsx';
import { BarList, ChartCard, SERIES, SegmentedBar, StatTile } from '../components/charts.tsx';
import { DataTable, type Column, type SortState } from '../components/DataTable.tsx';
import { AccountFormModal } from '../components/forms.tsx';

interface Summary {
  totals: { accounts: number; customers: number; revenue: number; pipeline: number };
  bySegment: { key: Segment; accounts: number; customers: number; revenue: number; pipeline: number }[];
  byIndustry: { key: Industry; accounts: number; customers: number; revenue: number; pipeline: number }[];
}

const PAGE_SIZE = 25;

export default function AccountsPage() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<Segment | undefined>();
  const [region, setRegion] = useState<Region | undefined>();
  const [industry, setIndustry] = useState<Industry | undefined>();
  const [tier, setTier] = useState<AbmTier | undefined>();
  const [customers, setCustomers] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'won_revenue', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search);
  const filters = useMemo(
    () => ({ search: q, segment, region, industry, tier, customers: customers ? 'true' : undefined }),
    [q, segment, region, industry, tier, customers],
  );
  useEffect(() => setPage(1), [filters]);
  const list = useApi<Paged<AccountRow>>('/accounts', { ...filters, sort: sort.key, dir: sort.dir, page, pageSize: PAGE_SIZE });
  const summary = useApi<Summary>('/accounts/summary', { segment, region, industry, tier });

  const columns: Column<AccountRow>[] = [
    {
      key: 'name',
      header: t('col.account'),
      sortKey: 'name',
      render: (a) => (
        <div>
          <div className="cell-main">{a.name}</div>
          <div className="cell-sub">{t(`industry.${a.industry}`)}</div>
        </div>
      ),
    },
    { key: 'segment', header: t('col.segment'), sortKey: 'segment', render: (a) => t(`segment.${a.segment}`), nowrap: true },
    { key: 'region', header: t('col.region'), render: (a) => t(`region.${a.region}`) },
    { key: 'tier', header: t('col.tier'), render: (a) => t(`tier.${a.tier}`), nowrap: true },
    { key: 'owner', header: t('col.owner'), render: (a) => a.owner_name ?? '—', nowrap: true },
    { key: 'won', header: t('col.revenue'), sortKey: 'won_revenue', align: 'right', render: (a) => fmt.moneyCompact(a.won_revenue), nowrap: true },
    {
      key: 'pipeline',
      header: t('col.openPipeline'),
      sortKey: 'open_pipeline',
      align: 'right',
      render: (a) => (
        <div>
          <div>{fmt.moneyCompact(a.open_pipeline)}</div>
          {a.open_deals > 0 && <div className="cell-sub">{fmt.num(a.open_deals)} {t('tab.open').toLowerCase()}</div>}
        </div>
      ),
      nowrap: true,
    },
    { key: 'leads', header: t('col.leads'), align: 'right', render: (a) => fmt.num(a.leads) },
    { key: 'last', header: t('col.lastActivity'), sortKey: 'last_activity', align: 'right', render: (a) => fmt.date(a.last_activity), nowrap: true },
  ];

  const exportCsv = async () => {
    try {
      const all = await api.get<Paged<AccountRow>>('/accounts', { ...filters, sort: sort.key, dir: sort.dir, pageSize: 5000 });
      downloadCsv(
        'accounts.csv',
        ['ID', t('col.account'), t('col.industry'), t('col.segment'), t('col.region'), t('col.tier'), t('col.owner'), t('col.employees'), t('col.revenue'), t('col.openPipeline'), t('col.leads'), t('col.lastActivity')],
        all.rows.map((a) => [
          a.id,
          a.name,
          t(`industry.${a.industry}`),
          t(`segment.${a.segment}`),
          t(`region.${a.region}`),
          t(`tier.${a.tier}`),
          a.owner_name,
          a.employees,
          a.won_revenue,
          a.open_pipeline,
          a.leads,
          a.last_activity ?? '',
        ]),
      );
    } catch (e) {
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  const s = summary.data;
  return (
    <div className="page">
      <PageHeader
        title={t('accounts.title')}
        subtitle={t('accounts.subtitle')}
        actions={
          <>
            {CAN_DOWNLOAD && (
              <button className="btn" onClick={exportCsv}>
                <Download aria-hidden />
                {t('common.export')}
              </button>
            )}
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('accounts.new')}
            </button>
          </>
        }
      />
      <div className="filter-bar">
        <SelectFilter label={t('col.segment')} value={segment} onChange={setSegment} options={SEGMENTS} allLabel={t('filter.allSegments')} render={(v) => t(`segment.${v}`)} />
        <SelectFilter label={t('col.region')} value={region} onChange={setRegion} options={REGIONS} allLabel={t('filter.allRegions')} render={(v) => t(`region.${v}`)} />
        <SelectFilter label={t('col.industry')} value={industry} onChange={setIndustry} options={INDUSTRIES} allLabel={t('filter.allIndustries')} render={(v) => t(`industry.${v}`)} />
        <SelectFilter label={t('col.tier')} value={tier} onChange={setTier} options={ABM_TIERS} allLabel={t('filter.allTiers')} render={(v) => t(`tier.${v}`)} />
      </div>
      {s && (
        <div className={`stack ${summary.loading ? 'refetching' : ''}`}>
          <div className="grid kpis">
            <StatTile label={t('kpi.accounts')} value={fmt.num(s.totals.accounts)} />
            <StatTile
              label={t('kpi.customers')}
              value={fmt.num(s.totals.customers)}
              sub={s.totals.accounts ? fmt.pct(s.totals.customers / s.totals.accounts) : undefined}
            />
            <StatTile label={t('kpi.lifetimeRevenue')} value={fmt.moneyCompact(s.totals.revenue)} />
            <StatTile label={t('kpi.openPipeline')} value={fmt.moneyCompact(s.totals.pipeline)} hint={t('hint.openPipeline')} />
          </div>
          <div className="grid cols-2">
            <ChartCard
              title={t('chart.revenueByIndustry')}
              sub={t('chart.revenueByIndustrySub')}
              table={{
                columns: [
                  { label: t('col.industry') },
                  { label: t('col.accounts'), align: 'right' },
                  { label: t('col.customers'), align: 'right' },
                  { label: t('col.revenue'), align: 'right' },
                  { label: t('col.openPipeline'), align: 'right' },
                ],
                rows: s.byIndustry.map((r) => [t(`industry.${r.key}`), fmt.num(r.accounts), fmt.num(r.customers), fmt.money(r.revenue), fmt.money(r.pipeline)]),
              }}
            >
              <BarList rows={s.byIndustry.map((r) => ({ key: r.key, label: t(`industry.${r.key}`), value: r.revenue, display: fmt.moneyCompact(r.revenue) }))} />
            </ChartCard>
            <ChartCard
              title={t('chart.segmentSplit')}
              sub={t('chart.segmentSplitSub')}
              table={{
                columns: [
                  { label: t('col.segment') },
                  { label: t('col.accounts'), align: 'right' },
                  { label: t('col.customers'), align: 'right' },
                  { label: t('col.revenue'), align: 'right' },
                ],
                rows: s.bySegment.map((r) => [t(`segment.${r.key}`), fmt.num(r.accounts), fmt.num(r.customers), fmt.money(r.revenue)]),
              }}
            >
              <SegmentedBar
                format={fmt.moneyCompact}
                parts={s.bySegment.map((r, i) => ({ key: r.key, label: t(`segment.${r.key}`), value: r.revenue, color: SERIES[i] }))}
              />
            </ChartCard>
          </div>
        </div>
      )}
      <section className="card">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} />
          <Switch checked={customers} onChange={setCustomers} label={t('accounts.customersOnly')} />
        </div>
        {list.error && !list.data ? (
          <ErrorState onRetry={list.reload} />
        ) : (
          <div className={list.loading ? 'refetching' : undefined}>
            <DataTable
              columns={columns}
              rows={list.data?.rows ?? []}
              rowKey={(a) => a.id}
              sort={sort}
              onSort={(x) => {
                setSort(x);
                setPage(1);
              }}
              onRowClick={(a) => navigate(`/accounts/${a.id}`)}
              empty={list.loading ? t('common.loading') : undefined}
            />
            {list.data && <Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
          </div>
        )}
      </section>
      {creating && (
        <AccountFormModal
          onClose={() => setCreating(false)}
          onSaved={(a) => {
            setCreating(false);
            navigate(`/accounts/${a.id}`);
          }}
        />
      )}
    </div>
  );
}
