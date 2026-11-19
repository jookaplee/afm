import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Building2, CheckCheck, EllipsisVertical, FileText, Info, Phone, SendHorizontal, Sparkles, Undo2, X } from 'lucide-react';
import type { Paged, WaContact, WaMessageRow, WaTemplate } from '../../../shared/types.ts';
import { fillTemplate, missingPlaceholders, waUrl, type WaSettings } from '../../../shared/whatsapp.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { telLink } from '../lib/contact.ts';
import { getApiKey } from '../agent/engine.ts';
import { aiDraft, templateVars } from './compose.ts';
import { Avatar, PhoneBadges, Ticks, WA_WINDOW, dayLabel, localDay } from './ui.tsx';

type Item = { kind: 'out'; at: string; msg: WaMessageRow } | { kind: 'reply'; at: string };

/** A small menu that closes on outside click or Escape. */
function Menu({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="wa-menu-wrap" ref={ref}>
      <button type="button" className="wa-icon-btn" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {icon}
      </button>
      {open && (
        <div className="wa-menu" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function Conversation({
  contact,
  settings,
  templates,
  onBack,
  onChanged,
  onManageTemplates,
}: {
  contact: WaContact;
  settings: WaSettings;
  templates: WaTemplate[];
  onBack: () => void;
  onChanged: () => void;
  onManageTemplates: () => void;
}) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [version, setVersion] = useState(0);
  const messages = useApi<Paged<WaMessageRow>>('/wa/messages', { lead_id: contact.lead_id, pageSize: 200, v: version });
  const [text, setText] = useState('');
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const fill = (tpl: WaTemplate) => fillTemplate(tpl.body, templateVars(contact, settings, t));

  // A first message starts from the first template; later ones start empty.
  useEffect(() => {
    setTplOpen(false);
    if (!contact.sent_count && templates[0]) {
      setTemplateId(templates[0].id);
      setText(fill(templates[0]));
    } else {
      setTemplateId(null);
      setText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.lead_id]);

  const items: Item[] = useMemo(() => {
    const list: Item[] = (messages.data?.rows ?? []).map((m) => ({ kind: 'out' as const, at: m.created_at, msg: m }));
    if (contact.wa_replied_at) list.push({ kind: 'reply', at: contact.wa_replied_at });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [messages.data, contact.wa_replied_at]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, contact.lead_id]);

  // Grow the input with its text, like a chat composer (up to a few lines).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const missing = missingPlaceholders(text);
  const body = text.trim();
  const href = contact.intl && body ? waUrl(contact.intl, body) : null;

  const record = async () => {
    const sentText = body;
    setText('');
    setTemplateId(null);
    try {
      await api.post('/wa/messages', { lead_id: contact.lead_id, template_id: templateId, body: sentText, at: new Date().toISOString() });
      setVersion((v) => v + 1);
      onChanged();
    } catch (e) {
      setText(sentText);
      toast(errorMessage(e, t), 'bad');
    }
  };

  const patch = async (change: Record<string, unknown>, message: string) => {
    try {
      await api.patch(`/wa/leads/${contact.lead_id}`, { ...change, at: new Date().toISOString() });
      toast(message);
      onChanged();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const draft = async () => {
    setDrafting(true);
    try {
      const tpl = templates.find((x) => x.id === templateId);
      setText(await aiDraft({ target: contact, settings, template: tpl ? fill(tpl) : body || null, t }));
    } catch (e) {
      toast(e instanceof Error && e.message === 'no_key' ? t('wa.aiNeedKey') : errorMessage(e, t), 'bad');
    } finally {
      setDrafting(false);
    }
  };

  const tel = telLink(contact.phone);
  const hasKey = !!getApiKey();

  return (
    <section className="wa-convo" aria-label={contact.company}>
      <header className="wa-convo-head">
        <button type="button" className="wa-icon-btn wa-back" onClick={onBack} aria-label={t('wa.back')}>
          <ArrowLeft aria-hidden />
        </button>
        <Avatar name={contact.company} seed={contact.lead_id} size={40} />
        <div className="wa-convo-title">
          <div className="wa-convo-name">{contact.company}</div>
          <div className="wa-convo-sub">
            {contact.name} · <span className="num">{contact.phone}</span>
          </div>
        </div>
        <div className="wa-head-icons">
          {tel && (
            <a className="wa-icon-btn" href={tel} aria-label={t('wa.call')} title={t('wa.call')}>
              <Phone aria-hidden />
            </a>
          )}
          {contact.account_id && (
            <Link className="wa-icon-btn" to={`/accounts/${contact.account_id}`} aria-label={t('wa.openAccount')} title={t('wa.openAccount')}>
              <Building2 aria-hidden />
            </Link>
          )}
          <Menu label={t('wa.more')} icon={<EllipsisVertical aria-hidden />}>
            {(close) => (
              <>
                {contact.sent_count > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void patch({ replied: !contact.wa_replied_at }, contact.wa_replied_at ? t('common.saved') : t('wa.markedReplied'));
                    }}
                  >
                    {contact.wa_replied_at ? <Undo2 aria-hidden /> : <CheckCheck aria-hidden />}
                    {contact.wa_replied_at ? t('wa.unmarkReplied') : t('wa.markReplied')}
                  </button>
                )}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void patch({ wa_status: 'yes' }, t('common.saved'));
                  }}
                >
                  <CheckCheck aria-hidden />
                  {t('wa.hasWa')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void patch({ wa_status: 'no' }, t('wa.markedNo'));
                  }}
                >
                  <X aria-hidden />
                  {t('wa.noWa')}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      <div className="wa-chat" ref={scroller}>
        <div className="wa-chat-inner">
          <div className="wa-system">
            <Info aria-hidden />
            {t('wa.howItWorks')}
          </div>
          <div className="wa-system subtle">
            <PhoneBadges phone={contact.phone} shared={contact.shared} />
            {contact.wa_status === 'no' && <span className="badge bad">{t('wa.status.no')}</span>}
            {contact.wa_status === 'yes' && <span className="badge good">{t('wa.status.yes')}</span>}
          </div>
          {items.map((it, i) => {
            const prev = items[i - 1];
            const sep = !prev || localDay(prev.at) !== localDay(it.at);
            return (
              <div key={it.kind === 'out' ? `m${it.msg.id}` : 'reply'}>
                {sep && <div className="wa-day">{dayLabel(it.at, fmt, t)}</div>}
                {it.kind === 'out' ? (
                  <div className="wa-bubble out">
                    {it.msg.template_name && <div className="wa-bubble-tag">{it.msg.template_name}</div>}
                    <div className="wa-bubble-text">{it.msg.body}</div>
                    <div className="wa-bubble-meta">
                      {fmt.clock(it.at)}
                      <Ticks read={!!contact.wa_replied_at && it.at <= contact.wa_replied_at} />
                    </div>
                  </div>
                ) : (
                  <div className="wa-bubble in">
                    <div className="wa-bubble-text wa-reply-note">{t('wa.replyEvent')}</div>
                    <div className="wa-bubble-meta">{t('wa.replyMarked', { time: fmt.clock(it.at) })}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <footer className="wa-compose-bar">
        {missing.length > 0 && <div className="wa-compose-warn">{t('wa.missing', { list: missing.map((m) => `{${m}}`).join(', ') })}</div>}
        {tplOpen && (
          <div className="wa-tpl-menu" role="menu">
            {templates.map((x) => (
              <button
                key={x.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setTemplateId(x.id);
                  setText(fill(x));
                  setTplOpen(false);
                  input.current?.focus({ preventScroll: true });
                }}
              >
                <strong>{x.name}</strong>
                <span>{fill(x)}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="wa-tpl-manage"
              onClick={() => {
                setTplOpen(false);
                onManageTemplates();
              }}
            >
              {t('wa.manageTemplates')}
            </button>
          </div>
        )}
        <div className="wa-compose-row">
          <button type="button" className="wa-icon-btn" aria-label={t('wa.templatesMenu')} title={t('wa.templatesMenu')} aria-expanded={tplOpen} onClick={() => setTplOpen((o) => !o)}>
            <FileText aria-hidden />
          </button>
          <button
            type="button"
            className="wa-icon-btn"
            aria-label={t('wa.aiDraft')}
            title={hasKey ? t('wa.aiDraft') : t('wa.aiNeedKey')}
            disabled={drafting || !hasKey}
            onClick={() => void draft()}
          >
            <Sparkles aria-hidden className={drafting ? 'spin' : undefined} />
          </button>
          <label htmlFor="wa-input" className="sr-only">
            {t('wa.typeMessage')}
          </label>
          <textarea
            id="wa-input"
            ref={input}
            className="wa-input"
            rows={1}
            placeholder={drafting ? t('wa.aiDrafting') : t('wa.typeMessage')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            disabled={!contact.intl}
          />
          {href ? (
            <a className="wa-send" href={href} target={WA_WINDOW} aria-label={t('wa.sendAria')} title={t('wa.sendAria')} onClick={() => void record()}>
              <SendHorizontal aria-hidden />
            </a>
          ) : (
            <button type="button" className="wa-send" disabled aria-label={t('wa.sendAria')}>
              <SendHorizontal aria-hidden />
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}
