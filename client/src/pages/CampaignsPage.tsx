import { useEffect, useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { CAMPAIGN_STATUSES, CHANNELS, type CampaignStatus, type Channel } from '../../../shared/constants.ts';
import type { Campaign, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { CAN_DOWNLOAD } from '../lib/env.ts';
import { CampaignStatusBadge, ErrorState, PageHeader, Pager, SearchInput, SelectFilter } from '../components/ui.tsx';
import { SERIES } from '../components/charts.tsx';
import { DataTable, type Column, type SortState } from '../components/DataTable.tsx';
import { CampaignFormModal } from '../components/forms.tsx';

type CampaignRow = Campaign & { leads: number; mqls: number; sqls: number; opps: number; pipeline: number; revenue: number };
const PAGE_SIZE = 25;

export default function CampaignsPage() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<Channel | undefined>();
  const [status, setStatus] = useState<CampaignStatus | undefined>();
  const [sort, setSort] = useState<SortState>({ key: 'start_date', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<CampaignRow | 'new' | null>(null);
  const q = useDebounced(search);
  const filters = useMemo(() => ({ search: q, channel, status }), [q, channel, status]);
  useEffect(() => setPage(1), [filters]);
  const { data, error, loading, reload } = useApi<Paged<CampaignRow>>('/campaigns', { ...filters, sort: sort.key, dir: sort.dir, page, pageSize: PAGE_SIZE });

  const roi = (c: CampaignRow) => (c.spend > 0 ? (c.revenue - c.spend) / c.spend : null);
  const cpl = (c: CampaignRow) => (c.leads > 0 ? c.spend / c.leads : null);

  const columns: Column<CampaignRow>[] = [
    {
      key: 'name',
      header: t('col.campaign'),
      sortKey: 'name',
      render: (c) => (
        <div>
          <div className="cell-main">{c.name}</div>
          <div className="cell-sub legend-item">
            <span className="key-rect" style={{ background: SERIES[CHANNELS.indexOf(c.channel)] }} aria-hidden />
            {t(`channel.${c.channel}`)}
          </div>
        </div>
      ),
    },
    { key: 'status', header: t('col.status'), render: (c) => <CampaignStatusBadge status={c.status} /> },
    {
      key: 'schedule',
      header: t('col.schedule'),
      sortKey: 'start_date',
      render: (c) => `${fmt.dayMonth(c.start_date)} – ${fmt.date(c.end_date)}`,
      nowrap: true,
    },
    { key: 'budget', header: t('col.budget'), sortKey: 'budget', align: 'right', render: (c) => fmt.moneyCompact(c.budget), nowrap: true },
    {
      key: 'spend',
      header: t('col.spend'),
      sortKey: 'spend',
      align: 'right',
      render: (c) => (
        <div>
          <div>{fmt.moneyCompact(c.spend)}</div>
          <div className="cell-sub">{c.budget > 0 ? t('campaigns.used', { pct: fmt.pct0(c.spend / c.budget) }) : '—'}</div>
        </div>
      ),
      nowrap: true,
    },
    { key: 'leads', header: t('col.leads'), sortKey: 'leads', align: 'right', render: (c) => fmt.num(c.leads) },
    { key: 'cpl', header: t('col.cpl'), align: 'right', render: (c) => fmt.moneyCompact(cpl(c)), nowrap: true },
    { key: 'mqls', header: t('col.mqls'), align: 'right', render: (c) => fmt.num(c.mqls) },
    { key: 'sqls', header: t('col.sqls'), align: 'right', render: (c) => fmt.num(c.sqls) },
    { key: 'opps', header: t('col.opps'), align: 'right', render: (c) => fmt.num(c.opps) },
    { key: 'pipeline', header: t('col.pipeline'), sortKey: 'pipeline', align: 'right', render: (c) => fmt.moneyCompact(c.pipeline), nowrap: true },
    { key: 'revenue', header: t('col.revenue'), sortKey: 'revenue', align: 'right', render: (c) => fmt.moneyCompact(c.revenue), nowrap: true },
    { key: 'roi', header: t('col.roi'), align: 'right', render: (c) => fmt.pct0(roi(c)) },
  ];

  const exportCsv = async () => {
    try {
      const all = await api.get<Paged<CampaignRow>>('/campaigns', { ...filters, sort: sort.key, dir: sort.dir, pageSize: 5000 });
      downloadCsv(
        'campaigns.csv',
        [
          'ID',
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
        ],
        all.rows.map((c) => [
          c.id,
          c.name,
          t(`channel.${c.channel}`),
          t(`campaignStatus.${c.status}`),
          c.start_date,
          c.end_date,
          c.budget,
          c.spend,
          c.leads,
          c.mqls,
          c.sqls,
          c.opps,
          c.pipeline,
          c.revenue,
          roi(c)?.toFixed(3) ?? '',
        ]),
      );
    } catch (e) {
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('campaigns.title')}
        subtitle={t('campaigns.subtitle')}
        actions={
          <>
            {CAN_DOWNLOAD && (
              <button className="btn" onClick={exportCsv}>
                <Download aria-hidden />
                {t('common.export')}
              </button>
            )}
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('campaigns.new')}
            </button>
          </>
        }
      />
      <section className="card">
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} />
          <SelectFilter label={t('col.channel')} value={channel} onChange={setChannel} options={CHANNELS} allLabel={t('filter.allChannels')} render={(v) => t(`channel.${v}`)} />
          <SelectFilter
            label={t('col.status')}
            value={status}
            onChange={setStatus}
            options={CAMPAIGN_STATUSES}
            allLabel={t('filter.allStatuses')}
            render={(v) => t(`campaignStatus.${v}`)}
          />
        </div>
        {error && !data ? (
          <ErrorState onRetry={reload} />
        ) : (
          <div className={loading ? 'refetching' : undefined}>
            <DataTable
              columns={columns}
              rows={data?.rows ?? []}
              rowKey={(c) => c.id}
              sort={sort}
              onSort={(s) => {
                setSort(s);
                setPage(1);
              }}
              onRowClick={(c) => setEditing(c)}
              empty={loading ? t('common.loading') : undefined}
            />
            {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </div>
        )}
      </section>
      {editing && (
        <CampaignFormModal
          campaign={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
