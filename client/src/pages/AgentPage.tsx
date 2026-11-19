import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Check, CircleSlash, ExternalLink, KeyRound, Loader2, Play, Settings2, Sparkles, Square, Store, X } from 'lucide-react';
import type { AgentFindingRow, AgentRunRow, Paged } from '../../../shared/types.ts';
import { AGENT_MODELS } from '../../../shared/agent.ts';
import { api } from '../lib/api.ts';
import { useApi } from '../lib/useApi.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useToast } from '../lib/app-context.tsx';
import { errorMessage } from '../lib/errors.ts';
import { Card, ErrorState, Loading, PageHeader, Pager, Tabs } from '../components/ui.tsx';
import { StatTile } from '../components/charts.tsx';
import { DataTable, type Column } from '../components/DataTable.tsx';
import { ContactLinks } from '../components/ContactLinks.tsx';
import { agentEngine, useAgent, type AgentState } from '../agent/engine.ts';
import { AgentSettingsModal } from '../agent/AgentSettingsModal.tsx';

type Tab = 'pending' | 'decided';
type Kind = 'all' | 'update' | 'new_lead' | 'closed';
const PAGE_SIZE = 20;

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return u;
  }
};

function Sources({ urls }: { urls: string[] }) {
  const { t } = useI18n();
  if (!urls.length) return null;
  return (
    <div className="finding-sources">
      <span className="muted">{t('agent.sources')}:</span>
      {urls.map((u) => (
        <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="chip">
          <ExternalLink aria-hidden />
          {host(u)}
        </a>
      ))}
    </div>
  );
}

/** A value as it should read: links stay links, phones get WhatsApp/call shortcuts. */
function Value({ field, value }: { field: string | null; value: string | null }) {
  const { t } = useI18n();
  if (!value) return <span className="muted">{t('agent.emptyValue')}</span>;
  if (field === 'phone') return <ContactLinks phone={value} />;
  if (/^https?:\/\//.test(value))
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {host(value)}
        {new URL(value).pathname.length > 1 ? new URL(value).pathname.replace(/\/$/, '') : ''}
      </a>
    );
  return <span>{value}</span>;
}

/** A plain progress bar (no good/bad colouring: usage and coverage are not targets). */
function Bar({ ratio, label }: { ratio: number; label: string }) {
  const pct = Math.max(0, Math.min(100, ratio * 100));
  return (
    <div className="usage-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatusLine({ agent }: { agent: AgentState }) {
  const { t, fmt } = useI18n();
  const s = agent.summary;
  if (agent.running) {
    const p = agent.progress;
    const label =
      agent.runner === 'server'
        ? t('agent.status.serverRunning')
        : !p || p.step === 'plan'
          ? t('agent.status.plan')
          : p.step === 'verify'
            ? t('agent.status.verify', { name: p.label ?? '' })
            : p.step === 'discover'
              ? t('agent.status.discover', { what: p.label ?? '' })
              : t('agent.status.save');
    return (
      <span className="agent-status running" role="status">
        <Loader2 className="spin" aria-hidden />
        {label}
        {p && p.total > 0 && <span className="muted"> · {p.done}/{p.total}</span>}
      </span>
    );
  }
  const reason = agent.blocked ? t(`agent.error.${agent.blocked}`) : null;
  const text =
    agent.runner === 'none'
      ? t('agent.status.none')
      : agent.runner === 'server'
        ? t('agent.status.server', { n: s?.settings.intervalMin ?? 0 })
        : !agent.hasKey
          ? t('agent.status.needKey')
          : reason
            ? t('agent.status.blocked', { reason })
            : agent.nextAt
              ? t('agent.status.next', { time: fmt.clock(agent.nextAt) })
              : s && !s.settings.autopilot
                ? t('agent.status.autopilotOff')
                : t('agent.status.ready');
  return (
    <span className={`agent-status ${reason ? 'bad' : ''}`} role="status">
      {reason ? <AlertTriangle aria-hidden /> : <Bot aria-hidden />}
      {text}
    </span>
  );
}

function LastCycle({ agent }: { agent: AgentState }) {
  const { t, fmt } = useI18n();
  const last = agent.last;
  if (!last) return null;
  const time = fmt.clock(last.at);
  const s = last.outcome?.summary;
  if (s) {
    return (
      <p className="muted agent-last">
        {t('agent.last', { time, checked: s.checked, findings: s.findings, auto: s.auto, leads: s.new_leads })}
        {last.error && !last.outcome?.fatal ? ` ${last.error}` : ''}
      </p>
    );
  }
  if (last.error) {
    const known = ['auth', 'permission', 'rate_limit', 'billing'].includes(last.error);
    return <p className="agent-last bad-text">{t('agent.lastError', { time, msg: known ? t(`agent.error.${last.error}`) : last.error })}</p>;
  }
  return <p className="muted agent-last">{t('agent.lastNothing', { time })}</p>;
}

function KeySetup() {
  const { t } = useI18n();
  const [key, setKey] = useState('');
  return (
    <Card title={t('agent.setup.title')}>
      <form
        className="agent-setup"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key.trim()) return;
          agentEngine.setApiKey(key);
          void agentEngine.run();
        }}
      >
        <p>{t('agent.setup.body')}</p>
        <label htmlFor="agent-key" className="sr-only">
          {t('agent.setup.key')}
        </label>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            id="agent-key"
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            style={{ flex: '1 1 260px' }}
          />
          <button className="btn primary" type="submit" disabled={!key.trim()}>
            <KeyRound aria-hidden />
            {t('agent.setup.save')}
          </button>
        </div>
        <p className="muted small">{t('agent.setup.privacy')}</p>
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
          {t('agent.setup.getKey')}
        </a>
      </form>
    </Card>
  );
}

