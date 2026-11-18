import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { PRODUCTS, REGIONS, SEGMENTS, SOURCES, type Product, type Region, type Segment, type Source } from '../../../shared/constants.ts';
import type { DealRow, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMeta, useToast } from '../lib/app-context.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { ErrorState, PageHeader, Pager, SearchInput, SelectFilter, StageBadge, Tabs } from '../components/ui.tsx';
import { DataTable, type Column, type SortState } from '../components/DataTable.tsx';
import { DealFormModal } from '../components/forms.tsx';

type Tab = 'open' | 'won' | 'lost' | 'all';
const PAGE_SIZE = 25;

export default function DealsPage() {
  const { t, fmt } = useI18n();
  const { aes } = useMeta();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('open');
  const [search, setSearch] = useState('');
  const [owner, setOwner] = useState('');
  const [segment, setSegment] = useState<Segment | undefined>();
  const [region, setRegion] = useState<Region | undefined>();
  const [source, setSource] = useState<Source | undefined>();
  const [product, setProduct] = useState<Product | undefined>();
  const [sort, setSort] = useState<SortState>({ key: 'amount', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<DealRow | 'new' | null>(null);
  const q = useDebounced(search);

  const filters = useMemo(
    () => ({ stage: tab === 'all' ? undefined : tab, search: q, owner, segment, region, source, product }),
    [tab, q, owner, segment, region, source, product],
  );
  useEffect(() => setPage(1), [filters]);
  const { data, error, loading, reload } = useApi<Paged<DealRow>>('/deals', { ...filters, sort: sort.key, dir: sort.dir, page, pageSize: PAGE_SIZE });

  const columns: Column<DealRow>[] = [
    {
      key: 'name',
      header: t('col.deal'),
      sortKey: 'name',
      render: (d) => (
        <div>
          <div className="cell-main">{d.name}</div>
          <div className="cell-sub">
            <Link to={`/accounts/${d.account_id}`} onClick={(e) => e.stopPropagation()}>
              {d.account_name}
            </Link>{' '}
            · {t(`segment.${d.segment}`)}
          </div>
        </div>
      ),
    },
    { key: 'stage', header: t('col.stage'), sortKey: 'stage', render: (d) => <StageBadge stage={d.stage} /> },
    { key: 'amount', header: t('col.amount'), sortKey: 'amount', align: 'right', render: (d) => fmt.money(d.amount), nowrap: true },
    { key: 'owner', header: t('col.owner'), sortKey: 'owner', render: (d) => d.owner_name, nowrap: true },
    {
      key: 'source',
      header: t('col.source'),
      render: (d) => (
        <div>
          <div>{t(`source.${d.source}`)}</div>
          {d.channel && <div className="cell-sub">{t(`channel.${d.channel}`)}</div>}
        </div>
      ),
    },
    { key: 'product', header: t('col.product'), render: (d) => t(`product.${d.product}`), nowrap: true },
    {
      key: 'close',
      header: tab === 'open' ? t('col.expectedClose') : t('col.closed'),
      sortKey: tab === 'open' ? 'expected_close' : 'closed_at',
      align: 'right',
      render: (d) => fmt.date(d.closed_at ?? d.expected_close),
      nowrap: true,
    },
    { key: 'created', header: t('col.created'), sortKey: 'created_at', align: 'right', render: (d) => fmt.date(d.created_at), nowrap: true },
  ];

  const exportCsv = async () => {
    try {
      const all = await api.get<Paged<DealRow>>('/deals', { ...filters, sort: sort.key, dir: sort.dir, pageSize: 5000 });
      downloadCsv(
        `deals_${tab}.csv`,
        [
          'ID',
          t('col.deal'),
          t('col.account'),
          t('col.segment'),
          t('col.region'),
          t('col.industry'),
          t('col.stage'),
          t('col.amount'),
          t('col.owner'),
          t('col.source'),
          t('col.channel'),
          t('col.product'),
          t('col.type'),
          t('col.created'),
          t('col.expectedClose'),
          t('col.closed'),
          t('field.lostReason'),
        ],
        all.rows.map((d) => [
          d.id,
          d.name,
          d.account_name,
          t(`segment.${d.segment}`),
          t(`region.${d.region}`),
          t(`industry.${d.industry}`),
          t(`stage.${d.stage}`),
          d.amount,
          d.owner_name,
          t(`source.${d.source}`),
          d.channel ? t(`channel.${d.channel}`) : '',
          t(`product.${d.product}`),
          t(`dealType.${d.type}`),
          d.created_at,
          d.expected_close,
          d.closed_at ?? '',
          d.lost_reason ? t(`lost.${d.lost_reason}`) : '',
        ]),
      );
    } catch (e) {
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('deals.title')}
        subtitle={t('deals.subtitle')}
        actions={
          <>
            <button className="btn" onClick={exportCsv}>
              <Download aria-hidden />
              {t('common.export')}
            </button>
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('deals.new')}
            </button>
          </>
        }
      />
      <section className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={(['open', 'won', 'lost', 'all'] as Tab[]).map((k) => ({ key: k, label: t(`tab.${k}`) }))}
        />
        <div className="table-toolbar">
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
          <SelectFilter label={t('col.source')} value={source} onChange={setSource} options={SOURCES} allLabel={t('filter.allSources')} render={(v) => t(`source.${v}`)} />
          <SelectFilter label={t('col.product')} value={product} onChange={setProduct} options={PRODUCTS} allLabel={t('filter.allProducts')} render={(v) => t(`product.${v}`)} />
        </div>
        {error && !data ? (
          <ErrorState onRetry={reload} />
        ) : (
          <div className={loading ? 'refetching' : undefined}>
            <DataTable
              columns={columns}
              rows={data?.rows ?? []}
              rowKey={(d) => d.id}
              sort={sort}
              onSort={(s) => {
                setSort(s);
                setPage(1);
              }}
              onRowClick={(d) => setEditing(d)}
              empty={loading ? t('common.loading') : undefined}
            />
            {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </div>
        )}
      </section>
      {editing && (
        <DealFormModal
          deal={editing === 'new' ? null : editing}
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
