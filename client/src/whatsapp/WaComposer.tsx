import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Sparkles, X } from 'lucide-react';
import type { WaTemplate } from '../../../shared/types.ts';
import { fillTemplate, missingPlaceholders, phoneInfo, waUrl, type WaSettings } from '../../../shared/whatsapp.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { Field, Loading, Modal } from '../components/ui.tsx';
import { getApiKey } from '../agent/engine.ts';
import { aiDraft, templateVars, type WaTarget } from './compose.ts';

/**
 * One named window for every chat, so a series of messages reuses one WhatsApp
 * Web tab instead of piling up tabs (no noopener: that would defeat the reuse).
 */
export const WA_WINDOW = 'joosons-whatsapp';

export function PhoneBadges({ phone, shared }: { phone: string | null; shared?: number }) {
  const { t } = useI18n();
  const info = phoneInfo(phone);
  return (
    <>
      <span className={`badge ${info.type === 'mobile' ? 'good' : info.type === 'invalid' ? 'bad' : ''}`}>{t(`wa.type.${info.type}`)}</span>
      {!!shared && (
        <span className="badge warn" title={t('wa.sharedHint', { n: shared })}>
          {t('wa.shared', { n: shared + 1 })}
        </span>
      )}
    </>
  );
}

export function WaStatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useI18n();
  return <span className={`badge ${status === 'yes' ? 'good' : status === 'no' ? 'bad' : ''}`}>{t(`wa.status.${status ?? 'unknown'}`)}</span>;
}

/** Writes a message from a template, opens it in WhatsApp and records it. */
export function WaComposer({ target, onClose, onSent }: { target: WaTarget; onClose: () => void; onSent?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const templates = useApi<WaTemplate[]>('/wa/templates');
  const settings = useApi<WaSettings>('/wa/settings');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [drafting, setDrafting] = useState(false);
  const [waStatus, setWaStatus] = useState(target.wa_status ?? null);
  const info = phoneInfo(target.phone);

  const fill = (tpl: WaTemplate | undefined) => (tpl && settings.data ? fillTemplate(tpl.body, templateVars(target, settings.data, t)) : '');
  // Start from the first template once templates and settings are in.
  useEffect(() => {
    if (templateId === null && templates.data?.length && settings.data) {
      setTemplateId(templates.data[0].id);
      setText(fill(templates.data[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates.data, settings.data]);

  const missing = useMemo(() => missingPlaceholders(text), [text]);
  const href = info.intl && text.trim() ? waUrl(info.intl, text.trim()) : null;

  const record = async () => {
    try {
      await api.post('/wa/messages', { lead_id: target.lead_id, template_id: templateId, body: text.trim(), at: new Date().toISOString() });
      toast(t('wa.recorded'));
      onSent?.();
      onClose();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const mark = async (status: 'yes' | 'no') => {
    try {
      await api.patch(`/wa/leads/${target.lead_id}`, { wa_status: status });
      setWaStatus(status);
      if (status === 'no') {
        toast(t('wa.markedNo'));
        onSent?.();
        onClose();
      }
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const draft = async () => {
    if (!settings.data) return;
    setDrafting(true);
    try {
      const tpl = templates.data?.find((x) => x.id === templateId);
      setText(await aiDraft({ target, settings: settings.data, template: tpl ? fill(tpl) : null, t }));
    } catch (e) {
      toast(e instanceof Error && e.message === 'no_key' ? t('wa.aiNeedKey') : errorMessage(e, t), 'bad');
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Modal
      title={t('wa.composeTitle', { name: target.company })}
      onClose={onClose}
      width={560}
      footer={
        <div className="row wa-actions">
          <button type="button" className="btn" onClick={() => void mark('no')}>
            <X aria-hidden />
            {t('wa.noWa')}
          </button>
          {href ? (
            <a className="btn primary" href={href} target={WA_WINDOW} onClick={() => void record()}>
              <MessageCircle aria-hidden />
              {t('wa.open')}
            </a>
          ) : (
            <button type="button" className="btn primary" disabled>
              <MessageCircle aria-hidden />
              {t('wa.open')}
            </button>
          )}
        </div>
      }
    >
      {!templates.data || !settings.data ? (
        <Loading />
      ) : (
        <div className="wa-compose">
          <div className="wa-to">
            <div>
              <div className="cell-main">{target.name}</div>
              <div className="cell-sub">{target.company}</div>
            </div>
            <div className="wa-to-phone">
              <span className="num">{target.phone}</span>
              <PhoneBadges phone={target.phone} />
              <WaStatusBadge status={waStatus} />
            </div>
          </div>
          <div className="wa-template-row">
            <Field label={t('wa.template')} htmlFor="wa-template">
              <select
                id="wa-template"
                className="select"
                value={templateId ?? ''}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  setTemplateId(id);
                  setText(fill(templates.data!.find((x) => x.id === id)));
                }}
              >
                <option value="">{t('wa.noTemplate')}</option>
                {templates.data.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </Field>
            <button type="button" className="btn" onClick={() => void draft()} disabled={drafting || !getApiKey()} title={getApiKey() ? undefined : t('wa.aiNeedKey')}>
              <Sparkles aria-hidden />
              {drafting ? t('wa.aiDrafting') : t('wa.aiDraft')}
            </button>
          </div>
          <Field label={t('wa.message')} htmlFor="wa-text" full>
            <textarea id="wa-text" className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </Field>
          {missing.length > 0 && (
            <p className="wa-warn" role="status">
              {t('wa.missing', { list: missing.map((m) => `{${m}}`).join(', ') })}
            </p>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            {t('wa.howItWorks')}
          </p>
        </div>
      )}
    </Modal>
  );
}