function FindingCard({ f, onDecide }: { f: AgentFindingRow; onDecide: (f: AgentFindingRow, status: 'accepted' | 'rejected') => void }) {
  const { t, fmt } = useI18n();
  const pending = f.status === 'pending';
  const conf = <span className={`badge conf-${f.confidence}`}>{t(`agent.conf.${f.confidence}`)}</span>;
  const status = !pending && (
    <span className={`badge ${f.status === 'rejected' ? '' : 'good'}`}>
      {t(`agent.st.${f.status}`)} · {fmt.stamp(f.decided_at)}
    </span>
  );
  let icon = <Sparkles aria-hidden />;
  let title: ReactNode = f.account_id ? <Link to={`/accounts/${f.account_id}`}>{f.account_name}</Link> : f.account_name;
  let body: ReactNode = null;
  if (f.kind === 'update') {
    body = (
      <dl className="finding-diff">
        <dt>{t(`agent.field.${f.field}`)}</dt>
        <dd>
          <div>
            <span className="diff-label">{t('agent.current')}</span>
            <Value field={f.field} value={f.old_value} />
          </div>
          <div className="diff-new">
            <span className="diff-label">{t('agent.found')}</span>
            <Value field={f.field} value={f.new_value} />
          </div>
        </dd>
      </dl>
    );
  } else if (f.kind === 'closed') {
    icon = <CircleSlash aria-hidden />;
    body = (
      <div className="finding-body">
        <strong>{t('agent.closedTitle')}</strong>
        {f.note && <p>{f.note}</p>}
        {pending && <p className="muted small">{t('agent.closedHelp')}</p>}
      </div>
    );
  } else if (f.kind === 'new_lead' && f.payload) {
    const c = f.payload;
    icon = <Store aria-hidden />;
    title = f.account_id ? <Link to={`/accounts/${f.account_id}`}>{c.name}</Link> : c.name;
    body = (
      <div className="finding-body">
        <p className="muted">
          {t('agent.newLeadTitle')} · {t(`industry.${c.category}`)}
          {c.area || c.state ? ` · ${[c.area, c.state].filter(Boolean).join(', ')}` : ''}
          {c.rating ? ` · ★ ${fmt.dec(c.rating)}` : ''}
        </p>
        <dl className="dl compact">
          {c.contact_name && (
            <>
              <dt>{t('agent.field.contact_name')}</dt>
              <dd>{c.contact_name}</dd>
            </>
          )}
          {c.phone && (
            <>
              <dt>{t('agent.field.phone')}</dt>
              <dd>
                <ContactLinks phone={c.phone} />
              </dd>
            </>
          )}
          {c.address && (
            <>
              <dt>{t('agent.field.address')}</dt>
              <dd>{c.address}</dd>
            </>
          )}
          {(['website', 'facebook', 'instagram', 'tiktok'] as const).map(
            (k) =>
              c[k] && (
                <span key={k} style={{ display: 'contents' }}>
                  <dt>{t(`agent.field.${k}`)}</dt>
                  <dd>
                    <Value field={k} value={c[k]} />
                  </dd>
                </span>
              ),
          )}
        </dl>
        {f.note && <p>{f.note}</p>}
      </div>
    );
  }
  return (
    <article className={`finding finding-${f.kind}`}>
      <header className="finding-head">
        <span className="finding-icon">{icon}</span>
        <div className="finding-title">{title}</div>
        {conf}
        {status}
      </header>
      {body}
      <Sources urls={f.sources} />
      {pending && (
        <div className="finding-actions">
          <button className="btn sm" onClick={() => onDecide(f, 'rejected')}>
            <X aria-hidden />
            {t('agent.reject')}
          </button>
          <button className="btn sm primary" onClick={() => onDecide(f, 'accepted')}>
            <Check aria-hidden />
            {f.kind === 'new_lead' ? t('agent.addLead') : t('agent.accept')}
          </button>
        </div>
      )}
    </article>
  );
}

