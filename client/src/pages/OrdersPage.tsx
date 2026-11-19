import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageCircle, Plus } from 'lucide-react';
import { ORDER_STATUSES, type OrderStatus } from '../../../shared/constants.ts';
import type { CatalogProduct, OrderRow, OrderSummary, Paged } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDebounced } from '../lib/useDebounced.ts';
import { Card, ErrorState, Loading, PageHeader, Pager, SearchInput, Tabs } from '../components/ui.tsx';
import { StatTile } from '../components/charts.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { OrderDetailModal, OrderFormModal, OrderStatusBadge, ProductFormModal, useOrderActions } from '../orders/OrderModals.tsx';

type Tab = 'orders' | 'catalog';
type StatusFilter = OrderStatus | 'open' | 'all';
const PAGE_SIZE = 25;

export default function OrdersPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const leadFilter = Number(params.get('lead')) || undefined;
  const openId = Number(params.get('order')) || null;
  const [tab, setTab] = useState<Tab>('orders');
  const [status, setStatus] = useState<StatusFilter>(leadFilter ? 'all' : 'pending');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [creating, setCreating] = useState(false);
  const [product, setProduct] = useState<CatalogProduct | 'new' | null>(null);
  const q = useDebounced(search);
  const bump = () => setVersion((v) => v + 1);
  const filters = useMemo(() => ({ status: status === 'all' ? undefined : status, search: q, lead_id: leadFilter }), [status, q, leadFilter]);
  useEffect(() => setPage(1), [filters]);
  const orders = useApi<Paged<OrderRow>>('/orders', { ...filters, page, pageSize: PAGE_SIZE, v: version });
  const summary = useApi<OrderSummary>('/orders/summary', { v: version });
  const products = useApi<CatalogProduct[]>('/products', { v: version });
  const { move, next } = useOrderActions(bump);
  const s = summary.data;

  const setParam = (k: string, v: string | null) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n);
  };

  const cols: Column<OrderRow>[] = [
    {
      key: 'id',
      header: '#',
      render: (o) => (
        <div>
          <div className="cell-main num">#{o.id}</div>
          <div className="cell-sub">{fmt.stamp(o.created_at)}</div>
        </div>
      ),
      nowrap: true,
    },
    {
      key: 'customer',
      header: t('order.customer'),
      render: (o) => (
        <div>
          <div className="cell-main truncate">{o.company ?? '—'}</div>
          <div className="cell-sub truncate">
            {o.lead_name}
            {o.phone ? ` · ${o.phone}` : ''}
          </div>
        </div>
      ),
      nowrap: true,
    },
    { key: 'items', header: t('order.items'), render: (o) => <span className="order-items-cell">{o.items_summary ?? '—'}</span> },
    { key: 'total', header: t('order.total'), align: 'right', render: (o) => fmt.sen(o.total_sen), nowrap: true },
    { key: 'delivery', header: t('order.delivery'), render: (o) => (o.delivery_date ? fmt.date(o.delivery_date) : '—'), nowrap: true, wide: true },
    {
      key: 'source',
      header: t('order.source'),
      render: (o) => <span className={`badge ${o.source === 'whatsapp_agent' ? 'good' : ''}`}>{t(`order.src.${o.source}`)}</span>,
      nowrap: true,
      wide: true,
    },
    { key: 'status', header: t('col.status'), render: (o) => <OrderStatusBadge status={o.status} />, nowrap: true },
    {
      key: 'actions',
      header: '',
      render: (o) => (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {o.lead_id && (
            <Link className="btn sm ghost icon" to={`/whatsapp?lead=${o.lead_id}`} onClick={(e) => e.stopPropagation()} aria-label={`${t('order.openChat')}: #${o.id}`} title={t('order.openChat')}>
              <MessageCircle aria-hidden />
            </Link>
          )}
          {next(o.status)
            .slice(0, 1)
            .map((n) => (
              <button
                key={n.to}
                className="btn sm"
                onClick={(e) => {
                  e.stopPropagation();
                  void move(o.id, n.to);
                }}
              >
                <n.icon aria-hidden />
                {t(n.key)}
              </button>
            ))}
        </div>
      ),
      nowrap: true,
    },
  ];

  const productCols: Column<CatalogProduct>[] = [
    {
      key: 'name',
      header: t('product.name'),
      render: (p) => (
        <div>
          <div className="cell-main">{p.name}</div>
          {p.description && <div className="cell-sub truncate">{p.description}</div>}
        </div>
      ),
    },
    { key: 'category', header: t('product.category'), render: (p) => t(`product.cat.${p.category}`), nowrap: true },
    { key: 'price', header: t('product.price'), align: 'right', render: (p) => `${fmt.sen(p.price_sen)} / ${p.unit}`, nowrap: true },
    { key: 'min', header: t('product.minQty'), align: 'right', render: (p) => (p.min_qty != null ? `${fmt.dec(p.min_qty)} ${p.unit}` : '—'), nowrap: true },
    { key: 'stock', header: t('product.stock'), align: 'right', render: (p) => (p.stock != null ? fmt.dec(p.stock) : '—'), nowrap: true },
    { key: 'active', header: t('col.status'), render: (p) => <span className={`badge ${p.active ? 'good' : ''}`}>{p.active ? t('product.activeOn') : t('product.activeOff')}</span>, nowrap: true },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t('order.pageTitle')}
        subtitle={t('order.pageSubtitle')}
        actions={
          tab === 'orders' ? (
            <button className="btn primary" onClick={() => setCreating(true)}>
              <Plus aria-hidden />
              {t('order.new')}
            </button>
          ) : (
            <button className="btn primary" onClick={() => setProduct('new')}>
              <Plus aria-hidden />
              {t('product.new')}
            </button>
          )
        }
      />
      <div className="stack">
        {s ? (
          <div className="grid kpis">
            <StatTile label={t('order.kpi.pending')} value={fmt.num(s.counts.pending)} sub={fmt.sen(s.pendingValueSen)} />
            <StatTile label={t('order.kpi.today')} value={fmt.num(s.todayCount)} />
            <StatTile label={t('order.kpi.month')} value={fmt.sen(s.monthValueSen)} sub={t('order.kpi.monthSub', { n: fmt.num(s.monthCount) })} />
            <StatTile label={t('order.kpi.delivery')} value={fmt.num(s.counts.confirmed + s.counts.processing)} sub={t('order.kpi.deliverySub')} />
          </div>
        ) : (
          <Loading />
        )}
        {products.data && products.data.length === 0 && (
          <Card>
            <p style={{ margin: 0 }}>
              {t('order.catalogEmptyLong')}{' '}
              <button type="button" className="link-btn" onClick={() => setProduct('new')}>
                {t('product.new')}
              </button>
            </p>
          </Card>
        )}
        <section className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'orders', label: t('order.tabOrders'), count: s ? s.counts.pending : undefined },
              { key: 'catalog', label: t('order.tabCatalog'), count: products.data?.length },
            ]}
          />
          {tab === 'orders' ? (
            <>
              <div className="table-toolbar">
                <div className="tabs wrap" role="group" aria-label={t('col.status')}>
                  {(['pending', 'open', ...ORDER_STATUSES.filter((x) => x !== 'pending'), 'all'] as StatusFilter[]).map((k) => (
                    <button key={k} className="tab" aria-pressed={status === k} onClick={() => setStatus(k)}>
                      {k === 'all' ? t('order.statusAll') : k === 'open' ? t('order.statusOpen') : t(`order.status.${k}`)}
                    </button>
                  ))}
                </div>
                <SearchInput value={search} onChange={setSearch} />
                {leadFilter && (
                  <button className="btn sm" onClick={() => setParam('lead', null)}>
                    {t('order.oneCustomer')} ×
                  </button>
                )}
              </div>
              {orders.data ? (
                <div className={orders.loading ? 'refetching' : ''}>
                  <DataTable columns={cols} rows={orders.data.rows} rowKey={(o) => o.id} onRowClick={(o) => setParam('order', String(o.id))} empty={t('order.none')} />
                  <Pager page={page} pageSize={PAGE_SIZE} total={orders.data.total} onPage={setPage} />
                </div>
              ) : orders.error ? (
                <ErrorState onRetry={orders.reload} />
              ) : (
                <Loading />
              )}
            </>
          ) : products.data ? (
            <DataTable columns={productCols} rows={products.data} rowKey={(p) => p.id} onRowClick={(p) => setProduct(p)} empty={t('order.catalogEmpty')} />
          ) : (
            <Loading />
          )}
        </section>
      </div>
      {openId && <OrderDetailModal id={openId} onClose={() => setParam('order', null)} onChanged={bump} />}
      {creating && (
        <OrderFormModal
          leadId={leadFilter}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            bump();
            setParam('order', String(id));
          }}
        />
      )}
      {product && <ProductFormModal product={product === 'new' ? null : product} onClose={() => setProduct(null)} onSaved={bump} />}
    </div>
  );
}
