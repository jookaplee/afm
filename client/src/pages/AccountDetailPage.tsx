import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, Loader2, Mail, Pencil, Phone, Plus, Presentation, Sparkles, Users } from 'lucide-react';
import type { ActivityType } from '../../../shared/constants.ts';
import type { AccountDetail, AccountRow, AgentFindingRow, DealRow, LeadRow, Paged } from '../../../shared/types.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { Card, ErrorState, LeadStatusBadge, Loading, PageHeader, StageBadge } from '../components/ui.tsx';
import { StatTile } from '../components/charts.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { AccountFormModal, DealFormModal } from '../components/forms.tsx';
import { ContactLinks } from '../components/ContactLinks.tsx';
import { socialLinks } from '../lib/contact.ts';
import { agentEngine, useAgent, type AgentState } from '../agent/engine.ts';

const VERIFY_BADGE: Record<string, string> = { ok: 'good', changed: 'warn', closed: 'bad', not_found: 'bad' };

/** What the AI agent last found for this account, with a button to check it again now. */
function VerifyCard({ a, pending, agent }: { a: AccountRow; pending: number; agent: AgentState }) {
  const { t, fmt } = useI18n();
  const canRun = (agent.runner === 'browser' && agent.hasKey) || agent.runner === 'server';
  const status = a.verify_status ?? 'never';
  return (
    <section className="card verify-card" aria-label={t('account.verify.title')}>
      <div className="verify-main">
        <div className="kpi-label">{t('account.verify.title')}</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className={`badge ${VERIFY_BADGE[status] ?? ''}`}>{t(`account.verify.${status}`)}</span>
          {a.verified_at && <span className="muted small">{t('account.verify.at', { time: fmt.stamp(a.verified_at) })}</span>}
          {pending > 0 && (
            <Link to="/agent" className="small">
              {t('account.verify.pending', { n: pending })}
            </Link>
          )}
        </div>
        {a.agent_note && <p>{a.agent_note}</p>}
      </div>
      {canRun && (
        <button className="btn sm" onClick={() => void agentEngine.run({ accountId: a.id, discover: false })} disabled={agent.running}>
          {agent.running ? <Loader2 className="spin" aria-hidden /> : <Sparkles aria-hidden />}
          {t('account.verify.checkNow')}
        </button>
      )}
    </section>
  );
}

