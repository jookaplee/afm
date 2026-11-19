import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, Pencil, Plus, Sparkles } from 'lucide-react';
import { CATEGORY_COLORS, FALLBACK_CATEGORY } from '../../../shared/constants.ts';
import type { BusinessRow, LeadCategoryRow } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useConfirm, useMeta, useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { ErrorState, Field, Loading, Modal, PageHeader, Switch } from '../components/ui.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { FormShell, useForm } from '../components/forms.tsx';
import { CategorySelect, catColor } from '../components/categories.tsx';

type EditCategory = { cat: LeadCategoryRow | null; business: number | null };

export default function CategoriesPage() {
  const { t, fmt, lang } = useI18n();
  const meta = useMeta();
  const [version, setVersion] = useState(0);
  const businesses = useApi<BusinessRow[]>('/businesses', { v: version });
  const categories = useApi<LeadCategoryRow[]>('/lead-categories', { v: version });
  const [editCat, setEditCat] = useState<EditCategory | null>(null);
  const [editBiz, setEditBiz] = useState<BusinessRow | 'new' | null>(null);
  const changed = () => {
    setVersion((v) => v + 1);
    meta.reload();
  };

  const cols = (business: number | null): Column<LeadCategoryRow>[] => [
    {
      key: 'name',
      header: t('col.industry'),
      render: (c) => (
        <div className="cat-cell">
          <i className="cat-dot" style={{ background: catColor(c.color) }} aria-hidden />
          <div style={{ minWidth: 0 }}>
            <div className="cell-main">
              {lang === 'en' && c.name_en ? c.name_en : c.name}
              {!c.active && <span className="badge">{t('cat.archived')}</span>}
              {c.ai_discover && c.active ? (
                <span className="badge good" title={t('cat.aiDiscover')}>
                  <Sparkles aria-hidden />
                  {t('cat.aiOn')}
                </span>
              ) : null}
            </div>
            {c.description && <div className="cell-sub clamp-2">{c.description}</div>}
          </div>
        </div>
      ),
    },
    {
      key: 'leads',
      header: t('cat.leads'),
      align: 'right',
      render: (c) =>
        c.leads > 0 ? (
          <Link
            to={`/leads?${new URLSearchParams({ ...(business ? { business: String(business) } : {}), industry: c.key }).toString()}`}
            onClick={(e) => e.stopPropagation()}
          >
            {fmt.num(c.leads)}
          </Link>
        ) : (
          '0'
        ),
      nowrap: true,
    },
    { key: 'active', header: t('cat.activeLeads'), align: 'right', render: (c) => fmt.num(c.active_leads), nowrap: true, wide: true },
    { key: 'accounts', header: t('cat.accounts'), align: 'right', render: (c) => fmt.num(c.accounts), nowrap: true },
    { key: 'customers', header: t('cat.customers'), align: 'right', render: (c) => fmt.num(c.customers), nowrap: true, wide: true },
  ];

  if (businesses.error || categories.error) return <ErrorState onRetry={changed} />;
  if (!businesses.data || !categories.data) return <Loading />;
  const groupWide = categories.data.filter((c) => c.business_id == null);

  const section = (b: BusinessRow | null) => {
    const list = categories.data!.filter((c) => (b ? c.business_id === b.id : c.business_id == null));
    return (
      <section key={b?.id ?? 'group'} className="card biz-card" aria-labelledby={`biz-${b?.id ?? 'group'}`}>
        <div className="biz-head">
          <span className={`biz-icon ${b ? '' : 'group'}`} aria-hidden>
            <Building2 />
          </span>
          <div className="biz-title">
            <h2 id={`biz-${b?.id ?? 'group'}`}>
              {b ? b.name : t('cat.groupWide')}
              {b && !b.active && <span className="badge">{t('cat.inactive')}</span>}
            </h2>
            <p className="muted small">
              {b
                ? b.description || t('cat.noDescription')
                : t('cat.groupWideHelp')}
            </p>
            {b && (
              <p className="small biz-stats">
                {t('cat.bizStats', { leads: fmt.num(b.leads), active: fmt.num(b.active_leads), cats: fmt.num(b.categories) })}
              </p>
            )}
          </div>
          <div className="biz-actions">
            {b && (
              <button className="btn sm" onClick={() => setEditBiz(b)}>
                <Pencil aria-hidden />
                {t('common.edit')}
              </button>
            )}
            <button className="btn sm" onClick={() => setEditCat({ cat: null, business: b?.id ?? null })}>
              <Plus aria-hidden />
              {t('cat.new')}
            </button>
          </div>
        </div>
        {list.length ? (
          <DataTable columns={cols(b?.id ?? null)} rows={list} rowKey={(c) => c.id} onRowClick={(c) => setEditCat({ cat: c, business: c.business_id })} />
        ) : (
          <p className="muted biz-empty">{t('cat.noneYet')}</p>
        )}
      </section>
    );
  };

  return (
    <div className="page">
      <PageHeader
        title={t('cat.pageTitle')}
        subtitle={t('cat.pageSubtitle')}
        actions={
          <>
            <Link className="btn" to="/leads">
              <ArrowLeft aria-hidden />
              {t('nav.leads')}
            </Link>
            <button className="btn" onClick={() => setEditBiz('new')}>
              <Building2 aria-hidden />
              {t('cat.newBusiness')}
            </button>
            <button className="btn primary" onClick={() => setEditCat({ cat: null, business: businesses.data!.find((b) => b.active)?.id ?? null })}>
              <Plus aria-hidden />
              {t('cat.new')}
            </button>
          </>
        }
      />
      <div className="stack">
        {businesses.data.map((b) => section(b))}
        {(groupWide.length > 0 || businesses.data.length > 0) && section(null)}
        <section className="card how-card">
          <h2>{t('cat.howTitle')}</h2>
          <ul>
            <li>{t('cat.how1')}</li>
            <li>{t('cat.how2')}</li>
            <li>{t('cat.how3')}</li>
            <li>{t('cat.how4')}</li>
          </ul>
        </section>
      </div>
      {editCat && <CategoryFormModal cat={editCat.cat} business={editCat.business} onClose={() => setEditCat(null)} onSaved={changed} />}
      {editBiz && <BusinessFormModal business={editBiz === 'new' ? null : editBiz} onClose={() => setEditBiz(null)} onSaved={changed} />}
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  return (
    <div className="swatches" role="radiogroup" aria-label={t('cat.color')}>
      {CATEGORY_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === String(c)}
          aria-label={t(`cat.colorName.${c}`)}
          title={t(`cat.colorName.${c}`)}
          className="swatch"
          style={{ '--cat': catColor(c) } as CSSProperties}
          onClick={() => onChange(String(c))}
        />
      ))}
    </div>
  );
}

