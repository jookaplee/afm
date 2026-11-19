import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle, Bot, History, Megaphone, MessageCircle, Search, Settings2, SlidersHorizontal, SquarePen } from 'lucide-react';
import { REGIONS, SEGMENTS, type Region, type Segment } from '../../../shared/constants.ts';
import type { Paged, WaContact, WaSummary, WaTemplate } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDebounced } from '../lib/useDebounced.ts';
import { ErrorState, Loading } from '../components/ui.tsx';
import { Conversation } from '../whatsapp/Conversation.tsx';
import { WaCampaign } from '../whatsapp/WaCampaign.tsx';
import { WaAgentModal, WaSettingsModal } from '../whatsapp/WaForms.tsx';
import { useAgentTyping } from '../whatsapp/agent.ts';
import { LogModal, TemplatesModal } from '../whatsapp/WaManage.tsx';
import { Avatar, Ticks, chatTime } from '../whatsapp/ui.tsx';

type Stage = 'all' | 'unread' | 'human' | 'todo' | 'sent' | 'replied';
type PhoneFilter = 'mobile' | 'landline' | 'invalid' | 'chat';
const STEP = 40;

function ChatRow({ c, active, typing, onOpen }: { c: WaContact; active: boolean; typing: boolean; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  const hasMessages = !!c.last_at;
  const lastAt = [c.wa_replied_at, c.last_sent_at, c.last_at].filter(Boolean).sort().pop() ?? null;
  const unread = c.wa_unread > 0;
  return (
    <button type="button" className={`wa-row ${unread ? 'unread' : ''}`} aria-current={active ? 'true' : undefined} onClick={onOpen}>
      <Avatar name={c.company} seed={c.lead_id} />
      <span className="wa-row-main">
        <span className="wa-row-top">
          <span className="wa-row-name">{c.company}</span>
          <span className={`wa-row-time ${unread ? 'hot' : ''}`}>{chatTime(lastAt, fmt, t)}</span>
        </span>
        <span className="wa-row-bottom">
          <span className="wa-row-preview">
            {typing ? (
              <span className="wa-typing-text">{t('wa.agentTyping')}</span>
            ) : !hasMessages ? (
              <>
                {c.name} · {c.phone}
              </>
            ) : c.last_status === 'draft' ? (
              <>
                <span className="wa-draft-label">{t('wa.draftLabel')}</span>
                {c.last_body}
              </>
            ) : c.last_direction === 'out' ? (
              <>
                <Ticks read={c.last_status === 'read' || !!c.wa_replied_at} />
                {c.last_body}
              </>
            ) : (
              <>{c.last_body}</>
            )}
          </span>
          {!!c.wa_needs_human && (
            <span className="wa-pill human" title={c.wa_human_reason ?? undefined}>
              <AlertTriangle aria-hidden />
              {t('wa.needsHumanShort')}
            </span>
          )}
          {unread ? (
            <span className="wa-unread" aria-label={t('wa.unreadCount', { n: c.wa_unread })}>
              {c.wa_unread}
            </span>
          ) : c.drafts > 0 && !c.wa_needs_human ? (
            <span className="wa-pill draft">{t('wa.draftLabelShort')}</span>
          ) : c.wa_replied_at && !c.wa_needs_human && !c.wa_last_in_at ? (
            <span className="wa-pill">{t('wa.repliedBadge')}</span>
          ) : c.wa_status === 'no' ? (
            <span className="wa-pill muted">{t('wa.status.no')}</span>
          ) : !hasMessages && c.intl ? (
            <span className="wa-dot" title={t('wa.stage.todo')}>
              <span className="sr-only">{t('wa.stage.todo')}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function EmptyPane({ s, onCampaign, onAgent }: { s: WaSummary | undefined; onCampaign: () => void; onAgent: () => void }) {
  const { t, fmt } = useI18n();
  return (
    <div className="wa-empty">
      <span className="wa-empty-icon" aria-hidden>
        <MessageCircle />
      </span>
      <h2>{t('wa.noChatTitle')}</h2>
      <p>{t('wa.noChatBody')}</p>
      {s && (
        <button type="button" className={`wa-mode ${s.live ? 'live' : ''}`} onClick={onAgent}>
          <Bot aria-hidden />
          <span>
            <strong>{s.live ? t('wa.modeLive') : t('wa.modeAssist')}</strong>
            <span>{s.live ? t('wa.modeLiveBody') : t('wa.modeAssistBody')}</span>
          </span>
        </button>
      )}
      {s && (
        <dl className="wa-empty-stats">
          <div>
            <dt>{t('wa.kpi.chat')}</dt>
            <dd>{fmt.num(s.mobile)}</dd>
          </div>
          <div>
            <dt>{t('wa.kpi.todo')}</dt>
            <dd>{fmt.num(s.todo)}</dd>
          </div>
          <div>
            <dt>{t('wa.kpi.sent')}</dt>
            <dd>{fmt.num(s.messages)}</dd>
          </div>
          <div>
            <dt>{t('wa.kpi.replied')}</dt>
            <dd>
              {fmt.num(s.replied)}
              <small> · {fmt.pct0(s.contacted ? s.replied / s.contacted : null)}</small>
            </dd>
          </div>
        </dl>
      )}
      <button className="btn wa-cta" onClick={onCampaign}>
        <Megaphone aria-hidden />
        {t('wa.campaign')}
      </button>
      <p className="wa-empty-note">{t('wa.campaignPace')}</p>
    </div>
  );
}

export default function WhatsAppPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const selectedId = Number(params.get('lead')) || null;
  const [stage, setStage] = useState<Stage>('all');
  const [type, setType] = useState<PhoneFilter | ''>('mobile');
  const [region, setRegion] = useState<Region | ''>('');
  const [segment, setSegment] = useState<Segment | ''>('');
  const [showFilters, setShowFilters] = useState(false);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(STEP);
  const [version, setVersion] = useState(0);
  const [campaign, setCampaign] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const typing = useAgentTyping();
  const q = useDebounced(search);
  const bump = () => setVersion((v) => v + 1);

  const filters = useMemo(
    () => ({ stage, type: type || undefined, region: region || undefined, segment: segment || undefined, search: q }),
    [stage, type, region, segment, q],
  );
  useEffect(() => setLimit(STEP), [filters]);
  const list = useApi<Paged<WaContact>>('/wa/contacts', { ...filters, page: 1, pageSize: limit, v: version });
  const summary = useApi<WaSummary>('/wa/summary', { v: version });
  const templates = useApi<WaTemplate[]>('/wa/templates', { v: version });
  const selected = useApi<Paged<WaContact>>(selectedId ? '/wa/contacts' : null, { lead_id: selectedId ?? undefined, v: version });
  const contact = selected.data?.rows[0] ?? null;
  const s = summary.data;

  // A reply the agent just drafted shows up in the list.
  const typingCount = useRef(typing.size);
  useEffect(() => {
    if (typing.size < typingCount.current) bump();
    typingCount.current = typing.size;
  }, [typing]);
  // Connected to WhatsApp (or the server answers): new messages arrive by themselves.
  useEffect(() => {
    if (!s?.live && !s?.agentServer) return;
    const id = setInterval(bump, 10_000);
    return () => clearInterval(id);
  }, [s?.live, s?.agentServer]);
  const needsSender = !!s && (!s.settings.myName || !s.settings.company);

  const open = (leadId: number | null) => {
    const next = new URLSearchParams(params);
    if (leadId) next.set('lead', String(leadId));
    else next.delete('lead');
    setParams(next);
  };

  return (
    <div className="page wa-page">
      <div className={`wa-app ${selectedId ? 'has-chat' : ''}`}>
        <aside className="wa-side" aria-label={t('wa.title')}>
          <header className="wa-side-head">
            <h1>{t('wa.title')}</h1>
            <div className="wa-head-icons">
              <button type="button" className="wa-icon-btn" onClick={() => setAgentOpen(true)} aria-label={t('wa.agentSettings')} title={t('wa.agentSettings')} disabled={!s}>
                <Bot aria-hidden />
              </button>
              <button type="button" className="wa-icon-btn" onClick={() => setCampaign(true)} aria-label={t('wa.campaign')} title={t('wa.campaign')} disabled={!s || !templates.data}>
                <Megaphone aria-hidden />
              </button>
              <button type="button" className="wa-icon-btn" onClick={() => setTemplatesOpen(true)} aria-label={t('wa.templatesTitle')} title={t('wa.templatesTitle')} disabled={!templates.data}>
                <SquarePen aria-hidden />
              </button>
              <button type="button" className="wa-icon-btn" onClick={() => setLogOpen(true)} aria-label={t('wa.tab.log')} title={t('wa.tab.log')}>
                <History aria-hidden />
              </button>
              <button type="button" className="wa-icon-btn" onClick={() => setSettingsOpen(true)} aria-label={t('wa.settings')} title={t('wa.settings')} disabled={!s}>
                <Settings2 aria-hidden />
              </button>
            </div>
          </header>
          {needsSender && (
            <button type="button" className="wa-banner" onClick={() => setSettingsOpen(true)}>
              <strong>{t('wa.setupTitle')}</strong>
              <span>{t('wa.setupBody')}</span>
            </button>
          )}
          <div className="wa-search">
            <Search aria-hidden />
            <label htmlFor="wa-search" className="sr-only">
              {t('wa.searchChats')}
            </label>
            <input id="wa-search" type="search" placeholder={t('wa.searchChats')} value={search} onChange={(e) => setSearch(e.target.value)} />
            <button type="button" className="wa-icon-btn" aria-pressed={showFilters} aria-label={t('wa.filters')} title={t('wa.filters')} onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal aria-hidden />
            </button>
          </div>
          <div className="wa-chips" role="group" aria-label={t('wa.col.status')}>
            {(['all', 'unread', 'human', 'todo', 'sent', 'replied'] as Stage[]).map((k) => (
              <button key={k} type="button" className="wa-chip" aria-pressed={stage === k} onClick={() => setStage(k)}>
                {t(`wa.stage.${k}`)}
                {k === 'unread' && !!s?.unread && <span className="wa-chip-count">{s.unread}</span>}
                {k === 'human' && !!s?.needsHuman && <span className="wa-chip-count human">{s.needsHuman}</span>}
              </button>
            ))}
          </div>
          {showFilters && (
            <div className="wa-filters">
              <select className="select" aria-label={t('wa.col.phone')} value={type} onChange={(e) => setType(e.target.value as PhoneFilter | '')}>
                {(['mobile', 'landline', 'invalid', 'chat'] as PhoneFilter[]).map((v) => (
                  <option key={v} value={v}>
                    {t(`wa.type.${v}`)}
                  </option>
                ))}
                <option value="">{t('wa.type.all')}</option>
              </select>
              <select className="select" aria-label={t('col.region')} value={region} onChange={(e) => setRegion(e.target.value as Region | '')}>
                <option value="">{t('filter.allRegions')}</option>
                {REGIONS.map((v) => (
                  <option key={v} value={v}>
                    {t(`region.${v}`)}
                  </option>
                ))}
              </select>
              <select className="select" aria-label={t('col.segment')} value={segment} onChange={(e) => setSegment(e.target.value as Segment | '')}>
                <option value="">{t('filter.allSegments')}</option>
                {SEGMENTS.map((v) => (
                  <option key={v} value={v}>
                    {t(`segment.${v}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {s && (
            <p className="wa-stats" role="status">
              {t('wa.statsLine', { mobile: fmt.num(s.mobile), todo: fmt.num(s.todo), sent: fmt.num(s.contacted), replied: fmt.num(s.replied) })}
            </p>
          )}
          <div className={`wa-list ${list.loading ? 'refetching' : ''}`}>
            {list.data ? (
              list.data.rows.length ? (
                <>
                  {list.data.rows.map((c) => (
                    <ChatRow key={c.lead_id} c={c} active={c.lead_id === selectedId} typing={typing.has(c.lead_id)} onOpen={() => open(c.lead_id)} />
                  ))}
                  {list.data.total > list.data.rows.length && (
                    <button type="button" className="wa-more" onClick={() => setLimit((n) => n + STEP)}>
                      {t('wa.loadMore')} · {fmt.num(list.data.total - list.data.rows.length)}
                    </button>
                  )}
                </>
              ) : (
                <p className="wa-list-empty">{t('wa.noContacts')}</p>
              )
            ) : list.error ? (
              <ErrorState onRetry={list.reload} />
            ) : (
              <Loading />
            )}
          </div>
        </aside>

        <div className="wa-main">
          {selectedId && contact && s && templates.data ? (
            <Conversation
              contact={contact}
              summary={s}
              templates={templates.data}
              tick={version}
              onBack={() => open(null)}
              onChanged={bump}
              onManageTemplates={() => setTemplatesOpen(true)}
            />
          ) : selectedId && !selected.error ? (
            <Loading />
          ) : (
            <EmptyPane s={s} onCampaign={() => setCampaign(true)} onAgent={() => setAgentOpen(true)} />
          )}
        </div>
      </div>

      {campaign && s && templates.data && (
        <WaCampaign
          filters={filters}
          templates={templates.data}
          settings={s.settings}
          onClose={() => {
            setCampaign(false);
            bump();
          }}
        />
      )}
      {templatesOpen && templates.data && <TemplatesModal templates={templates.data} onClose={() => setTemplatesOpen(false)} onChanged={bump} />}
      {logOpen && (
        <LogModal
          onClose={() => setLogOpen(false)}
          onOpen={(id) => {
            setLogOpen(false);
            open(id);
          }}
        />
      )}
      {settingsOpen && s && <WaSettingsModal settings={s.settings} onClose={() => setSettingsOpen(false)} onSaved={bump} />}
      {agentOpen && s && <WaAgentModal summary={s} onClose={() => setAgentOpen(false)} onSaved={bump} />}
    </div>
  );
}
