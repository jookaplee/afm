import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import {
  ABM_TIERS,
  CAMPAIGN_STATUSES,
  CHANNELS,
  DEAL_TYPES,
  INDUSTRIES,
  LOST_REASONS,
  PRODUCTS,
  REGIONS,
  SEGMENTS,
  SOURCES,
  STAGES,
  type Channel,
  type LostReason,
} from '../../../shared/constants.ts';
import * as D from '../../../shared/dates.ts';
import type { AccountRow, CampaignPerformance, DealRow, LeadRow, Paged } from '../../../shared/types.ts';
import { api, ApiError } from '../lib/api.ts';
import { errorMessage } from '../lib/errors.ts';
import { useConfirm, useMeta, useToast } from '../lib/app-context.tsx';
import { useI18n } from '../lib/i18n.tsx';
import { Field, Modal } from './ui.tsx';

type Values = Record<string, string>;

/** Shared form state + submit handling with server-side validation errors. */
function useForm(initial: Values) {
  const [values, setValues] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { t } = useI18n();
  const set = (k: string, v: string) => {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => {
      if (!e[k]) return e;
      const { [k]: _drop, ...rest } = e;
      return rest;
    });
  };
  const submit = async (fn: () => Promise<void>) => {
    setBusy(true);
    setFormError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) {
        setErrors(e.fields);
        setFormError(t('error.validation'));
      } else {
        setFormError(errorMessage(e, t));
      }
    } finally {
      setBusy(false);
    }
  };
  return { values, set, errors, formError, busy, submit };
}

const toInt = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^\d-]/g, '')));
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

function FormShell({
  title,
  onClose,
  onSubmit,
  busy,
  formError,
  onDelete,
  children,
  submitLabel,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  busy: boolean;
  formError: string | null;
  onDelete?: () => void;
  children: ReactNode;
  submitLabel?: string;
}) {
  const { t } = useI18n();
  const formId = useId();
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <button type="button" className="btn danger" onClick={onDelete} disabled={busy}>
              <Trash2 aria-hidden />
              {t('common.delete')}
            </button>
          )}
          <div className="row">
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button type="submit" form={formId} className="btn primary" disabled={busy}>
              {submitLabel ?? t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form
        id={formId}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          onSubmit();
        }}
        noValidate
      >
        {formError && (
          <div className="form-error" role="alert">
            {formError}
          </div>
        )}
        <div className="form-grid">{children}</div>
      </form>
    </Modal>
  );
}