function CategoryFormModal({ cat, business, onClose, onSaved }: { cat: LeadCategoryRow | null; business: number | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const { businesses, categories } = useMeta();
  const [moving, setMoving] = useState(false);
  const fallback = cat?.key === FALLBACK_CATEGORY;
  const f = useForm({
    name: cat?.name ?? '',
    name_en: cat?.name_en ?? '',
    business_id: cat ? (cat.business_id ? String(cat.business_id) : '') : business ? String(business) : '',
    description: cat?.description ?? '',
    color: String(cat?.color ?? ((categories.length % 8) + 1)),
    ai_discover: cat ? String(cat.ai_discover) : '1',
    active: cat ? String(cat.active) : '1',
  });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        name_en: v.name_en.trim() || null,
        business_id: v.business_id ? Number(v.business_id) : null,
        description: v.description.trim() || null,
        color: Number(v.color),
        ai_discover: Number(v.ai_discover),
        active: Number(v.active),
      };
      if (cat) await api.patch(`/lead-categories/${cat.id}`, body);
      else await api.post('/lead-categories', body);
      toast(cat ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    });
  const inUse = cat ? cat.leads + cat.accounts : 0;
  const remove = async () => {
    if (!cat) return;
    // In use: choose where its leads and accounts go first.
    if (inUse) return setMoving(true);
    if (!(await confirm({ message: t('common.confirmDelete', { name: cat.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    await f.submit(async () => {
      await api.del(`/lead-categories/${cat.id}`);
      toast(t('common.deleted'));
      onSaved();
      onClose();
    });
  };
  const moved = cat && cat.business_id !== (v.business_id ? Number(v.business_id) : null) && v.business_id !== '' && cat.leads > 0;

  return (
    <>
      <FormShell
        title={cat ? t('cat.edit') : t('cat.new')}
        onClose={onClose}
        onSubmit={save}
        busy={f.busy}
        formError={f.formError}
        onDelete={cat && !fallback ? remove : undefined}
      >
        <Field label={t('cat.name')} error={f.errors.name} htmlFor="cat-name">
          <input id="cat-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('cat.nameEn')} error={f.errors.name_en} help={t('cat.nameEnHelp')} htmlFor="cat-name-en">
          <input id="cat-name-en" className="input" value={v.name_en} onChange={(e) => f.set('name_en', e.target.value)} maxLength={80} />
        </Field>
        <Field label={t('cat.business')} error={f.errors.business_id} help={moved ? t('cat.moveHelp', { n: String(cat!.leads) }) : t('cat.businessHelp')} htmlFor="cat-business" full>
          <select id="cat-business" className="select" value={v.business_id} onChange={(e) => f.set('business_id', e.target.value)}>
            <option value="">{t('cat.groupWide')}</option>
            {businesses
              .filter((b) => b.active || String(b.id) === v.business_id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t('cat.description')} error={f.errors.description} help={t('cat.descriptionHelp')} htmlFor="cat-desc" full>
          <textarea id="cat-desc" className="input" rows={3} value={v.description} onChange={(e) => f.set('description', e.target.value)} maxLength={600} />
        </Field>
        <div className="field full">
          <span className="field-label">{t('cat.color')}</span>
          <ColorPicker value={v.color} onChange={(c) => f.set('color', c)} />
        </div>
        <div className="field full">
          <Switch checked={v.ai_discover === '1'} onChange={(on) => f.set('ai_discover', on ? '1' : '0')} label={t('cat.aiDiscover')} />
          <span className="help">{t('cat.aiDiscoverHelp')}</span>
        </div>
        {!fallback && (
          <div className="field full">
            <Switch checked={v.active === '1'} onChange={(on) => f.set('active', on ? '1' : '0')} label={t('cat.activeSwitch')} />
            <span className="help">{t('cat.activeHelp')}</span>
          </div>
        )}
        {fallback && <p className="muted small field full">{t('cat.fallbackHelp')}</p>}
      </FormShell>
      {moving && cat && (
        <DeleteCategoryModal
          cat={cat}
          onClose={() => setMoving(false)}
          onDeleted={() => {
            onSaved();
            onClose();
          }}
        />
      )}
    </>
  );
}

/** Deleting a category in use: its leads and accounts move to another category. */
function DeleteCategoryModal({ cat, onClose, onDeleted }: { cat: LeadCategoryRow; onClose: () => void; onDeleted: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [target, setTarget] = useState(FALLBACK_CATEGORY);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await api.del(`/lead-categories/${cat.id}?move_to=${encodeURIComponent(target)}`);
      toast(t('common.deleted'));
      onDeleted();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
      setBusy(false);
    }
  };
  return (
    <Modal
      title={t('cat.deleteTitle', { name: cat.name })}
      onClose={onClose}
      start={
        <button type="button" className="btn plain" onClick={onClose}>
          {t('common.cancel')}
        </button>
      }
      end={
        <button type="button" className="btn plain strong danger-text" onClick={run} disabled={busy || target === cat.key}>
          {t('cat.deleteAndMove')}
        </button>
      }
    >
      <p>{t('cat.deleteBody', { leads: String(cat.leads), accounts: String(cat.accounts) })}</p>
      <div className="field">
        <label htmlFor="cat-move">{t('cat.moveTo')}</label>
        <CategorySelect id="cat-move" value={target} onChange={setTarget} />
      </div>
    </Modal>
  );
}

function BusinessFormModal({ business, onClose, onSaved }: { business: BusinessRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const confirm = useConfirm();
  const f = useForm({ name: business?.name ?? '', description: business?.description ?? '', active: business ? String(business.active) : '1' });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      const body = { name: v.name, description: v.description.trim() || null, active: Number(v.active) };
      if (business) await api.patch(`/businesses/${business.id}`, body);
      else await api.post('/businesses', body);
      toast(business ? t('common.saved') : t('common.created'));
      onSaved();
      onClose();
    });
  const remove = business
    ? async () => {
        if (!(await confirm({ message: t('common.confirmDelete', { name: business.name }), confirmLabel: t('common.delete'), danger: true }))) return;
        await f.submit(async () => {
          await api.del(`/businesses/${business.id}`);
          toast(t('common.deleted'));
          onSaved();
          onClose();
        });
      }
    : undefined;
  return (
    <FormShell title={business ? t('cat.editBusiness') : t('cat.newBusiness')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError} onDelete={remove}>
      <Field label={t('cat.businessName')} error={f.errors.name} htmlFor="biz-name" full>
        <input id="biz-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={80} />
      </Field>
      <Field label={t('cat.businessDescription')} error={f.errors.description} help={t('cat.businessDescriptionHelp')} htmlFor="biz-desc" full>
        <textarea id="biz-desc" className="input" rows={4} value={v.description} onChange={(e) => f.set('description', e.target.value)} maxLength={1000} />
      </Field>
      {business && (
        <div className="field full">
          <Switch checked={v.active === '1'} onChange={(on) => f.set('active', on ? '1' : '0')} label={t('cat.businessActive')} />
          <span className="help">{t('cat.businessActiveHelp')}</span>
        </div>
      )}
      {business && business.leads > 0 && <p className="muted small field full">{t('cat.businessDeleteHelp', { n: String(business.leads) })}</p>}
    </FormShell>
  );
}