export default function AgentPage() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const agent = useAgent();
  const [tab, setTab] = useState<Tab>('pending');
  const [kind, setKind] = useState<Kind>('all');
  const [page, setPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => setPage(1), [tab, kind]);
  useEffect(() => agentEngine.boot(), []);

  const findings = useApi<Paged<AgentFindingRow>>('/agent/findings', {
    status: tab,
    kind: kind === 'all' ? undefined : kind,
    page,
    pageSize: PAGE_SIZE,
    v: agent.version,
  });
  const runs = useApi<AgentRunRow[]>('/agent/runs', { limit: 15, v: agent.version });
  const s = agent.summary;

  const decide = async (rows: AgentFindingRow[], status: 'accepted' | 'rejected') => {
    try {
      await api.post('/agent/findings/decide', { ids: rows.map((r) => r.id), status, at: new Date().toISOString() });
      const lead = rows.length === 1 && rows[0].kind === 'new_lead' && status === 'accepted' ? rows[0].payload?.name : null;
      toast(lead ? t('agent.toast.leadAdded', { name: lead }) : status === 'accepted' ? t('agent.toast.accepted', { n: rows.length }) : t('agent.toast.rejected'));
      agentEngine.touched();
    } catch (e) {
      toast(errorMessage(e, t), 'bad');
    }
  };

  const model = AGENT_MODELS.find((m) => m.id === s?.settings.model);
  const cost = s && model ? (s.today.inputTokens * model.price[0] + s.today.outputTokens * model.price[1]) / 1e6 : 0;
  const high = (findings.data?.rows ?? []).filter((f) => f.status === 'pending' && f.kind === 'update' && f.confidence === 'high');
  const canRun = (agent.runner === 'browser' && agent.hasKey) || agent.runner === 'server';

  const runCols: Column<AgentRunRow>[] = [
    { key: 'time', header: t('agent.col.time'), render: (r) => fmt.stamp(r.started_at), nowrap: true },
    { key: 'kind', header: t('agent.col.kind'), render: (r) => t(`agent.kind.${r.kind}`), nowrap: true },
    { key: 'checked', header: t('agent.col.checked'), align: 'right', render: (r) => fmt.num(r.checked) },
    { key: 'found', header: t('agent.col.found'), align: 'right', render: (r) => fmt.num(r.found) },
    { key: 'searches', header: t('agent.col.searches'), align: 'right', render: (r) => fmt.num(r.searches) },
    { key: 'tokens', header: t('agent.col.tokens'), align: 'right', render: (r) => fmt.compact(r.input_tokens + r.output_tokens), nowrap: true },
    { key: 'note', header: t('agent.col.note'), render: (r) => (r.error ? <span className="bad-text small">{r.error}</span> : <span className="muted">{r.model}</span>) },
  ];

  return (
    <div className="page">
      <PageHeader
        title={t('agent.title')}
        subtitle={t('agent.subtitle')}
        actions={
          <>
            <button className="btn" onClick={() => setSettingsOpen(true)} disabled={!s}>
              <Settings2 aria-hidden />
              {t('agent.settings')}
            </button>
            {agent.running && agent.runner === 'browser' ? (
              <button className="btn" onClick={() => agentEngine.stop()}>
                <Square aria-hidden />
                {t('agent.stop')}
              </button>
            ) : (
              <button className="btn primary" onClick={() => void agentEngine.run()} disabled={!canRun || agent.running}>
                <Play aria-hidden />
                {t('agent.runNow')}
              </button>
            )}
          </>
        }
      />
      <div className="stack">
        <section className="card agent-hero">
          <div className="agent-hero-main">
            <StatusLine agent={agent} />
            <LastCycle agent={agent} />
            {agent.blocked && (
              <button className="btn sm" onClick={() => agentEngine.unblock()}>
                {t('agent.unblock')}
              </button>
            )}
          </div>
          {s && (
            <div className="agent-hero-usage">
              <div className="kpi-label">{t('agent.today')}</div>
              <div className="hero-row">
                <span>{t('agent.calls', { used: fmt.num(s.today.calls), limit: fmt.num(s.today.limit) })}</span>
                <span className="muted">{t('agent.searches', { n: fmt.num(s.today.searches) })}</span>
              </div>
              <Bar ratio={s.today.limit ? s.today.calls / s.today.limit : 0} label={t('agent.calls', { used: s.today.calls, limit: s.today.limit })} />
              <div className="muted small" title={t('agent.costHint')}>
                {t('agent.cost', { v: cost.toFixed(2) })} · {model?.label}
              </div>
            </div>
          )}
        </section>

        {agent.runner === 'browser' && !agent.hasKey && <KeySetup />}
        {agent.runner === 'none' && (
          <Card title={t('agent.none.title')}>
            <p style={{ margin: 0 }}>{t('agent.none.body')}</p>
          </Card>
        )}
        {agent.runner === 'server' && (
          <Card title={t('agent.server.title')}>
            <p style={{ margin: 0 }}>{t('agent.server.body')}</p>
          </Card>
        )}

        {s && (
          <div className="grid kpis">
            <div className="card kpi">
              <div className="kpi-label">{t('agent.kpi.verified')}</div>
              <div className="kpi-value">
                {fmt.num(s.accounts.verified)}
                <span className="kpi-of"> / {fmt.num(s.accounts.total)}</span>
              </div>
              <Bar ratio={s.accounts.total ? s.accounts.verified / s.accounts.total : 0} label={t('agent.kpi.verified')} />
              <div className="kpi-foot">
                <span className="delta flat">{t('agent.kpi.verifiedSub', { due: fmt.num(s.accounts.due) })}</span>
              </div>
            </div>
            <StatTile label={t('agent.kpi.pending')} value={fmt.num(s.findings.pending)} sub={t('agent.kpi.pendingSub', { n: fmt.num(s.findings.updates) })} />
            <StatTile label={t('agent.kpi.newLeads')} value={fmt.num(s.findings.newLeads)} sub={t('agent.kpi.newLeadsSub', { n: fmt.num(s.accounts.fromAgent) })} />
            <StatTile label={t('agent.kpi.closed')} value={fmt.num(s.findings.closed)} sub={t('agent.kpi.closedSub', { n: fmt.num(s.accounts.closed) })} />
          </div>
        )}

        <section className="card">
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { key: 'pending', label: t('agent.tab.pending'), count: s?.findings.pending },
              { key: 'decided', label: t('agent.tab.decided') },
            ]}
          />
          <div className="table-toolbar">
            <div className="tabs wrap" role="group" aria-label={t('agent.col.kind')}>
              {(['all', 'update', 'new_lead', 'closed'] as Kind[]).map((k) => (
                <button key={k} className="tab" aria-pressed={kind === k} onClick={() => setKind(k)}>
                  {t(`agent.filter.${k}`)}
                </button>
              ))}
            </div>
            {tab === 'pending' && high.length > 1 && (
              <button className="btn sm" onClick={() => void decide(high, 'accepted')}>
                <Check aria-hidden />
                {t('agent.acceptHigh')} ({high.length})
              </button>
            )}
          </div>
          {findings.error && !findings.data ? (
            <ErrorState onRetry={findings.reload} />
          ) : !findings.data ? (
            <Loading />
          ) : findings.data.rows.length === 0 ? (
            <div className="empty">{tab === 'pending' ? t('agent.noFindings') : t('agent.noDecided')}</div>
          ) : (
            <div className={`finding-list ${findings.loading ? 'refetching' : ''}`}>
              {findings.data.rows.map((f) => (
                <FindingCard key={f.id} f={f} onDecide={(row, st) => void decide([row], st)} />
              ))}
            </div>
          )}
          {findings.data && findings.data.total > PAGE_SIZE && <Pager page={page} pageSize={PAGE_SIZE} total={findings.data.total} onPage={setPage} />}
        </section>

        <Card title={t('agent.log')} sub={t('agent.logSub')} flush>
          {runs.data ? <DataTable columns={runCols} rows={runs.data} rowKey={(r) => r.id} empty={t('agent.noRuns')} /> : runs.error ? <ErrorState onRetry={runs.reload} /> : <Loading />}
        </Card>
      </div>
      {settingsOpen && s && <AgentSettingsModal settings={s.settings} runner={agent.runner} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