function EnumSelect({
  id,
  value,
  onChange,
  options,
  render,
  allowEmpty,
  emptyLabel,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  render: (v: string) => string;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  return (
    <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">{emptyLabel ?? '—'}</option>}
      {options.map((o) => (
        <option key={o} value={o}>
          {render(o)}
        </option>
      ))}
    </select>
  );
}

// ---------- Account combobox (server-side search) ----------

export function AccountCombobox({
  id,
  value,
  label,
  onChange,
}: {
  id?: string;
  value: { id: string; name: string };
  label?: string;
  onChange: (v: { id: string; name: string }) => void;
}) {
  const { t, fmt } = useI18n();
  const [text, setText] = useState(value.name);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<AccountRow[]>([]);
  const [active, setActive] = useState(0);
  const listId = useId();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => setText(value.name), [value.name]);

  useEffect(() => {
    if (!open) return;
    window.clearTimeout(timer.current);
    const ctrl = new AbortController();
    timer.current = window.setTimeout(() => {
      api
        .get<Paged<AccountRow>>('/accounts', { search: text === value.name ? '' : text, pageSize: 8, sort: 'name', dir: 'asc' }, ctrl.signal)
        .then((r) => {
          setOptions(r.rows);
          setActive(0);
        })
        .catch(() => {});
    }, 180);
    return () => {
      window.clearTimeout(timer.current);
      ctrl.abort();
    };
  }, [text, open, value.name]);

  const choose = (a: AccountRow) => {
    onChange({ id: String(a.id), name: a.name });
    setText(a.name);
    setOpen(false);
  };

  return (
    <div className="combo">
      <input
        id={id}
        className="input"
        style={{ width: '100%' }}
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={t('field.searchAccount')}
        value={text}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          if (value.id) onChange({ id: '', name: '' });
        }}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(options.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && options[active]) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <div className="combo-list" role="listbox" id={listId}>
          {options.length === 0 ? (
            <div className="combo-option muted">{t('common.noResults')}</div>
          ) : (
            options.map((a, i) => (
              <div
                key={a.id}
                role="option"
                aria-selected={i === active}
                className="combo-option"
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(a);
                }}
              >
                <span>{a.name}</span>
                <span className="muted">
                  {t(`segment.${a.segment}`)} · {fmt.moneyCompact(a.won_revenue)}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Deal form ----------

export function DealFormModal({
  deal,
  preset,
  onClose,
  onSaved,
}: {
  deal?: DealRow | null;
  preset?: { account_id?: number; account_name?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { meta, aes } = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = !!deal;
  const f = useForm({
    name: deal?.name ?? '',
    account_id: String(deal?.account_id ?? preset?.account_id ?? ''),
    account_name: deal?.account_name ?? preset?.account_name ?? '',
    owner_id: String(deal?.owner_id ?? aes[0]?.id ?? ''),
    stage: deal?.stage ?? 'prospecting',
    amount: deal ? String(deal.amount) : '',
    product: deal?.product ?? 'platform',
    type: deal?.type ?? 'new_business',
    source: deal?.source ?? 'sales',
    channel: deal?.channel ?? '',
    campaign_id: deal?.campaign_id ? String(deal.campaign_id) : '',
    expected_close: deal?.expected_close ?? D.addDays(meta.today, 60),
    lost_reason: deal?.lost_reason ?? '',
    next_step: deal?.next_step ?? '',
  });
  const v = f.values;
  const campaigns = meta.campaigns.filter((c) => !v.channel || c.channel === v.channel);

  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        account_id: toInt(v.account_id),
        owner_id: toInt(v.owner_id),
        stage: v.stage,
        amount: toInt(v.amount),
        product: v.product,
        type: v.type,
        source: v.source,
        channel: v.source === 'marketing' ? orNull(v.channel) : null,
        campaign_id: v.source === 'marketing' ? toInt(v.campaign_id) : null,
        expected_close: v.expected_close,
        lost_reason: v.stage === 'lost' ? orNull(v.lost_reason) : null,
        next_step: orNull(v.next_step),
      };
      if (editing) await api.patch(`/deals/${deal!.id}`, body);
      else await api.post('/deals', body);
      toast(editing ? t('common.saved') : t('common.created'));
      onSaved();
    });

  const remove = async () => {
    if (!deal || !(await confirm({ message: t('common.confirmDelete', { name: deal.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    f.submit(async () => {
      await api.del(`/deals/${deal.id}`);
      toast(t('common.deleted'));
      onSaved();
    });
  };

  return (
    <FormShell
      title={editing ? t('deals.edit') : t('deals.new')}
      onClose={onClose}
      onSubmit={save}
      busy={f.busy}
      formError={f.formError}
      onDelete={editing ? remove : undefined}
    >
      <Field label={t('field.name')} error={f.errors.name} full htmlFor="deal-name">
        <input id="deal-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.account')} error={f.errors.account_id} full htmlFor="deal-account">
        <AccountCombobox
          id="deal-account"
          label={t('field.account')}
          value={{ id: v.account_id, name: v.account_name }}
          onChange={(a) => {
            f.set('account_id', a.id);
            f.set('account_name', a.name);
          }}
        />
      </Field>
      <Field label={t('field.amount')} error={f.errors.amount} help={t('field.amountHelp')} htmlFor="deal-amount">
        <input id="deal-amount" className="input" inputMode="numeric" value={v.amount} onChange={(e) => f.set('amount', e.target.value.replace(/[^\d]/g, ''))} />
      </Field>
      <Field label={t('field.expectedClose')} error={f.errors.expected_close} htmlFor="deal-close">
        <input id="deal-close" className="input" type="date" value={v.expected_close} onChange={(e) => f.set('expected_close', e.target.value)} />
      </Field>
      <Field label={t('field.stage')} error={f.errors.stage} htmlFor="deal-stage">
        <EnumSelect id="deal-stage" value={v.stage} onChange={(x) => f.set('stage', x)} options={STAGES} render={(x) => t(`stage.${x}`)} />
      </Field>
      <Field label={t('field.owner')} error={f.errors.owner_id} htmlFor="deal-owner">
        <select id="deal-owner" className="select" value={v.owner_id} onChange={(e) => f.set('owner_id', e.target.value)}>
          {aes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {t(`segment.${r.team}`)}
            </option>
          ))}
        </select>
      </Field>
      {v.stage === 'lost' && (
        <Field label={t('field.lostReason')} error={f.errors.lost_reason} full htmlFor="deal-lost">
          <EnumSelect
            id="deal-lost"
            value={v.lost_reason}
            onChange={(x) => f.set('lost_reason', x)}
            options={LOST_REASONS}
            render={(x) => t(`lost.${x}`)}
            allowEmpty
          />
        </Field>
      )}
      <Field label={t('field.product')} error={f.errors.product} htmlFor="deal-product">
        <EnumSelect id="deal-product" value={v.product} onChange={(x) => f.set('product', x)} options={PRODUCTS} render={(x) => t(`product.${x}`)} />
      </Field>
      <Field label={t('field.type')} error={f.errors.type} htmlFor="deal-type">
        <EnumSelect id="deal-type" value={v.type} onChange={(x) => f.set('type', x)} options={DEAL_TYPES} render={(x) => t(`dealType.${x}`)} />
      </Field>
      <Field label={t('field.source')} error={f.errors.source} htmlFor="deal-source">
        <EnumSelect id="deal-source" value={v.source} onChange={(x) => f.set('source', x)} options={SOURCES} render={(x) => t(`source.${x}`)} />
      </Field>
      {v.source === 'marketing' ? (
        <Field label={t('field.channel')} error={f.errors.channel} htmlFor="deal-channel">
          <EnumSelect
            id="deal-channel"
            value={v.channel}
            onChange={(x) => {
              f.set('channel', x);
              f.set('campaign_id', '');
            }}
            options={CHANNELS}
            render={(x) => t(`channel.${x}`)}
            allowEmpty
            emptyLabel={t('field.none')}
          />
        </Field>
      ) : (
        <div />
      )}
      {v.source === 'marketing' && (
        <Field label={t('field.campaign')} error={f.errors.campaign_id} full htmlFor="deal-campaign">
          <select id="deal-campaign" className="select" value={v.campaign_id} onChange={(e) => f.set('campaign_id', e.target.value)}>
            <option value="">{t('field.none')}</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('field.nextStep')} error={f.errors.next_step} full htmlFor="deal-next">
        <input id="deal-next" className="input" value={v.next_step} onChange={(e) => f.set('next_step', e.target.value)} maxLength={300} />
      </Field>
    </FormShell>
  );
}

// ---------- Lost reason prompt (used by the kanban) ----------

export function LostReasonModal({ dealName, onCancel, onConfirm }: { dealName: string; onCancel: () => void; onConfirm: (r: LostReason) => void }) {
  const { t } = useI18n();
  const [reason, setReason] = useState<LostReason>('price');
  return (
    <FormShell title={t('pipeline.lostTitle')} onClose={onCancel} onSubmit={() => onConfirm(reason)} busy={false} formError={null} submitLabel={t('common.save')}>
      <p className="full secondary" style={{ margin: 0 }}>
        {t('pipeline.lostPrompt', { deal: dealName })}
      </p>
      <Field label={t('field.lostReason')} full htmlFor="lost-reason">
        <EnumSelect id="lost-reason" value={reason} onChange={(x) => setReason(x as LostReason)} options={LOST_REASONS} render={(x) => t(`lost.${x}`)} />
      </Field>
    </FormShell>
  );
}

// ---------- Lead form ----------

export function LeadFormModal({ lead, onClose, onSaved }: { lead?: LeadRow | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { meta, sdrs } = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = !!lead;
  const f = useForm({
    name: lead?.name ?? '',
    email: lead?.email ?? '',
    title: lead?.title ?? '',
    company: lead?.company ?? '',
    industry: lead?.industry ?? 'manufacturing',
    segment: lead?.segment ?? 'midmarket',
    region: lead?.region ?? 'jabodetabek',
    channel: lead?.channel ?? 'linkedin',
    campaign_id: lead?.campaign_id ? String(lead.campaign_id) : '',
    owner_id: lead?.owner_id ? String(lead.owner_id) : String(sdrs[0]?.id ?? ''),
    score: String(lead?.score ?? 20),
  });
  const v = f.values;
  const campaigns = meta.campaigns.filter((c) => c.channel === (v.channel as Channel));

  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        email: orNull(v.email),
        title: orNull(v.title),
        company: v.company,
        industry: v.industry,
        segment: v.segment,
        region: v.region,
        channel: v.channel,
        campaign_id: toInt(v.campaign_id),
        owner_id: toInt(v.owner_id),
        score: toInt(v.score),
      };
      if (editing) await api.patch(`/leads/${lead!.id}`, body);
      else await api.post('/leads', body);
      toast(editing ? t('common.saved') : t('common.created'));
      onSaved();
    });

  const remove = async () => {
    if (!lead || !(await confirm({ message: t('common.confirmDelete', { name: lead.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    f.submit(async () => {
      await api.del(`/leads/${lead.id}`);
      toast(t('common.deleted'));
      onSaved();
    });
  };

  return (
    <FormShell
      title={editing ? t('leads.edit') : t('leads.new')}
      onClose={onClose}
      onSubmit={save}
      busy={f.busy}
      formError={f.formError}
      onDelete={editing ? remove : undefined}
    >
      <Field label={t('field.leadName')} error={f.errors.name} htmlFor="lead-name">
        <input id="lead-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={120} />
      </Field>
      <Field label={t('field.title')} error={f.errors.title} htmlFor="lead-title">
        <input id="lead-title" className="input" value={v.title} onChange={(e) => f.set('title', e.target.value)} maxLength={120} />
      </Field>
      <Field label={t('field.email')} error={f.errors.email} htmlFor="lead-email">
        <input id="lead-email" className="input" type="email" value={v.email} onChange={(e) => f.set('email', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.company')} error={f.errors.company} htmlFor="lead-company">
        <input id="lead-company" className="input" value={v.company} onChange={(e) => f.set('company', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.industry')} error={f.errors.industry} htmlFor="lead-industry">
        <EnumSelect id="lead-industry" value={v.industry} onChange={(x) => f.set('industry', x)} options={INDUSTRIES} render={(x) => t(`industry.${x}`)} />
      </Field>
      <Field label={t('field.segment')} error={f.errors.segment} htmlFor="lead-segment">
        <EnumSelect id="lead-segment" value={v.segment} onChange={(x) => f.set('segment', x)} options={SEGMENTS} render={(x) => t(`segment.${x}`)} />
      </Field>
      <Field label={t('field.region')} error={f.errors.region} htmlFor="lead-region">
        <EnumSelect id="lead-region" value={v.region} onChange={(x) => f.set('region', x)} options={REGIONS} render={(x) => t(`region.${x}`)} />
      </Field>
      <Field label={t('field.channel')} error={f.errors.channel} htmlFor="lead-channel">
        <EnumSelect
          id="lead-channel"
          value={v.channel}
          onChange={(x) => {
            f.set('channel', x);
            f.set('campaign_id', '');
          }}
          options={CHANNELS}
          render={(x) => t(`channel.${x}`)}
        />
      </Field>
      <Field label={t('field.campaign')} error={f.errors.campaign_id} full htmlFor="lead-campaign">
        <select id="lead-campaign" className="select" value={v.campaign_id} onChange={(e) => f.set('campaign_id', e.target.value)}>
          <option value="">{t('field.none')}</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('field.sdr')} error={f.errors.owner_id} htmlFor="lead-owner">
        <select id="lead-owner" className="select" value={v.owner_id} onChange={(e) => f.set('owner_id', e.target.value)}>
          <option value="">{t('field.none')}</option>
          {sdrs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('field.score')} error={f.errors.score} htmlFor="lead-score">
        <input id="lead-score" className="input" type="number" min={0} max={100} value={v.score} onChange={(e) => f.set('score', e.target.value)} />
      </Field>
    </FormShell>
  );
}

export function ConvertLeadModal({ lead, onClose, onSaved }: { lead: LeadRow; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { meta, aes } = useMeta();
  const toast = useToast();
  const defaultOwner = aes.find((r) => r.team === lead.segment) ?? aes[0];
  const f = useForm({
    deal_name: '',
    owner_id: String(defaultOwner?.id ?? ''),
    amount: '',
    product: 'platform',
    expected_close: D.addDays(meta.today, 60),
  });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      await api.post(`/leads/${lead.id}/convert`, {
        deal_name: orNull(v.deal_name),
        owner_id: toInt(v.owner_id),
        amount: toInt(v.amount),
        product: v.product,
        expected_close: v.expected_close,
      });
      toast(t('leads.converted'));
      onSaved();
    });
  return (
    <FormShell title={t('leads.convertTitle')} onClose={onClose} onSubmit={save} busy={f.busy} formError={f.formError} submitLabel={t('leads.convert')}>
      <p className="full secondary" style={{ margin: 0 }}>
        <strong>{lead.name}</strong> · {lead.company}
        <br />
        <span className="muted">{t('leads.convertHelp')}</span>
      </p>
      <Field label={t('field.dealName')} error={f.errors.deal_name} full htmlFor="cv-name">
        <input id="cv-name" className="input" value={v.deal_name} onChange={(e) => f.set('deal_name', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.amount')} error={f.errors.amount} htmlFor="cv-amount">
        <input id="cv-amount" className="input" inputMode="numeric" value={v.amount} onChange={(e) => f.set('amount', e.target.value.replace(/[^\d]/g, ''))} />
      </Field>
      <Field label={t('field.expectedClose')} error={f.errors.expected_close} htmlFor="cv-close">
        <input id="cv-close" className="input" type="date" value={v.expected_close} onChange={(e) => f.set('expected_close', e.target.value)} />
      </Field>
      <Field label={t('field.owner')} error={f.errors.owner_id} htmlFor="cv-owner">
        <select id="cv-owner" className="select" value={v.owner_id} onChange={(e) => f.set('owner_id', e.target.value)}>
          {aes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} · {t(`segment.${r.team}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('field.product')} error={f.errors.product} htmlFor="cv-product">
        <EnumSelect id="cv-product" value={v.product} onChange={(x) => f.set('product', x)} options={PRODUCTS} render={(x) => t(`product.${x}`)} />
      </Field>
    </FormShell>
  );
}

// ---------- Campaign form ----------

export function CampaignFormModal({
  campaign,
  onClose,
  onSaved,
}: {
  campaign?: Pick<CampaignPerformance, 'id' | 'name' | 'channel' | 'start_date' | 'end_date' | 'budget' | 'spend' | 'status'> | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const { meta, reload } = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = !!campaign;
  const q = D.quarterOf(meta.today);
  const f = useForm({
    name: campaign?.name ?? '',
    channel: campaign?.channel ?? 'linkedin',
    start_date: campaign?.start_date ?? meta.today,
    end_date: campaign?.end_date ?? q.end,
    budget: campaign ? String(campaign.budget) : '',
    spend: campaign ? String(campaign.spend) : '0',
    status: campaign?.status ?? '',
  });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        channel: v.channel,
        start_date: v.start_date,
        end_date: v.end_date,
        budget: toInt(v.budget),
        spend: toInt(v.spend),
        status: orNull(v.status),
      };
      if (editing) await api.patch(`/campaigns/${campaign!.id}`, body);
      else await api.post('/campaigns', body);
      toast(editing ? t('common.saved') : t('common.created'));
      reload();
      onSaved();
    });
  const remove = async () => {
    if (!campaign || !(await confirm({ message: t('common.confirmDelete', { name: campaign.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    f.submit(async () => {
      await api.del(`/campaigns/${campaign.id}`);
      toast(t('common.deleted'));
      reload();
      onSaved();
    });
  };
  return (
    <FormShell
      title={editing ? t('campaigns.edit') : t('campaigns.new')}
      onClose={onClose}
      onSubmit={save}
      busy={f.busy}
      formError={f.formError}
      onDelete={editing ? remove : undefined}
    >
      <Field label={t('field.campaignName')} error={f.errors.name} full htmlFor="cp-name">
        <input id="cp-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.channel')} error={f.errors.channel} htmlFor="cp-channel">
        <EnumSelect id="cp-channel" value={v.channel} onChange={(x) => f.set('channel', x)} options={CHANNELS} render={(x) => t(`channel.${x}`)} />
      </Field>
      <Field label={t('field.status')} error={f.errors.status} htmlFor="cp-status">
        <EnumSelect
          id="cp-status"
          value={v.status}
          onChange={(x) => f.set('status', x)}
          options={CAMPAIGN_STATUSES}
          render={(x) => t(`campaignStatus.${x}`)}
          allowEmpty
          emptyLabel={t('field.auto')}
        />
      </Field>
      <Field label={t('field.startDate')} error={f.errors.start_date} htmlFor="cp-start">
        <input id="cp-start" className="input" type="date" value={v.start_date} onChange={(e) => f.set('start_date', e.target.value)} />
      </Field>
      <Field label={t('field.endDate')} error={f.errors.end_date} htmlFor="cp-end">
        <input id="cp-end" className="input" type="date" value={v.end_date} min={v.start_date} onChange={(e) => f.set('end_date', e.target.value)} />
      </Field>
      <Field label={t('field.budget')} error={f.errors.budget} htmlFor="cp-budget">
        <input id="cp-budget" className="input" inputMode="numeric" value={v.budget} onChange={(e) => f.set('budget', e.target.value.replace(/[^\d]/g, ''))} />
      </Field>
      <Field label={t('field.spend')} error={f.errors.spend} htmlFor="cp-spend">
        <input id="cp-spend" className="input" inputMode="numeric" value={v.spend} onChange={(e) => f.set('spend', e.target.value.replace(/[^\d]/g, ''))} />
      </Field>
    </FormShell>
  );
}

// ---------- Account form ----------

export function AccountFormModal({
  account,
  onClose,
  onSaved,
  onDeleted,
}: {
  account?: AccountRow | null;
  onClose: () => void;
  onSaved: (a: AccountRow) => void;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const { aes } = useMeta();
  const toast = useToast();
  const confirm = useConfirm();
  const editing = !!account;
  const f = useForm({
    name: account?.name ?? '',
    industry: account?.industry ?? 'manufacturing',
    segment: account?.segment ?? 'midmarket',
    region: account?.region ?? 'jabodetabek',
    employees: account ? String(account.employees) : '',
    website: account?.website ?? '',
    owner_id: account?.owner_id ? String(account.owner_id) : '',
    tier: account?.tier ?? '',
  });
  const v = f.values;
  const save = () =>
    f.submit(async () => {
      const body = {
        name: v.name,
        industry: v.industry,
        segment: v.segment,
        region: v.region,
        employees: toInt(v.employees),
        website: orNull(v.website),
        owner_id: toInt(v.owner_id),
        tier: orNull(v.tier),
      };
      const saved = editing ? await api.patch<AccountRow>(`/accounts/${account!.id}`, body) : await api.post<AccountRow>('/accounts', body);
      toast(editing ? t('common.saved') : t('common.created'));
      onSaved(saved);
    });
  const remove = async () => {
    if (!account || !(await confirm({ message: t('common.confirmDelete', { name: account.name }), confirmLabel: t('common.delete'), danger: true }))) return;
    f.submit(async () => {
      await api.del(`/accounts/${account.id}`);
      toast(t('common.deleted'));
      onDeleted?.();
    });
  };
  return (
    <FormShell
      title={editing ? t('accounts.edit') : t('accounts.new')}
      onClose={onClose}
      onSubmit={save}
      busy={f.busy}
      formError={f.formError}
      onDelete={editing && onDeleted ? remove : undefined}
    >
      <Field label={t('field.accountName')} error={f.errors.name} full htmlFor="ac-name">
        <input id="ac-name" className="input" value={v.name} onChange={(e) => f.set('name', e.target.value)} maxLength={200} />
      </Field>
      <Field label={t('field.industry')} error={f.errors.industry} htmlFor="ac-industry">
        <EnumSelect id="ac-industry" value={v.industry} onChange={(x) => f.set('industry', x)} options={INDUSTRIES} render={(x) => t(`industry.${x}`)} />
      </Field>
      <Field label={t('field.segment')} error={f.errors.segment} htmlFor="ac-segment">
        <EnumSelect id="ac-segment" value={v.segment} onChange={(x) => f.set('segment', x)} options={SEGMENTS} render={(x) => t(`segment.${x}`)} />
      </Field>
      <Field label={t('field.region')} error={f.errors.region} htmlFor="ac-region">
        <EnumSelect id="ac-region" value={v.region} onChange={(x) => f.set('region', x)} options={REGIONS} render={(x) => t(`region.${x}`)} />
      </Field>
      <Field label={t('field.tier')} error={f.errors.tier} htmlFor="ac-tier">
        <EnumSelect
          id="ac-tier"
          value={v.tier}
          onChange={(x) => f.set('tier', x)}
          options={ABM_TIERS}
          render={(x) => t(`tier.${x}`)}
          allowEmpty
          emptyLabel={t('field.auto')}
        />
      </Field>
      <Field label={t('field.owner')} error={f.errors.owner_id} htmlFor="ac-owner">
        <select id="ac-owner" className="select" value={v.owner_id} onChange={(e) => f.set('owner_id', e.target.value)}>
          <option value="">{t('field.none')}</option>
          {aes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('field.employees')} error={f.errors.employees} htmlFor="ac-emp">
        <input id="ac-emp" className="input" inputMode="numeric" value={v.employees} onChange={(e) => f.set('employees', e.target.value.replace(/[^\d]/g, ''))} />
      </Field>
      <Field label={t('field.website')} error={f.errors.website} full htmlFor="ac-web">
        <input id="ac-web" className="input" value={v.website} onChange={(e) => f.set('website', e.target.value)} maxLength={200} />
      </Field>
    </FormShell>
  );
}
