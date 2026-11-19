import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, SkipForward, X } from 'lucide-react';
import type { Paged, WaContact, WaTemplate } from '../../../shared/types.ts';
import { fillTemplate, missingPlaceholders, waUrl, type WaSettings } from '../../../shared/whatsapp.ts';
import { api, type Params } from '../lib/api.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { Field, Loading, Modal } from '../components/ui.tsx';
import { templateVars } from './compose.ts';
import { PhoneBadges, WA_WINDOW } from './ui.tsx';

/**
 * Goes through the current contact list one lead at a time: each "open" sends
 * the prepared text to WhatsApp, records it and moves to the next lead.
 */
export function WaCampaign({ filters, templates, settings, onClose }: { filters: Params; templates: WaTemplate[]; settings: WaSettings; onClose: () => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [queue, setQueue] = useState<WaContact[] | null>(null);
  const [index, setIndex] = useState(0);
  const [templateId, setTemplateId] = useState<number | null>(templates[0]?.id ?? null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(0);
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    api
      // "All" means everyone not contacted yet: a campaign never repeats itself by accident.
      // The "sent" list gives a follow-up campaign on purpose.
      .get<Paged<WaContact>>('/wa/contacts', { ...filters, stage: !filters.stage || filters.stage === 'all' ? 'todo' : filters.stage, sort: 'score', page: 1, pageSize: 1000 })
      .then((r) => setQueue(r.rows.filter((c) => c.intl && c.wa_status !== 'no')))
      .catch((e) => {
        toast(errorMessage(e, t), 'bad');
        setQueue([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = queue?.[index];
  const template = templates.find((x) => x.id === templateId);
  const filled = useMemo(() => (current && template ? fillTemplate(template.body, templateVars(current, settings, t)) : ''), [current, template, settings, t]);
  useEffect(() => setText(filled), [filled]);
  const missing = missingPlaceholders(text);
  const done = !!queue && index >= queue.length;

  const next = () => setIndex((i) => i + 1);
  const record = async (c: WaContact, body: string) => {
    setSent((n) => n + 1);
    next();
    try {
      await api.post('/wa/messages', { lead_id: c.lead_id, template_id: templateId, body, at: new Date().toISOString() });
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };
  const markNo = async (c: WaContact) => {
    setSkipped((n) => n + 1);
    next();
    try {
      await api.patch(`/wa/leads/${c.lead_id}`, { wa_status: 'no' });
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  return (
    <Modal
      title={t('wa.campaignTitle')}
      onClose={onClose}
      width={600}
      footer={
        current && (
          <div className="row wa-actions">
            <button type="button" className="btn" onClick={() => void markNo(current)}>
              <X aria-hidden />
              {t('wa.noWa')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setSkipped((n) => n + 1);
                next();
              }}
            >
              <SkipForward aria-hidden />
              {t('wa.skip')}
            </button>
            <a
              className="btn primary"
              href={waUrl(current.intl!, text.trim())}
              target={WA_WINDOW}
              onClick={(e) => {
                if (!text.trim()) {
                  e.preventDefault();
                  return;
                }
                void record(current, text.trim());
              }}
            >
              <MessageCircle aria-hidden />
              {t('wa.openNext')}
            </a>
          </div>
        )
      }
    >
      {!queue ? (
        <Loading />
      ) : queue.length === 0 ? (
        <p>{t('wa.campaignEmpty')}</p>
      ) : done ? (
        <p role="status">{t('wa.campaignDone', { sent, skipped })}</p>
      ) : (
        <div className="wa-compose">
          <p className="muted small" style={{ margin: 0 }}>
            {t('wa.campaignIntro', { n: fmt.num(queue.length) })} {t('wa.campaignPace')}
          </p>
          <div className="wa-progress" role="status">
            <span>{t('wa.campaignProgress', { i: fmt.num(index + 1), n: fmt.num(queue.length), sent, skipped })}</span>
            <div className="usage-bar" aria-hidden>
              <div style={{ width: `${(index / queue.length) * 100}%` }} />
            </div>
          </div>
          {current && (
            <>
              <div className="wa-to">
                <div>
                  <div className="cell-main">{current.company}</div>
                  <div className="cell-sub">
                    {current.name} · {t(`region.${current.region}`)} · {t(`segmentShort.${current.segment}`)}
                  </div>
                </div>
                <div className="wa-to-phone">
                  <span className="num">{current.phone}</span>
                  <PhoneBadges phone={current.phone} shared={current.shared} />
                </div>
              </div>
              <Field label={t('wa.template')} htmlFor="wac-template">
                <select id="wac-template" className="select" value={templateId ?? ''} onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : null)}>
                  <option value="">{t('wa.noTemplate')}</option>
                  {templates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t('wa.message')} htmlFor="wac-text" full>
                <textarea id="wac-text" className="input" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
              </Field>
              {missing.length > 0 && <p className="wa-warn">{t('wa.missing', { list: missing.map((m) => `{${m}}`).join(', ') })}</p>}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