const SOCIAL_LABEL: Record<string, string> = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', threads: 'Threads', youtube: 'YouTube' };
const safeHref = (u: string | null) => (u && /^https?:\/\//i.test(u) ? u : null);

const ACTIVITY_ICON: Record<ActivityType, typeof Phone> = { call: Phone, email: Mail, meeting: Users, demo: Presentation };

export default function AccountDetailPage() {
  const { id } = useParams();
  const { t, fmt } = useI18n();
  const navigate = useNavigate();
  const agent = useAgent();
  const { data, error, loading, reload } = useApi<AccountDetail>(`/accounts/${id}`, { v: agent.version });
  const pendingFindings = useApi<Paged<AgentFindingRow>>('/agent/findings', { status: 'pending', accountId: id, pageSize: 1, v: agent.version });
  const [editing, setEditing] = useState(false);
  const [deal, setDeal] = useState<DealRow | 'new' | null>(null);

  const back = (
    <Link to="/accounts" className="btn ghost sm" style={{ alignSelf: 'flex-start' }}>
      <ArrowLeft aria-hidden />
      {t('common.back')}
    </Link>
  );
  if (!data) {
    return (
      <div className="page">
        {back}
        {error ? <ErrorState onRetry={reload} /> : <Loading />}
      </div>
    );
  }
  const { account: a } = data;

  const dealCols: Column<DealRow>[] = [
    { key: 'name', header: t('col.deal'), render: (d) => <span className="cell-main">{d.name}</span> },
    { key: 'stage', header: t('col.stage'), render: (d) => <StageBadge stage={d.stage} /> },
    { key: 'amount', header: t('col.amount'), align: 'right', render: (d) => fmt.money(d.amount), nowrap: true },
    { key: 'owner', header: t('col.owner'), render: (d) => d.owner_name, nowrap: true },
    { key: 'source', header: t('col.source'), render: (d) => t(`source.${d.source}`), nowrap: true },
    { key: 'close', header: t('col.closed'), align: 'right', render: (d) => fmt.date(d.closed_at ?? d.expected_close), nowrap: true },
  ];
  const leadCols: Column<LeadRow>[] = [
    {
      key: 'name',
      header: t('col.name'),
      render: (l) => (
        <div>
          <div className="cell-main">{l.name}</div>
          <div className="cell-sub">{l.title}</div>
        </div>
      ),
    },
    { key: 'channel', header: t('col.channel'), render: (l) => t(`channel.${l.channel}`), nowrap: true },
    { key: 'status', header: t('col.status'), render: (l) => <LeadStatusBadge status={l.status} /> },
    { key: 'created', header: t('col.created'), align: 'right', render: (l) => fmt.date(l.created_at), nowrap: true },
  ];

  return (
    <div className="page">
      {back}
      <PageHeader
        title={a.name}
        subtitle={`${t(`industry.${a.industry}`)} · ${t(`segment.${a.segment}`)} · ${t(`region.${a.region}`)}`}
        actions={
          <>
            <button className="btn" onClick={() => setEditing(true)}>
              <Pencil aria-hidden />
              {t('common.edit')}
            </button>
            <button className="btn primary" onClick={() => setDeal('new')}>
              <Plus aria-hidden />
              {t('account.addDeal')}
            </button>
          </>
        }
      />
      <div className={`stack ${loading ? 'refetching' : ''}`}>
        <div className="grid kpis">
          <StatTile label={t('kpi.lifetimeRevenue')} value={fmt.moneyCompact(a.won_revenue)} sub={`${fmt.num(a.won_deals)} ${t('tab.won').toLowerCase()}`} />
          <StatTile label={t('kpi.openPipeline')} value={fmt.moneyCompact(a.open_pipeline)} sub={`${fmt.num(a.open_deals)} ${t('tab.open').toLowerCase()}`} />
          <StatTile label={t('col.leads')} value={fmt.num(a.leads)} />
          <StatTile label={t('col.lastActivity')} value={fmt.date(a.last_activity)} />
        </div>
        <VerifyCard a={a} pending={pendingFindings.data?.total ?? 0} agent={agent} />
        <div className="grid cols-3-1">
          <Card title={t('account.deals')} flush>
            <DataTable columns={dealCols} rows={data.deals} rowKey={(d) => d.id} onRowClick={(d) => setDeal(d)} />
          </Card>
          <Card title={t('account.profile')}>
            <dl className="dl">
              {a.legal_name && (
                <>
                  <dt>{t('account.legalName')}</dt>
                  <dd>{a.legal_name}</dd>
                </>
              )}
              <dt>{t('account.contact')}</dt>
              <dd>{a.contact_name ?? '—'}</dd>
              <dt>{t('col.phone')}</dt>
              <dd>
                <ContactLinks phone={a.phone} />
              </dd>
              {a.email && (
                <>
                  <dt>{t('field.email')}</dt>
                  <dd>
                    <a href={`mailto:${a.email}`}>{a.email}</a>
                  </dd>
                </>
              )}
              {a.address && (
                <>
                  <dt>{t('account.address')}</dt>
                  <dd>{a.address}</dd>
                </>
              )}
              <dt>{t('col.industry')}</dt>
              <dd>{t(`industry.${a.industry}`)}</dd>
              <dt>{t('col.segment')}</dt>
              <dd>{t(`segment.${a.segment}`)}</dd>
              {a.sales_estimate != null && (
                <>
                  <dt>{t('account.salesEstimate')}</dt>
                  <dd className="num">{fmt.money(a.sales_estimate)}</dd>
                </>
              )}
              {a.rating != null && (
                <>
                  <dt>{t('account.rating')}</dt>
                  <dd className="num">★ {fmt.dec(a.rating)} / 5</dd>
                </>
              )}
              <dt>{t('col.region')}</dt>
              <dd>{t(`region.${a.region}`)}</dd>
              {a.area && (
                <>
                  <dt>{t('account.area')}</dt>
                  <dd>{a.area}</dd>
                </>
              )}
              <dt>{t('col.tier')}</dt>
              <dd>{t(`tier.${a.tier}`)}</dd>
              <dt>{t('col.owner')}</dt>
              <dd>{a.owner_name ?? '—'}</dd>
              <dt>{t('field.website')}</dt>
              <dd>
                {safeHref(a.website) ? (
                  <a href={safeHref(a.website)!} target="_blank" rel="noopener noreferrer">
                    {a.website!.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
              {socialLinks(a.socials).length > 0 && (
                <>
                  <dt>{t('account.socials')}</dt>
                  <dd>
                    <span className="link-list">
                      {socialLinks(a.socials).map((l) => (
                        <a key={l.key} className="chip" href={l.url} target="_blank" rel="noopener noreferrer">
                          {SOCIAL_LABEL[l.key] ?? l.key}
                        </a>
                      ))}
                    </span>
                  </dd>
                </>
              )}
              {a.source && (
                <>
                  <dt>{t('account.source')}</dt>
                  <dd className="muted">{a.source}</dd>
                </>
              )}
              <dt>{t('account.since')}</dt>
              <dd>{fmt.date(a.created_at)}</dd>
            </dl>
          </Card>
        </div>
        <div className="grid cols-2">
          <Card title={t('account.leads')} flush>
            <DataTable columns={leadCols} rows={data.leads} rowKey={(l) => l.id} />
          </Card>
          <Card title={t('account.activity')}>
            {data.activities.length === 0 ? (
              <div className="empty">{t('account.noActivity')}</div>
            ) : (
              <ul className="timeline">
                {data.activities.slice(0, 15).map((act) => {
                  const Icon = ACTIVITY_ICON[act.type] ?? Calendar;
                  return (
                    <li key={act.id}>
                      <span className="ico" title={t(`activity.${act.type}`)}>
                        <Icon aria-hidden />
                      </span>
                      <div>
                        <div>{act.subject}</div>
                        <div className="cell-sub">
                          {t(`activity.${act.type}`)} · {act.rep_name}
                        </div>
                      </div>
                      <span className="muted num" style={{ fontSize: 12.5 }}>
                        {fmt.date(act.date)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
      {editing && (
        <AccountFormModal
          account={a}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onDeleted={() => navigate('/accounts')}
        />
      )}
      {deal && (
        <DealFormModal
          deal={deal === 'new' ? null : deal}
          preset={{ account_id: a.id, account_name: a.name }}
          onClose={() => setDeal(null)}
          onSaved={() => {
            setDeal(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
