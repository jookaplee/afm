import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  BotOff,
  Building2,
  Check,
  CheckCheck,
  Clock3,
  EllipsisVertical,
  FileText,
  Info,
  MessageSquareText,
  Package,
  Pencil,
  Phone,
  SendHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type { OrderRow, Paged, WaContact, WaMessageRow, WaSummary, WaTemplate } from '../../../shared/types.ts';
import { fillTemplate, missingPlaceholders, waUrl, type WaSettings } from '../../../shared/whatsapp.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { telLink } from '../lib/contact.ts';
import { getApiKey } from '../agent/engine.ts';
import { aiDraft, templateVars } from './compose.ts';
import { agentWhere, answerConversation, useAgentTyping } from './agent.ts';
import { Avatar, PhoneBadges, WA_WINDOW, dayLabel, localDay } from './ui.tsx';

type Item =
  | { kind: 'msg'; at: string; msg: WaMessageRow }
  | { kind: 'reply'; at: string }
  | { kind: 'order'; at: string; order: OrderRow };

const WINDOW_MS = 24 * 60 * 60 * 1000;

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

/** Delivery state of an outgoing message, like WhatsApp's ticks. */
function MsgStatus({ m, readByReply }: { m: WaMessageRow; readByReply: boolean }) {
  const { t } = useI18n();
  const label = t(`wa.msgStatus.${m.status === 'opened' && readByReply ? 'read' : m.status}`);
  const icon =
    m.status === 'queued' ? (
      <Clock3 aria-hidden />
    ) : m.status === 'sent' ? (
      <Check aria-hidden />
    ) : m.status === 'failed' ? (
      <AlertTriangle aria-hidden />
    ) : (
      <CheckCheck aria-hidden />
    );
  const read = m.status === 'read' || (m.status === 'opened' && readByReply);
  return (
    <span className={`wa-ticks ${read ? 'read' : ''} ${m.status === 'failed' ? 'failed' : ''}`} title={m.error ? `${label}: ${m.error}` : label}>
      {icon}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Conversation({
  contact,
  summary,
  templates,
  tick,
  onBack,
  onChanged,
  onManageTemplates,
}: {
  contact: WaContact;
  summary: WaSummary;
  templates: WaTemplate[];
  /** Bumped by the page when data may have changed elsewhere (polling, other panes). */
  tick: number;
  onBack: () => void;
  onChanged: () => void;
  onManageTemplates: () => void;
}) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const settings: WaSettings = summary.settings;
  const live = summary.live;
  const [version, setVersion] = useState(0);
  const messages = useApi<Paged<WaMessageRow>>('/wa/messages', { lead_id: contact.lead_id, pageSize: 200, v: `${version}.${tick}` });
  const orders = useApi<Paged<OrderRow>>('/orders', { lead_id: contact.lead_id, pageSize: 20, v: `${version}.${tick}` });
  const typingSet = useAgentTyping();
  const typing = typingSet.has(contact.lead_id);
  const [text, setText] = useState('');
  const [asCustomer, setAsCustomer] = useState(false);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState<number | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };

  const fill = (tpl: WaTemplate) => fillTemplate(tpl.body, templateVars(contact, settings, t));

  // A first message starts from the first template; later ones start empty.
  useEffect(() => {
    setTplOpen(false);
    setAsCustomer(false);
    setEditingDraft(null);
    if (!contact.sent_count && !contact.wa_last_in_at && templates[0]) {
      setTemplateId(templates[0].id);
      setText(fill(templates[0]));
    } else {
      setTemplateId(null);
      setText('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.lead_id]);

  // Opening a conversation reads it.
  useEffect(() => {
    if (contact.wa_unread > 0) void api.patch(`/wa/leads/${contact.lead_id}`, { read: true }).then(onChanged, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact.lead_id, contact.wa_unread]);

  // Refresh once the agent finishes a reply for this chat.
  const wasTyping = useRef(typing);
  useEffect(() => {
    if (wasTyping.current && !typing) setVersion((v) => v + 1);
    wasTyping.current = typing;
  }, [typing]);

  const rows = messages.data?.rows ?? [];
  const hasInbound = rows.some((m) => m.direction === 'in');
  const items: Item[] = useMemo(() => {
    const list: Item[] = rows.map((m) => ({ kind: 'msg' as const, at: m.created_at, msg: m }));
    // A reply marked by hand (wa.me flow) when no incoming message is on record.
    if (contact.wa_replied_at && !hasInbound) list.push({ kind: 'reply', at: contact.wa_replied_at });
    for (const o of orders.data?.rows ?? []) list.push({ kind: 'order', at: o.created_at, order: o });
    return list.sort((a, b) => a.at.localeCompare(b.at));
  }, [rows, orders.data, contact.wa_replied_at, hasInbound]);
  const lastInboundAt = useMemo(() => rows.filter((m) => m.direction === 'in').reduce((a, m) => (m.created_at > a ? m.created_at : a), ''), [rows]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, contact.lead_id, typing]);

  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [text]);

  const windowOpen = !!contact.wa_last_in_at && Date.now() - Date.parse(contact.wa_last_in_at) < WINDOW_MS;
  const missing = asCustomer ? [] : missingPlaceholders(text);
  const body = text.trim();
  const canAgent = !!agentWhere(summary);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e, t) === 'window_closed' ? t('wa.windowClosed') : errorMessage(e, t), 'bad');
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** wa.me flow: the link opens WhatsApp; this records what was sent. */
  const recordOpened = async () => {
    const sentText = body;
    const draft = editingDraft;
    setText('');
    setTemplateId(null);
    setEditingDraft(null);
    await run(async () => {
      if (draft) {
        await api.patch(`/wa/messages/${draft}`, { body: sentText });
        await api.patch(`/wa/messages/${draft}`, { status: 'opened', at: new Date().toISOString() });
      } else {
        await api.post('/wa/messages', { lead_id: contact.lead_id, template_id: templateId, body: sentText, at: new Date().toISOString() });
      }
    });
  };

  /** Business API flow: the server sends it. */
  const sendLive = async (draftId?: number, draftBody?: string) => {
    const sentText = draftBody ?? body;
    if (!draftBody) {
      setText('');
      setTemplateId(null);
      setEditingDraft(null);
    }
    await run(() => api.post('/wa/send', { lead_id: contact.lead_id, body: sentText, message_id: draftId ?? editingDraft ?? undefined, template_id: templateId }));
  };

  /** A message from the customer, pasted from WhatsApp (or typed to try the agent). */
  const addInbound = async () => {
    const msg = body;
    setText('');
    await run(async () => {
      await api.post('/wa/inbound', { lead_id: contact.lead_id, body: msg, at: new Date().toISOString() });
      setVersion((v) => v + 1);
      onChanged();
      if (canAgent && !contact.wa_agent_off) {
        const out = await answerConversation(contact.lead_id, summary);
        if (out?.handoff) toast(t('wa.handedOff'), 'bad');
      }
    });
  };

  const patchLead = async (change: Record<string, unknown>, message: string) => {
    await run(async () => {
      await api.patch(`/wa/leads/${contact.lead_id}`, { ...change, at: new Date().toISOString() });
      toast(message);
    });
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
  const sendDisabled = !body || !contact.intl || busy || (live && !asCustomer && !windowOpen);

  return (
    <section className="wa-convo" aria-label={contact.company}>
      <header className="wa-convo-head">
        <button type="button" className="wa-icon-btn wa-back" onClick={onBack} aria-label={t('wa.back')}>
          <ArrowLeft aria-hidden />
        </button>
        <Avatar name={contact.company} seed={contact.lead_id} size={40} />
        <div className="wa-convo-title">
          <div className="wa-convo-name">{contact.company}</div>
          <div className={`wa-convo-sub ${typing ? 'typing' : ''}`}>
            {typing ? (
              t('wa.agentTyping')
            ) : (
              <>
                {contact.name} · <span className="num">{contact.phone}</span>
              </>
            )}
          </div>
        </div>
        <div className="wa-head-icons">
          <button
            type="button"
            className={`wa-icon-btn ${contact.wa_agent_off ? '' : 'on'}`}
            aria-pressed={!contact.wa_agent_off}
            aria-label={contact.wa_agent_off ? t('wa.agentOffChat') : t('wa.agentOnChat')}
            title={contact.wa_agent_off ? t('wa.agentOffChat') : t('wa.agentOnChat')}
            onClick={() => void patchLead({ agent_off: !contact.wa_agent_off }, contact.wa_agent_off ? t('wa.agentOnChat') : t('wa.agentOffChat'))}
          >
            {contact.wa_agent_off ? <BotOff aria-hidden /> : <Bot aria-hidden />}
          </button>
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
                {canAgent && hasInbound && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void run(() => answerConversation(contact.lead_id, summary));
                    }}
                  >
                    <Sparkles aria-hidden />
                    {t('wa.agentAnswerNow')}
                  </button>
                )}
                {!hasInbound && contact.sent_count > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      close();
                      void patchLead({ replied: !contact.wa_replied_at }, contact.wa_replied_at ? t('common.saved') : t('wa.markedReplied'));
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
                    void patchLead({ needs_human: !contact.wa_needs_human, reason: t('wa.humanByStaff') }, t('common.saved'));
                  }}
                >
                  <AlertTriangle aria-hidden />
                  {contact.wa_needs_human ? t('wa.humanDone') : t('wa.humanFlag')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    void patchLead({ wa_status: 'yes' }, t('common.saved'));
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
                    void patchLead({ wa_status: 'no' }, t('wa.markedNo'));
                  }}
                >
                  <X aria-hidden />
                  {t('wa.noWa')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    navigate(`/orders?lead=${contact.lead_id}`);
                  }}
                >
                  <Package aria-hidden />
                  {t('wa.viewOrders')}
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>

      {!!contact.wa_needs_human && (
        <div className="wa-human" role="status">
          <AlertTriangle aria-hidden />
          <span>
            <strong>{t('wa.needsHuman')}</strong>
            {contact.wa_human_reason ? ` · ${contact.wa_human_reason}` : ''}
          </span>
          <button type="button" className="btn sm" onClick={() => void patchLead({ needs_human: false }, t('common.saved'))}>
            {t('wa.humanDone')}
          </button>
        </div>
      )}

      <div className="wa-chat" ref={scroller}>
        <div className="wa-chat-inner">
          <div className="wa-system">
            <Info aria-hidden />
            {live ? t('wa.liveNotice') : t('wa.howItWorks')}
          </div>
          <div className="wa-system subtle">
            <PhoneBadges phone={contact.phone} shared={contact.shared} />
            {contact.wa_status === 'no' && <span className="badge bad">{t('wa.status.no')}</span>}
            {contact.wa_status === 'yes' && <span className="badge good">{t('wa.status.yes')}</span>}
            {contact.wa_agent_off ? <span className="badge">{t('wa.agentOffChat')}</span> : null}
          </div>
          {items.map((it, i) => {
            const prev = items[i - 1];
            const sep = !prev || localDay(prev.at) !== localDay(it.at);
            const key = it.kind === 'msg' ? `m${it.msg.id}` : it.kind === 'order' ? `o${it.order.id}` : 'reply';
            return (
              <div key={key}>
                {sep && <div className="wa-day">{dayLabel(it.at, fmt, t)}</div>}
                {it.kind === 'order' ? (
                  <Link className="wa-order-chip" to={`/orders?order=${it.order.id}`}>
                    <Package aria-hidden />
                    <span>
                      <strong>{t('wa.orderChip', { id: it.order.id, total: fmt.sen(it.order.total_sen) })}</strong>
                      <span>
                        {t(`order.status.${it.order.status}`)} · {it.order.items_summary}
                      </span>
                    </span>
                  </Link>
                ) : it.kind === 'reply' ? (
                  <div className="wa-bubble in">
                    <div className="wa-bubble-text wa-reply-note">{t('wa.replyEvent')}</div>
                    <div className="wa-bubble-meta">{t('wa.replyMarked', { time: fmt.clock(it.at) })}</div>
                  </div>
                ) : it.msg.direction === 'in' ? (
                  <div className="wa-bubble in">
                    <div className="wa-bubble-text">{it.msg.body}</div>
                    <div className="wa-bubble-meta">{fmt.clock(it.at)}</div>
                  </div>
                ) : it.msg.status === 'draft' ? (
                  <div className="wa-bubble out draft">
                    <div className="wa-bubble-tag">
                      <Bot aria-hidden /> {t('wa.draftTag')}
                    </div>
                    <div className="wa-bubble-text">{it.msg.body}</div>
                    <div className="wa-draft-actions">
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => void run(() => api.del(`/wa/messages/${it.msg.id}`))}
                        aria-label={t('wa.draftDiscard')}
                        title={t('wa.draftDiscard')}
                      >
                        <Trash2 aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => {
                          setAsCustomer(false);
                          setEditingDraft(it.msg.id);
                          setText(it.msg.body);
                          input.current?.focus({ preventScroll: true });
                        }}
                      >
                        <Pencil aria-hidden />
                        {t('common.edit')}
                      </button>
                      {live ? (
                        <button type="button" className="btn sm wa-cta" disabled={busy || !windowOpen} onClick={() => void sendLive(it.msg.id, it.msg.body)}>
                          <SendHorizontal aria-hidden />
                          {t('wa.draftSend')}
                        </button>
                      ) : contact.intl ? (
                        <a
                          className="btn sm wa-cta"
                          href={waUrl(contact.intl, it.msg.body)}
                          target={WA_WINDOW}
                          onClick={() =>
                            void run(() => api.patch(`/wa/messages/${it.msg.id}`, { status: 'opened', at: new Date().toISOString() }))
                          }
                        >
                          <SendHorizontal aria-hidden />
                          {t('wa.draftSend')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className={`wa-bubble out ${it.msg.status === 'failed' ? 'failed' : ''}`}>
                    {(it.msg.author === 'agent' || it.msg.template_name) && (
                      <div className="wa-bubble-tag">
                        {it.msg.author === 'agent' && (
                          <>
                            <Bot aria-hidden /> {t('wa.agentTag')}
                          </>
                        )}
                        {it.msg.author !== 'agent' && it.msg.template_name}
                      </div>
                    )}
                    <div className="wa-bubble-text">{it.msg.body}</div>
                    {it.msg.status === 'failed' && <div className="wa-bubble-error">{it.msg.error ?? t('wa.msgStatus.failed')}</div>}
                    <div className="wa-bubble-meta">
                      {fmt.clock(it.at)}
                      <MsgStatus m={it.msg} readByReply={!!lastInboundAt && it.at <= lastInboundAt} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {typing && (
            <div className="wa-bubble in wa-typing" aria-live="polite">
              <span className="sr-only">{t('wa.agentTyping')}</span>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </div>
          )}
        </div>
      </div>

      <footer className={`wa-compose-bar ${asCustomer ? 'as-customer' : ''}`}>
        {asCustomer && <div className="wa-compose-note">{t('wa.asCustomerNote')}</div>}
        {!asCustomer && live && !windowOpen && <div className="wa-compose-warn">{t('wa.windowClosed')}</div>}
        {editingDraft && !asCustomer && (
          <div className="wa-compose-note">
            {t('wa.editingDraft')}{' '}
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                setEditingDraft(null);
                setText('');
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
        )}
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
          <button
            type="button"
            className={`wa-icon-btn ${asCustomer ? 'on' : ''}`}
            aria-pressed={asCustomer}
            aria-label={t('wa.asCustomer')}
            title={t('wa.asCustomer')}
            onClick={() => {
              setAsCustomer((v) => !v);
              setTplOpen(false);
              setEditingDraft(null);
              setText('');
            }}
          >
            <MessageSquareText aria-hidden />
          </button>
          {!asCustomer && (
            <>
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
            </>
          )}
          <label htmlFor="wa-input" className="sr-only">
            {asCustomer ? t('wa.asCustomerPlaceholder') : t('wa.typeMessage')}
          </label>
          <textarea
            id="wa-input"
            ref={input}
            className="wa-input"
            rows={1}
            placeholder={asCustomer ? t('wa.asCustomerPlaceholder') : drafting ? t('wa.aiDrafting') : t('wa.typeMessage')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            disabled={!contact.intl && !asCustomer}
          />
          {asCustomer ? (
            <button type="button" className="wa-send customer" disabled={!body || busy} onClick={() => void addInbound()} aria-label={t('wa.asCustomerSend')} title={t('wa.asCustomerSend')}>
              <SendHorizontal aria-hidden />
            </button>
          ) : live ? (
            <button type="button" className="wa-send" disabled={sendDisabled} onClick={() => void sendLive()} aria-label={t('wa.sendLive')} title={t('wa.sendLive')}>
              <SendHorizontal aria-hidden />
            </button>
          ) : !sendDisabled ? (
            <a className="wa-send" href={waUrl(contact.intl!, body)} target={WA_WINDOW} aria-label={t('wa.sendAria')} title={t('wa.sendAria')} onClick={() => void recordOpened()}>
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
