import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRightCircle, Ban, Download, Plus, RotateCcw, Tags } from 'lucide-react';
import { CHANNELS, SEGMENTS, type Channel, type LeadStatus, type Segment } from '../../../shared/constants.ts';
import type { LeadFacets, LeadRow, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { useI18n } from '../lib/i18n.tsx';
import { errorMessage } from '../lib/errors.ts';
import { useMeta, useToast } from '../lib/app-context.tsx';
import { downloadCsv } from '../lib/csv.ts';
import { CAN_DOWNLOAD } from '../lib/env.ts';
import { ErrorState, LeadStatusBadge, PageHeader, Pager, SearchInput, SelectFilter, Tabs } from '../components/ui.tsx';
import { DataTable, type Column, type SortState } from '../components/DataTable.tsx';
import { ConvertLeadModal, LeadFormModal } from '../components/forms.tsx';
import { ContactLinks } from '../components/ContactLinks.tsx';
import { CategoryChips, CategoryTag } from '../components/categories.tsx';

type Tab = 'active' | LeadStatus | 'all';
const TABS: Tab[] = ['active', 'new', 'mql', 'sql', 'converted', 'disqualified', 'all'];
const PAGE_SIZE = 25;

export default function LeadsPage() {
  const { t, fmt } = useI18n();
  const { sdrs, businesses, multiBusiness, bizName, catName } = useMeta();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  // Business and category live in the URL so other pages can link to them.
  const business = Number(params.get('business')) || undefined;
  const industry = params.get('industry') || undefined;
  const setParam = (k: 'business' | 'industry', v: string | undefined) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    // A category belongs to a business: changing the business clears it.
    if (k === 'business') n.delete('industry');
    setParams(n, { replace: true });
  };
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [channel, setChannel] = useState<Channel | undefined>();
  const [segment, setSegment] = useState<Segment | undefined>();
  const [owner, setOwner] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'score', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LeadRow | 'new' | null>(null);
  const [converting, setConverting] = useState<LeadRow | null>(null);
  const navigate = useNavigate();
  const q = useDebounced(search);

  const filters = useMemo(
    () => ({ status: tab === 'all' ? undefined : tab, search: q, channel, segment, owner, business, industry }),
    [tab, q, channel, segment, owner, business, industry],
  );
  useEffect(() => setPage(1), [filters]);
  const { data, error, loading, reload } = useApi<Paged<LeadRow>>('/leads', { ...filters, sort: sort.key, dir: sort.dir, page, pageSize: PAGE_SIZE });
  const facets = useApi<LeadFacets>('/leads/facets', filters);
  const refresh = () => {
    reload();
    facets.reload();
  };
  const catCounts = useMemo(() => (facets.data ? new Map(facets.data.categories.map((c) => [c.key, c.n])) : null), [facets.data]);
  const bizCounts = useMemo(() => (facets.data ? new Map(facets.data.businesses.map((b) => [b.id, b.n])) : null), [facets.data]);

  const setStatus = async (e: MouseEvent, lead: LeadRow, status: LeadStatus) => {
    e.stopPropagation();
    try {
      await api.patch(`/leads/${lead.id}`, { status });
      toast(t('leads.statusChanged'));
      refresh();
    } catch (err) {
      toast(errorMessage(err, t), 'bad');
    }
  };

  const actions = (l: LeadRow) => {
    const next: { label: string; onClick: (e: MouseEvent) => void } | null =
      l.status === 'new'
        ? { label: t('leads.toMql'), onClick: (e) => setStatus(e, l, 'mql') }
        : l.status === 'mql'
          ? { label: t('leads.toSql'), onClick: (e) => setStatus(e, l, 'sql') }
          : l.status === 'sql'
            ? {
                label: t('leads.convert'),
                onClick: (e) => {
                  e.stopPropagation();
                  setConverting(l);
                },
              }
            : null;
    return (
      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
        {next && (
          <button className="btn sm" onClick={next.onClick}>
            <ArrowRightCircle aria-hidden />
            {next.label}
          </button>
        )}
        {['new', 'mql', 'sql'].includes(l.status) && (
          <button className="btn sm ghost icon" onClick={(e) => setStatus(e, l, 'disqualified')} title={t('leads.disqualify')} aria-label={`${t('leads.disqualify')}: ${l.name}`}>
            <Ban aria-hidden />
          </button>
        )}
        {l.status === 'disqualified' && (
          <button className="btn sm" onClick={(e) => setStatus(e, l, l.sql_at ? 'sql' : l.mql_at ? 'mql' : 'new')}>
            <RotateCcw aria-hidden />
            {t('leads.reopen')}
          </button>
        )}
      </div>
    );
  };

  const columns: Column<LeadRow>[] = [
    {
      key: 'name',
      header: t('col.name'),
      sortKey: 'name',
      render: (l) => (
        <div>
          <div className="cell-main truncate" title={l.name}>
            {l.name}
          </div>
          <div className="cell-sub">{l.phone ? <ContactLinks phone={l.phone} compact onWhatsApp={() => navigate(`/whatsapp?lead=${l.id}`)} /> : l.title}</div>
        </div>
      ),
      nowrap: true,
    },
    {
      key: 'company',
      header: t('col.company'),
      sortKey: 'company',
      render: (l) => (
        <div>
          <div className="truncate" title={l.company}>
            {l.account_id ? (
              <Link to={`/accounts/${l.account_id}`} onClick={(e) => e.stopPropagation()}>
                {l.company}
              </Link>
            ) : (
              l.company
            )}
          </div>
          <div className="cell-sub">
            {t(`segmentShort.${l.segment}`)} · {t(`region.${l.region}`)}
          </div>
        </div>
      ),
      nowrap: true,
    },
    {
      key: 'industry',
      header: t('col.industry'),
      sortKey: 'industry',
      render: (l) => (
        <div>
          <CategoryTag k={l.industry} />
          {multiBusiness && !business && <div className="cell-sub truncate">{bizName(l.business_id)}</div>}
        </div>
      ),
      nowrap: true,
    },
    {
      key: 'channel',
      header: t('col.channel'),
      sortKey: 'channel',
      render: (l) => (
        <div>
          <div>{t(`channel.${l.channel}`)}</div>
          {l.campaign_name && <div className="cell-sub">{l.campaign_name}</div>}
        </div>
      ),
      wide: true,
    },
    { key: 'status', header: t('col.status'), sortKey: 'status', render: (l) => <LeadStatusBadge status={l.status} /> },
    { key: 'score', header: t('col.score'), sortKey: 'score', align: 'right', render: (l) => fmt.num(l.score) },
    { key: 'owner', header: t('field.sdr'), render: (l) => l.owner_name ?? '—', nowrap: true },
    { key: 'created', header: t('col.created'), sortKey: 'created_at', align: 'right', render: (l) => fmt.date(l.created_at), nowrap: true, wide: true },
    { key: 'actions', header: '', render: actions, nowrap: true },
  ];

  const exportCsv = async () => {
    try {
      const all = await api.get<Paged<LeadRow>>('/leads', { ...filters, sort: sort.key, dir: sort.dir, pageSize: 5000 });
      downloadCsv(
        `leads_${tab}.csv`,
        ['ID', t('col.name'), t('col.title'), 'Email', t('col.phone'), t('col.company'), t('cat.business'), t('col.industry'), t('col.segment'), t('col.region'), t('col.channel'), t('col.campaign'), t('col.status'), t('col.score'), t('field.sdr'), t('col.created')],
        all.rows.map((l) => [
          l.id,
          l.name,
          l.title,
          l.email,
          l.phone,
          l.company,
          bizName(l.business_id),
          catName(l.industry),
          t(`segment.${l.segment}`),
          t(`region.${l.region}`),
          t(`channel.${l.channel}`),
          l.campaign_name,
          t(`leadStatus.${l.status}`),
          l.score,
          l.owner_name,
          l.created_at,
        ]),
      );
    } catch (e) {
      toast((e as Error).message || t('error.generic'), 'bad');
    }
  };

  return (
    <div className="page">
      <PageHeader
        title={t('leads.title')}
        subtitle={t('leads.subtitle')}
        actions={
          <>
            {CAN_DOWNLOAD && (
              <button className="btn" onClick={exportCsv}>
                <Download aria-hidden />
                {t('common.export')}
              </button>
            )}
            <Link className="btn" to="/leads/categories">
              <Tags aria-hidden />
              {t('cat.manage')}
            </Link>
            <button className="btn primary" onClick={() => setEditing('new')}>
              <Plus aria-hidden />
              {t('leads.new')}
            </button>
          </>
        }
      />
      {multiBusiness && (
        <div className="tabs wrap biz-switch" role="group" aria-label={t('cat.business')}>
          <button className="tab" aria-pressed={!business} onClick={() => setParam('business', undefined)}>
            {t('cat.allBusinesses')}
            {bizCounts && <span className="count">{fmt.num([...bizCounts.values()].reduce((a, b) => a + b, 0))}</span>}
          </button>
          {businesses
            .filter((b) => b.active || b.id === business)
            .map((b) => (
              <button key={b.id} className="tab" aria-pressed={business === b.id} onClick={() => setParam('business', String(b.id))}>
                {b.name}
                {bizCounts && <span className="count">{fmt.num(bizCounts.get(b.id) ?? 0)}</span>}
              </button>
            ))}
        </div>
      )}
      <section className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={TABS.map((k) => ({ key: k, label: k === 'active' || k === 'all' ? t(`tab.${k}`) : t(`leadStatus.${k}`) }))}
        />
        <CategoryChips value={industry} onChange={(k) => setParam('industry', k)} counts={catCounts} total={facets.data?.total ?? null} businessId={business} />
        <div className="table-toolbar">
          <SearchInput value={search} onChange={setSearch} />
          <SelectFilter label={t('col.channel')} value={channel} onChange={setChannel} options={CHANNELS} allLabel={t('filter.allChannels')} render={(v) => t(`channel.${v}`)} />
          <SelectFilter label={t('col.segment')} value={segment} onChange={setSegment} options={SEGMENTS} allLabel={t('filter.allSegments')} render={(v) => t(`segment.${v}`)} />
          <select className="select" aria-label={t('field.sdr')} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">{t('filter.allReps')}</option>
            {sdrs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
        {error && !data ? (
          <ErrorState onRetry={reload} />
        ) : (
          <div className={loading ? 'refetching' : undefined}>
            <DataTable
              columns={columns}
              rows={data?.rows ?? []}
              rowKey={(l) => l.id}
              sort={sort}
              onSort={(s) => {
                setSort(s);
                setPage(1);
              }}
              onRowClick={(l) => setEditing(l)}
              empty={loading ? t('common.loading') : undefined}
            />
            {data && <Pager page={data.page} pageSize={data.pageSize} total={data.total} onPage={setPage} />}
          </div>
        )}
      </section>
      {editing && (
        <LeadFormModal
          lead={editing === 'new' ? null : editing}
          defaults={{ business, industry }}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            refresh();
          }}
        />
      )}
      {converting && (
        <ConvertLeadModal
          lead={converting}
          onClose={() => setConverting(null)}
          onSaved={() => {
            setConverting(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
