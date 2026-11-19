import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check, MessageCircle, PackageCheck, Pencil, Plus, Trash2, Truck, X } from 'lucide-react';
import { PRODUCT_CATEGORIES, type OrderStatus } from '../../../shared/constants.ts';
import type { CatalogProduct, LeadRow, OrderDetail, Paged } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useConfirm, useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { Field, Loading, Modal, Switch } from '../components/ui.tsx';
import { EnumSelect, FormShell, useForm } from '../components/forms.tsx';

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { t } = useI18n();
  const cls = status === 'pending' ? 'warn' : status === 'cancelled' ? 'bad' : status === 'delivered' ? '' : 'good';
  return <span className={`badge ${cls}`}>{t(`order.status.${status}`)}</span>;
}

const NEXT: Record<OrderStatus, { to: OrderStatus; icon: typeof Check; key: string }[]> = {
  pending: [{ to: 'confirmed', icon: Check, key: 'order.confirm' }],
  confirmed: [
    { to: 'processing', icon: PackageCheck, key: 'order.process' },
    { to: 'delivered', icon: Truck, key: 'order.deliver' },
  ],
  processing: [{ to: 'delivered', icon: Truck, key: 'order.deliver' }],
  delivered: [],
  cancelled: [],
};

/** Moves an order along; cancelling asks for a reason. */
export function useOrderActions(onDone: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const move = async (id: number, to: OrderStatus) => {
    try {
      let cancel_reason: string | undefined;
      if (to === 'cancelled') {
        if (!(await confirm({ message: t('order.cancelConfirm', { id }), confirmLabel: t('order.cancel'), danger: true }))) return;
        cancel_reason = t('order.cancelledByStaff');
      }
      await api.patch(`/orders/${id}`, { status: to, cancel_reason, at: new Date().toISOString() });
      toast(t(`order.toast.${to}`, { id }));
      onDone();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };
  return { move, next: (s: OrderStatus) => NEXT[s] };
}

export function OrderDetailModal({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const [version, setVersion] = useState(0);
  const order = useApi<OrderDetail>(`/orders/${id}`, { v: version });
  const [editing, setEditing] = useState(false);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const { move, next } = useOrderActions(refresh);
  const o = order.data;
  return (
    <>
      <Modal title={t('order.title', { id })} onClose={onClose} width={620}>
        {!o ? (
          <Loading />
        ) : (
          <div className="order-detail">
            <div className="order-head">
              <div>
                <div className="cell-main">{o.company ?? '—'}</div>
                <div className="cell-sub">
                  {o.lead_name} · {o.phone}
                </div>
              </div>
              <OrderStatusBadge status={o.status} />
            </div>
            <table className="data order-lines">
              <thead>
                <tr>
                  <th>{t('order.item')}</th>
                  <th className="right">{t('order.qty')}</th>
                  <th className="right">{t('order.price')}</th>
                  <th className="right">{t('order.lineTotal')}</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td className="right num">
                      {fmt.dec(i.qty)} {i.unit}
                    </td>
                    <td className="right num">{fmt.sen(i.price_sen)}</td>
                    <td className="right num">{fmt.sen(Math.round(i.qty * i.price_sen))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>{t('order.total')}</td>
                  <td className="right num">
                    <strong>{fmt.sen(o.total_sen)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
            <dl className="dl compact">
              <dt>{t('order.delivery')}</dt>
              <dd>{o.delivery_date ? fmt.date(o.delivery_date) : '—'}</dd>
              <dt>{t('order.address')}</dt>
              <dd>{o.delivery_address ?? '—'}</dd>
              <dt>{t('order.notes')}</dt>
              <dd>{o.notes ?? '—'}</dd>
              <dt>{t('order.source')}</dt>
              <dd>{t(`order.src.${o.source}`)}</dd>
              <dt>{t('order.created')}</dt>
              <dd>{fmt.stamp(o.created_at)}</dd>
              {o.cancel_reason && (
                <>
                  <dt>{t('order.cancelReason')}</dt>
                  <dd>{o.cancel_reason}</dd>
                </>
              )}
            </dl>
            <div className="order-actions">
              {o.lead_id && (
                <Link className="btn wa-send" to={`/whatsapp?lead=${o.lead_id}`}>
                  <MessageCircle aria-hidden />
                  {t('order.openChat')}
                </Link>
              )}
              {o.status === 'pending' && (
                <button className="btn" onClick={() => setEditing(true)}>
                  <Pencil aria-hidden />
                  {t('common.edit')}
                </button>
              )}
              {!['delivered', 'cancelled'].includes(o.status) && (
                <button className="btn" onClick={() => void move(o.id, 'cancelled')}>
                  <Ban aria-hidden />
                  {t('order.cancel')}
                </button>
              )}
              {next(o.status).map((n) => (
                <button key={n.to} className="btn primary" onClick={() => void move(o.id, n.to)}>
                  <n.icon aria-hidden />
                  {t(n.key)}
                </button>
              ))}
            </div>
            {o.status === 'pending' && <p className="muted small">{t('order.confirmHelp')}</p>}
          </div>
        )}
      </Modal>
      {editing && o && <OrderFormModal order={o} onClose={() => setEditing(false)} onSaved={refresh} />}
    </>
  );
}

/** Pick a lead (customer) by name, business or phone. */
function LeadPicker({ value, onChange }: { value: { id: number; label: string } | null; onChange: (v: { id: number; label: string } | null) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const list = useApi<Paged<LeadRow>>(value || dq.trim().length < 2 ? null : '/leads', { search: dq, pageSize: 8 });
  if (value) {
    return (
      <div className="lead-picked">
        <span>{value.label}</span>
        <button type="button" className="btn sm ghost icon" onClick={() => onChange(null)} aria-label={t('common.clear')}>
          <X aria-hidden />
        </button>
      </div>
    );
  }
  return (
    <div className="lead-picker">
      <input id="ord-lead" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('order.searchCustomer')} autoComplete="off" />
      {list.data && (
        <div className="lead-picker-list" role="listbox">
          {list.data.rows.map((l) => (
            <button key={l.id} type="button" role="option" aria-selected={false} onClick={() => onChange({ id: l.id, label: `${l.company} · ${l.name}` })}>
              <strong>{l.company}</strong>
              <span>
                {l.name}
                {l.phone ? ` · ${l.phone}` : ''}
              </span>
            </button>
          ))}
          {!list.data.rows.length && <span className="muted small">{t('common.noData')}</span>}
        </div>
      )}
    </div>
  );
}

type Line = { product_id: string; qty: string };

/** New order (pick a customer) or edit a pending order's lines and delivery. */
export function OrderFormModal({ order, leadId, onClose, onSaved }: { order?: OrderDetail; leadId?: number; onClose: () => void; onSaved: (id: number) => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const products = useApi<CatalogProduct[]>('/products', { active: 'true' });
  const [lead, setLead] = useState<{ id: number; label: string } | null>(order?.lead_id ? { id: order.lead_id, label: `${order.company} · ${order.lead_name}` } : null);
  const [lines, setLines] = useState<Line[]>(order ? order.items.map((i) => ({ product_id: String(i.product_id ?? ''), qty: String(i.qty) })) : [{ product_id: '', qty: '1' }]);
  const f = useForm({ delivery_date: order?.delivery_date ?? '', delivery_address: order?.delivery_address ?? '', notes: order?.notes ?? '' });
  const leadQuery = useApi<LeadRow>(leadId && !order ? `/leads/${leadId}` : null);
  useEffect(() => {
    const l = leadQuery.data;
    if (l && !lead) setLead({ id: l.id, label: `${l.company} · ${l.name}` });
  }, [leadQuery.data, lead]);

  const byId = new Map((products.data ?? []).map((p) => [String(p.id), p]));
  const total = lines.reduce((sum, l) => {
    const p = byId.get(l.product_id);
    const q = Number(l.qty);
    return p && q > 0 ? sum + Math.round(q * p.price_sen) : sum;
  }, 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const save = () =>
    f.submit(async () => {
      if (!lead) throw new Error(t('order.needCustomer'));
      const items = lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), qty: Number(l.qty) }));
      const body = { items, delivery_date: f.values.delivery_date || null, delivery_address: f.values.delivery_address || null, notes: f.values.notes || null, at: new Date().toISOString() };
      const saved = order ? await api.patch<OrderDetail>(`/orders/${order.id}`, body) : await api.post<OrderDetail>('/orders', { ...body, lead_id: lead.id, source: 'manual' });
      toast(order ? t('common.saved') : t('order.toast.created', { id: saved.id }));
      onSaved(saved.id);
      onClose();
    });

  return (
    <FormShell title={order ? t('order.edit', { id: order.id }) : t('order.new')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError}>
      <Field label={t('order.customer')} htmlFor="ord-lead" full>
        {order ? <div className="lead-picked">{lead?.label}</div> : <LeadPicker value={lead} onChange={setLead} />}
      </Field>
      <div className="field full">
        <label>{t('order.items')}</label>
        {!products.data ? (
          <Loading />
        ) : products.data.length === 0 ? (
          <p className="muted small">{t('order.catalogEmpty')}</p>
        ) : (
          <div className="order-lines-edit">
            {lines.map((l, i) => {
              const p = byId.get(l.product_id);
              return (
                <div key={i} className="order-line">
                  <select className="select" aria-label={t('order.item')} value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                    <option value="">{t('order.pickProduct')}</option>
                    {products.data!.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name} · {fmt.sen(x.price_sen)}/{x.unit}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input"
                    inputMode="decimal"
                    aria-label={t('order.qty')}
                    value={l.qty}
                    onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                  />
                  <span className="num muted">{p ? fmt.sen(Math.round(Number(l.qty || 0) * p.price_sen)) : '—'}</span>
                  <button type="button" className="btn sm ghost icon" aria-label={t('common.delete')} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} disabled={lines.length === 1}>
                    <Trash2 aria-hidden />
                  </button>
                </div>
              );
            })}
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn sm" onClick={() => setLines((ls) => [...ls, { product_id: '', qty: '1' }])}>
                <Plus aria-hidden />
                {t('order.addLine')}
              </button>
              <strong className="num">
                {t('order.total')} {fmt.sen(total)}
              </strong>
            </div>
          </div>
        )}
      </div>
      <Field label={t('order.delivery')} htmlFor="ord-date">
        <input id="ord-date" className="input" type="date" value={f.values.delivery_date} onChange={(e) => f.set('delivery_date', e.target.value)} />
      </Field>
      <Field label={t('order.address')} htmlFor="ord-addr">
        <input id="ord-addr" className="input" value={f.values.delivery_address} onChange={(e) => f.set('delivery_address', e.target.value)} maxLength={300} />
      </Field>
      <Field label={t('order.notes')} htmlFor="ord-notes" full>
        <input id="ord-notes" className="input" value={f.values.notes} onChange={(e) => f.set('notes', e.target.value)} maxLength={500} />
      </Field>
    </FormShell>
  );
}

export function ProductFormModal({ product, onClose, onSaved }: { product?: CatalogProduct | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const f = useForm({
    name: product?.name ?? '',
    category: product?.category ?? 'beef',
    unit: product?.unit ?? 'kg',
    price: product ? (product.price_sen / 100).toFixed(2) : '',
    min_qty: product?.min_qty != null ? String(product.min_qty) : '',
    stock: product?.stock != null ? String(product.stock) : '',
    description: product?.description ?? '',
    active: product ? String(product.active) : '1',
  });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        category: v.category,
        unit: v.unit,
        price_sen: v.price.trim() === '' ? null : Math.round(Number(v.price) * 100),
        min_qty: v.min_qty === '' ? null : Number(v.min_qty),
        stock: v.stock === '' ? null : Number(v.stock),
        description: v.description || null,
        active: v.active === '1',
      };
      if (product) await api.patch(`/products/${product.id}`, body);
      else await api.post('/products', body);
      toast(t('common.saved'));
      onSaved();
      onClose();
    });
  const remove = product
    ? async () => {
        if (!(await confirm({ message: t('product.deleteConfirm', { name: product.name }), confirmLabel: t('common.delete'), danger: true }))) return;
        await api.del(`/products/${product.id}`);
        onSaved();
        onClose();
      }
    : undefined;
  const dec = (k: 'price' | 'min_qty' | 'stock') => (e: { target: { value: string } }) => f.set(k, e.target.value.replace(/[^\d.]/g, ''));
  return (
    <FormShell title={product ? t('product.edit') : t('product.new')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError} onDelete={remove}>
      <Field label={t('product.name')} error={f.errors.name} htmlFor="pr-name" full>
        <input id="pr-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={120} placeholder={t('product.namePh')} />
      </Field>
      <Field label={t('product.category')} error={f.errors.category} htmlFor="pr-cat">
        <EnumSelect id="pr-cat" value={v.category} onChange={(x) => f.set('category', x)} options={PRODUCT_CATEGORIES} render={(x) => t(`product.cat.${x}`)} />
      </Field>
      <Field label={t('product.unit')} error={f.errors.unit} help={t('product.unitHelp')} htmlFor="pr-unit">
        <input id="pr-unit" className="input" value={v.unit} onChange={(e) => f.set('unit', e.target.value)} maxLength={40} />
      </Field>
      <Field label={t('product.price')} error={f.errors.price_sen} htmlFor="pr-price">
        <input id="pr-price" className="input" inputMode="decimal" value={v.price} onChange={dec('price')} placeholder="0.00" />
      </Field>
      <Field label={t('product.minQty')} error={f.errors.min_qty} htmlFor="pr-min">
        <input id="pr-min" className="input" inputMode="decimal" value={v.min_qty} onChange={dec('min_qty')} />
      </Field>
      <Field label={t('product.stock')} error={f.errors.stock} help={t('product.stockHelp')} htmlFor="pr-stock">
        <input id="pr-stock" className="input" inputMode="decimal" value={v.stock} onChange={dec('stock')} />
      </Field>
      <div className="field" style={{ justifyContent: 'flex-end' }}>
        <Switch checked={v.active === '1'} onChange={(on) => f.set('active', on ? '1' : '0')} label={t('product.active')} />
      </div>
      <Field label={t('product.description')} htmlFor="pr-desc" full>
        <input id="pr-desc" className="input" value={v.description} onChange={(e) => f.set('description', e.target.value)} maxLength={400} placeholder={t('product.descPh')} />
      </Field>
    </FormShell>
  );
}
