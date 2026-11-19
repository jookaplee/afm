import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCheck, MessageCircle, Pencil, Plus, Send, Settings2, Undo2 } from 'lucide-react';
import { REGIONS, SEGMENTS, type Region, type Segment } from '../../../shared/constants.ts';
import type { Paged, WaContact, WaMessageRow, WaSummary, WaTemplate } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { useDebounced } from '../lib/useDebounced.ts';
import { Card, ErrorState, LeadStatusBadge, Loading, PageHeader, Pager, SearchInput, SelectFilter, Tabs } from '../components/ui.tsx';
import { StatTile } from '../components/charts.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { PhoneBadges, WaComposer, WaStatusBadge } from '../whatsapp/WaComposer.tsx';
import { WaCampaign } from '../whatsapp/WaCampaign.tsx';
import { WaSettingsModal, WaTemplateModal } from '../whatsapp/WaForms.tsx';

type Tab = 'contacts' | 'templates' | 'log';
type Stage = 'todo' | 'sent' | 'replied' | 'all';
type PhoneFilter = 'chat' | 'mobile' | 'landline' | 'invalid';
const PAGE_SIZE = 25;

export default function WhatsAppPage() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('contacts');
  const [stage, setStage] = useState<Stage>('todo');
  const [type, setType] = useState<PhoneFilter | undefined>('mobile');
  const [region, setRegion] = useState<Region | undefined>();
  const [segment, setSegment] = useState<Segment | undefined>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [composing, setComposing] = useState<WaContact | null>(null);
  const [campaign, setCampaign] = useState(false);
  const [editing, setEditing] = useState<WaTemplate | 'new' | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const q = useDebounced(search);
  const bump = () => setVersion((v) => v + 1);

  const filters = useMemo(() => ({ stage, type, region, segment, search: q }), [stage, type, region, segment, q]);
  useEffect(() => setPage(1), [filters]);
  const summary = useApi<WaSummary>('/wa/summary', { v: version });
  const contacts = useApi<Paged<WaContact>>('/wa/contacts', { ...filters, page, pageSize: PAGE_SIZE, v: version });
  const templates = useApi<WaTemplate[]>('/wa/templates', { v: version });
  const log = useApi<Paged<WaMessageRow>>(tab === 'log' ? '/wa/messages' : null, { page: logPage, pageSize: PAGE_SIZE, v: version });
  const s = summary.data;
  const needsSender = !!s && (!s.settings.myName || !s.settings.company);

  const replied = async (c: WaContact, on: boolean) => {
    try {
      await api.patch(`/wa/leads/${c.lead_id}`, { replied: on, at: new Date().toISOString() });
      toast(on ? t('wa.markedReplied') : t('common.saved'));
      bump();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const columns: Column<WaContact>[] = [
    {
      key: 'contact',
      header: t('wa.col.contact'),
      render: (c) => (
        <div>
          <div className="cell-main truncate" title={c.company}>
            {c.account_id ? <Link to={`/accounts/${c.account_id}`}>{c.company}</Link> : c.company}
          </div>
          <div className="cell-sub truncate" title={c.name}>
            {c.name} · {t(`segmentShort.${c.segment}`)} · {t(`region.${c.region}`)}
          </div>
        </div>
      ),
      nowrap: true,
    },
    {
      key: 'phone',
      header: t('wa.col.phone'),
      render: (c) => (
        <div className="wa-phone-cell">
          <span className="num">{c.phone}</span>
          <span className="row" style={{ gap: 4 }}>
            <PhoneBadges phone={c.phone} shared={c.shared} />
          </span>
        </div>
      ),
      nowrap: true,
    },
    { key: 'wa', header: t('wa.col.wa'), render: (c) => <WaStatusBadge status={c.wa_status} />, nowrap: true },
    {
      key: 'last',
      header: t('wa.col.last'),
      render: (c) =>
        c.last_sent_at ? (
          <div>
            <div>{fmt.stamp(c.last_sent_at)}</div>
            <div className="cell-sub">
              {c.last_template ?? '—'} · {t('wa.sentTimes', { n: c.sent_count })}
            </div>
          </div>
        ) : (
          <span className="muted">—</span>
        ),
      nowrap: true,
    },
    {
      key: 'status',
      header: t('wa.col.status'),
      render: (c) => (
        <span className="row" style={{ gap: 4 }}>
          <LeadStatusBadge status={c.status} />
          {c.wa_replied_at && (
            <span className="badge good">
              <CheckCheck aria-hidden />
              {t('wa.repliedBadge')}
            </span>
          )}
        </span>
      ),
      nowrap: true,
      wide: true,
    },
    {
      key: 'actions',
      header: '',
      render: (c) => (
        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
          {c.sent_count > 0 && (
            <button
              className="btn sm ghost icon"
              onClick={() => void replied(c, !c.wa_replied_at)}
              title={c.wa_replied_at ? t('wa.unmarkReplied') : t('wa.markReplied')}
              aria-label={`${c.wa_replied_at ? t('wa.unmarkReplied') : t('wa.markReplied')}: ${c.company}`}
            >
              {c.wa_replied_at ? <Undo2 aria-hidden /> : <CheckCheck aria-hidden />}
            </button>
          )}
          <button className="btn sm wa-send" onClick={() => setComposing(c)} disabled={!c.intl} aria-label={`${t('wa.send')}: ${c.company}`}>
            <MessageCircle aria-hidden />
            {t('wa.send')}
          </button>
        </div>
      ),
      nowrap: true,
    },
  ];

  const logCols: Column<WaMessageRow>[] = [
    { key: 'time', header: t('wa.col.time'), render: (m) => fmt.stamp(m.created_at), nowrap: true },
    {
      key: 'lead',
      header: t('wa.col.contact'),
      render: (m) => (
        <div>
          <div className="cell-main">{m.account_id ? <Link to={`/accounts/${m.account_id}`}>{m.company ?? '—'}</Link> : (m.company ?? '—')}</div>
          <div className="cell-sub">
            {m.lead_name} · {m.phone}
          </div>
        </div>
      ),
      nowrap: true,
    },
    { key: 'template', header: t('wa.col.template'), render: (m) => m.template_name ?? '—', nowrap: true },
    { key: 'body', header: t('wa.col.message'), render: (m) => <span className="wa-preview">{m.body}</span> },
  ];

  const replyRate = s && s.contacted ? s.replied / s.contacted : null;

  return (
    <div className="page">
      <PageHeader
        title={t('wa.title')}
        subtitle={t('wa.subtitle')}
        actions={
          <>
            <button className="btn" onClick={() => setSettingsOpen(true)} disabled={!s}>
              <Settings2 aria-hidden />
              {t('wa.settings')}
            </button>
            <button className="btn primary" onClick={() => setCampaign(true)} disabled={!templates.data || !s}>
              <Send aria-hidden />
              {t('wa.campaign')}
            </button>
          </>
        }
      />
      <div className="stack">
        {needsSender && (
          <section className="card wa-setup">
            <div>
              <h2>{t('wa.setupTitle')}</h2>
              <p className="muted">{t('wa.setupBody')}</p>
            </div>
            <button className="btn primary" onClick={() => setSettingsOpen(true)}>
              <Pencil aria-hidden />
              {t('wa.settings')}
            </button>
          </section>
        )}
        {s ? (
          <div className="grid kpis">
            <StatTile
              label={t('wa.kpi.chat')}
              value={fmt.num(s.mobile)}
              sub={t('wa.kpi.chatSub', { landline: fmt.num(s.landline), invalid: fmt.num(s.invalid), shared: fmt.num(s.shared) })}
            />
            <StatTile label={t('wa.kpi.todo')} value={fmt.num(s.todo)} sub={t('wa.kpi.todoSub')} />
            <StatTile label={t('wa.kpi.sent')} value={fmt.num(s.messages)} sub={t('wa.kpi.sentSub', { n: fmt.num(s.messagesToday), leads: fmt.num(s.contacted) })} />
            <StatTile label={t('wa.kpi.replied')} value={fmt.num(s.replied)} sub={t('wa.kpi.repliedSub', { pct: fmt.pct0(replyRate) })} />
          </div>
        ) : summary.error ? (
          <ErrorState onRetry={summary.reload} />
        ) : (
          <Loading />
        )}

        <section className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'contacts', label: t('wa.tab.contacts') },
              { key: 'templates', label: t('wa.tab.templates'), count: templates.data?.length },
              { key: 'log', label: t('wa.tab.log'), count: s?.messages },
            ]}
          />

          {tab === 'contacts' && (
            <>
              <div className="table-toolbar">
                <div className="tabs wrap" role="group" aria-label={t('wa.col.status')}>
                  {(['todo', 'sent', 'replied', 'all'] as Stage[]).map((k) => (
                    <button key={k} className="tab" aria-pressed={stage === k} onClick={() => setStage(k)}>
                      {t(`wa.stage.${k}`)}
                    </button>
                  ))}
                </div>
                <SearchInput value={search} onChange={setSearch} />
                <SelectFilter
                  label={t('wa.col.phone')}
                  value={type}
                  onChange={setType}
                  options={['chat', 'mobile', 'landline', 'invalid'] as PhoneFilter[]}
                  allLabel={t('wa.type.all')}
                  render={(v) => t(`wa.type.${v}`)}
                />
                <SelectFilter label={t('col.region')} value={region} onChange={setRegion} options={REGIONS} allLabel={t('filter.allRegions')} render={(v) => t(`region.${v}`)} />
                <SelectFilter label={t('col.segment')} value={segment} onChange={setSegment} options={SEGMENTS} allLabel={t('filter.allSegments')} render={(v) => t(`segment.${v}`)} />
              </div>
              {contacts.data ? (
                <div className={contacts.loading ? 'refetching' : ''}>
                  <DataTable columns={columns} rows={contacts.data.rows} rowKey={(c) => c.lead_id} empty={t('wa.noContacts')} />
                  <Pager page={page} pageSize={PAGE_SIZE} total={contacts.data.total} onPage={setPage} />
                </div>
              ) : contacts.error ? (
                <ErrorState onRetry={contacts.reload} />
              ) : (
                <Loading />
              )}
            </>
          )}

          {tab === 'templates' && (
            <div className="wa-templates">
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setEditing('new')}>
                  <Plus aria-hidden />
                  {t('wa.newTemplate')}
                </button>
              </div>
              {templates.data ? (
                templates.data.map((tpl) => (
                  <article key={tpl.id} className="wa-template">
                    <header className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <strong>{tpl.name}</strong>
                      <button className="btn sm ghost" onClick={() => setEditing(tpl)}>
                        <Pencil aria-hidden />
                        {t('common.edit')}
                      </button>
                    </header>
                    <p className="wa-preview">{tpl.body}</p>
                  </article>
                ))
              ) : (
                <Loading />
              )}
            </div>
          )}

          {tab === 'log' &&
            (log.data ? (
              <div className={log.loading ? 'refetching' : ''}>
                <DataTable columns={logCols} rows={log.data.rows} rowKey={(m) => m.id} empty={t('wa.noMessages')} />
                <Pager page={logPage} pageSize={PAGE_SIZE} total={log.data.total} onPage={setLogPage} />
              </div>
            ) : log.error ? (
              <ErrorState onRetry={log.reload} />
            ) : (
              <Loading />
            ))}
        </section>
        <Card>
          <p className="muted small" style={{ margin: 0 }}>
            {t('wa.howItWorks')} {t('wa.campaignPace')}
          </p>
        </Card>
      </div>

      {composing && <WaComposer target={composing} onClose={() => setComposing(null)} onSent={bump} />}
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
      {editing && <WaTemplateModal template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={bump} />}
      {settingsOpen && s && <WaSettingsModal settings={s.settings} onClose={() => setSettingsOpen(false)} onSaved={bump} />}
    </div>
  );
}
