import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { History, Megaphone, MessageCircle, Search, Settings2, SlidersHorizontal, SquarePen } from 'lucide-react';
import { REGIONS, SEGMENTS, type Region, type Segment } from '../../../shared/constants.ts';
import type { Paged, WaContact, WaSummary, WaTemplate } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useDebounced } from '../lib/useDebounced.ts';
import { ErrorState, Loading } from '../components/ui.tsx';
import { Conversation } from '../whatsapp/Conversation.tsx';
import { WaCampaign } from '../whatsapp/WaCampaign.tsx';
import { WaSettingsModal } from '../whatsapp/WaForms.tsx';
import { LogModal, TemplatesModal } from '../whatsapp/WaManage.tsx';
import { Avatar, Ticks, chatTime } from '../whatsapp/ui.tsx';

type Stage = 'all' | 'todo' | 'sent' | 'replied';
type PhoneFilter = 'mobile' | 'landline' | 'invalid' | 'chat';
const STEP = 40;

function ChatRow({ c, active, onOpen }: { c: WaContact; active: boolean; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  const sent = c.sent_count > 0;
  const lastAt = [c.wa_replied_at, c.last_sent_at].filter(Boolean).sort().pop() ?? null;
  return (
    <button type="button" className="wa-row" aria-current={active ? 'true' : undefined} onClick={onOpen}>
      <Avatar name={c.company} seed={c.lead_id} />
      <span className="wa-row-main">
        <span className="wa-row-top">
          <span className="wa-row-name">{c.company}</span>
          <span className={`wa-row-time ${c.wa_replied_at ? 'hot' : ''}`}>{chatTime(lastAt, fmt, t)}</span>
        </span>
        <span className="wa-row-bottom">
          <span className="wa-row-preview">
            {sent ? (
              <>
                <Ticks read={!!c.wa_replied_at} />
                {c.last_body}
              </>
            ) : (
              <>
                {c.name} · {c.phone}
              </>
            )}
          </span>
          {c.wa_replied_at ? (
            <span className="wa-pill">{t('wa.repliedBadge')}</span>
          ) : c.wa_status === 'no' ? (
            <span className="wa-pill muted">{t('wa.status.no')}</span>
          ) : !sent && c.intl ? (
            <span className="wa-dot" title={t('wa.stage.todo')}>
              <span className="sr-only">{t('wa.stage.todo')}</span>
            </span>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function EmptyPane({ s, onCampaign }: { s: WaSummary | undefined; onCampaign: () => void }) {
  const { t, fmt } = useI18n();
  return (
    <div className="wa-empty">
      <span className="wa-empty-icon" aria-hidden>
        <MessageCircle />
      </span>
      <h2>{t('wa.noChatTitle')}</h2>
      <p>{t('wa.noChatBody')}</p>
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
            {(['all', 'todo', 'sent', 'replied'] as Stage[]).map((k) => (
              <button key={k} type="button" className="wa-chip" aria-pressed={stage === k} onClick={() => setStage(k)}>
                {t(`wa.stage.${k}`)}
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
                    <ChatRow key={c.lead_id} c={c} active={c.lead_id === selectedId} onOpen={() => open(c.lead_id)} />
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
              settings={s.settings}
              templates={templates.data}
              onBack={() => open(null)}
              onChanged={bump}
              onManageTemplates={() => setTemplatesOpen(true)}
            />
          ) : selectedId && !selected.error ? (
            <Loading />
          ) : (
            <EmptyPane s={s} onCampaign={() => setCampaign(true)} />
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
    </div>
  );
}
