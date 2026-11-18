// Analytics engine. Rows are fetched once per request (scoped by segment /
// region / owner in SQL), then every metric is computed in memory over date
// windows. That keeps the headline number, the previous-period comparison and
// the per-bucket trend on exactly the same definition.

import type { Db } from './db.ts';
import * as D from '../shared/dates.ts';
import { HttpError, dateParam, intParam, oneOf, type Query } from './http.ts';
import {
  CHANNELS,
  OPEN_STAGES,
  PRODUCTS,
  REGIONS,
  SEGMENTS,
  SOURCES,
  STAGE_PROBABILITY,
  type Channel,
  type LostReason,
  type OpenStage,
  type Region,
  type Segment,
} from '../shared/constants.ts';
import type {
  Campaign,
  CampaignPerformance,
  ChannelPerformance,
  DealRow,
  FunnelStep,
  Kpi,
  MarketingResponse,
  OverviewResponse,
  PeriodInfo,
  RepPerformance,
  SalesResponse,
  StageAmount,
} from '../shared/types.ts';

export interface Filters {
  from: string;
  to: string;
  segment?: Segment;
  region?: Region;
  owner?: number;
}

export function parseFilters(q: Query, today: string): Filters {
  const from = dateParam(q, 'from') ?? `${today.slice(0, 4)}-01-01`;
  const to = dateParam(q, 'to') ?? today;
  if (from > to) throw new HttpError(400, '"from" must be on or before "to"');
  if (D.diffDays(from, to) > 366 * 5) throw new HttpError(400, 'Date range too large (max 5 years)');
  return {
    from,
    to,
    segment: oneOf(q, 'segment', SEGMENTS),
    region: oneOf(q, 'region', REGIONS),
    owner: intParam(q, 'owner', { min: 1 }),
  };
}

export function periodInfo(f: Filters): PeriodInfo {
  const len = D.diffDays(f.from, f.to) + 1;
  const prevTo = D.addDays(f.from, -1);
  const prevFrom = D.addDays(prevTo, -(len - 1));
  const granularity = len <= 92 ? 'week' : 'month';
  const buckets = granularity === 'week' ? D.weeksBetween(f.from, f.to) : D.monthsBetween(f.from, f.to);
  return { from: f.from, to: f.to, prevFrom, prevTo, granularity, buckets };
}

/** [start, end] of each bucket, clipped to the period. */
function bucketWindows(p: PeriodInfo): [string, string][] {
  return p.buckets.map((b) => {
    const start = p.granularity === 'week' ? b : `${b}-01`;
    const end = p.granularity === 'week' ? D.addDays(b, 6) : D.monthEnd(start);
    return [start < p.from ? p.from : start, end > p.to ? p.to : end];
  });
}

const inWin = (d: string | null, a: string, b: string): d is string => d !== null && d >= a && d <= b;
const sum = <T>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
const ratio = (n: number, d: number) => (d > 0 ? n / d : null);

function kpi(p: PeriodInfo, wins: [string, string][], fn: (a: string, b: string) => number | null): Kpi {
  return { value: fn(p.from, p.to), prev: fn(p.prevFrom, p.prevTo), trend: wins.map(([a, b]) => fn(a, b)) };
}

// ---------- Loaders ----------

interface LeadFact {
  id: number;
  channel: Channel;
  campaign_id: number | null;
  segment: Segment;
  region: Region;
  created_at: string;
  mql_at: string | null;
  sql_at: string | null;
  converted_at: string | null;
  deal_stage: string | null;
}

function scope(f: Filters, alias: string, withOwner: boolean) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.segment) {
    where.push(`${alias}.segment = ?`);
    params.push(f.segment);
  }
  if (f.region) {
    where.push(`${alias}.region = ?`);
    params.push(f.region);
  }
  if (withOwner && f.owner) {
    where.push('d.owner_id = ?');
    params.push(f.owner);
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export const DEAL_ROW_SQL = `
  SELECT d.*, a.name AS account_name, a.segment, a.region, a.industry, r.name AS owner_name
  FROM deals d
  JOIN accounts a ON a.id = d.account_id
  JOIN reps r ON r.id = d.owner_id`;

function loadDeals(db: Db, f: Filters, withOwner = true): DealRow[] {
  const s = scope(f, 'a', withOwner);
  return db.prepare(`${DEAL_ROW_SQL} ${s.sql}`).all(...s.params) as unknown as DealRow[];
}

function loadLeads(db: Db, f: Filters): LeadFact[] {
  const s = scope(f, 'l', false);
  return db
    .prepare(
      `SELECT l.id, l.channel, l.campaign_id, l.segment, l.region, l.created_at, l.mql_at, l.sql_at, l.converted_at,
              d.stage AS deal_stage
       FROM leads l LEFT JOIN deals d ON d.id = l.deal_id ${s.sql}`,
    )
    .all(...s.params) as unknown as LeadFact[];
}

function loadQuotas(db: Db, f: Filters): { rep_id: number; month: string; amount: number }[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.segment) {
    where.push('r.team = ?');
    params.push(f.segment);
  }
  if (f.owner) {
    where.push('q.rep_id = ?');
    params.push(f.owner);
  }
  return db
    .prepare(`SELECT q.rep_id, q.month, q.amount FROM quotas q JOIN reps r ON r.id = q.rep_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`)
    .all(...params) as { rep_id: number; month: string; amount: number }[];
}

/** Quota for [a, b], pro-rating each month by the days that fall inside the window. */
function quotaIn(quotas: { rep_id: number; month: string; amount: number }[], a: string, b: string, repId?: number): number {
  let total = 0;
  for (const q of quotas) {
    if (repId !== undefined && q.rep_id !== repId) continue;
    const ms = `${q.month}-01`;
    const me = D.monthEnd(ms);
    const days = D.overlapDays(ms, me, a, b);
    if (days > 0) total += (q.amount * days) / (D.diffDays(ms, me) + 1);
  }
  return Math.round(total);
}

/**
 * Marketing spend model. A campaign's recorded spend is spread evenly across
 * its elapsed days. When segment/region filters are active, each campaign's
 * spend is allocated by its share of leads in that slice.
 */
function spendModel(db: Db, f: Filters, leads: LeadFact[], today: string) {
  const campaigns = db.prepare('SELECT * FROM campaigns').all() as unknown as Campaign[];
  let share = new Map<number, number>();
  if (f.segment || f.region) {
    const totals = new Map(
      (db.prepare('SELECT campaign_id AS id, COUNT(*) AS n FROM leads WHERE campaign_id IS NOT NULL GROUP BY campaign_id').all() as { id: number; n: number }[]).map(
        (r) => [r.id, r.n],
      ),
    );
    const scoped = new Map<number, number>();
    for (const l of leads) if (l.campaign_id) scoped.set(l.campaign_id, (scoped.get(l.campaign_id) ?? 0) + 1);
    share = new Map(campaigns.map((c) => [c.id, ratio(scoped.get(c.id) ?? 0, totals.get(c.id) ?? 0) ?? 0]));
  }
  const spendOf = (c: Campaign, a: string, b: string): number => {
    if (c.spend <= 0) return 0;
    const effEnd = c.end_date < today ? c.end_date : today;
    if (effEnd < c.start_date) return 0;
    const days = D.diffDays(c.start_date, effEnd) + 1;
    const overlap = D.overlapDays(c.start_date, effEnd, a, b);
    const s = f.segment || f.region ? (share.get(c.id) ?? 0) : 1;
    return (c.spend * overlap * s) / days;
  };
  return {
    campaigns,
    spendOf,
    total: (a: string, b: string, channel?: Channel) =>
      sum(
        campaigns.filter((c) => !channel || c.channel === channel),
        (c) => spendOf(c, a, b),
      ),
  };
}

// ---------- Shared metric builders ----------

function dealMetrics(deals: DealRow[]) {
  const won = (a: string, b: string) => deals.filter((d) => d.stage === 'won' && inWin(d.closed_at, a, b));
  const lost = (a: string, b: string) => deals.filter((d) => d.stage === 'lost' && inWin(d.closed_at, a, b));
  return {
    won,
    lost,
    revenue: (a: string, b: string) => sum(won(a, b), (d) => d.amount),
    winRate: (a: string, b: string) => {
      const w = won(a, b).length;
      return ratio(w, w + lost(a, b).length);
    },
    avgDealSize: (a: string, b: string) => {
      const w = won(a, b);
      return ratio(sum(w, (d) => d.amount), w.length);
    },
    salesCycle: (a: string, b: string) => {
      const w = won(a, b);
      return ratio(
        sum(w, (d) => D.diffDays(d.created_at, d.closed_at!)),
        w.length,
      );
    },
    newPipeline: (a: string, b: string) => sum(deals.filter((d) => inWin(d.created_at, a, b)), (d) => d.amount),
    newCustomers: (a: string, b: string) => won(a, b).filter((d) => d.type === 'new_business').length,
  };
}

function funnelFor(leads: LeadFact[], a: string, b: string): FunnelStep[] {
  const cohort = leads.filter((l) => inWin(l.created_at, a, b));
  return [
    { stage: 'lead', count: cohort.length },
    { stage: 'mql', count: cohort.filter((l) => l.mql_at).length },
    { stage: 'sql', count: cohort.filter((l) => l.sql_at).length },
    { stage: 'opportunity', count: cohort.filter((l) => l.converted_at).length },
    { stage: 'won', count: cohort.filter((l) => l.deal_stage === 'won').length },
  ];
}

function pipelineByStage(deals: DealRow[]): StageAmount[] {
  return OPEN_STAGES.map((stage) => {
    const rows = deals.filter((d) => d.stage === stage);
    return {
      stage,
      amount: sum(rows, (d) => d.amount),
      weighted: Math.round(sum(rows, (d) => d.amount * STAGE_PROBABILITY[stage])),
      count: rows.length,
    };
  });
}

const isOpen = (d: { stage: string }) => (OPEN_STAGES as readonly string[]).includes(d.stage);

// ---------- Overview ----------

export function overview(db: Db, f: Filters, today: string): OverviewResponse {
  const p = periodInfo(f);
  const wins = bucketWindows(p);
  const deals = loadDeals(db, f);
  const leads = loadLeads(db, f);
  const quotas = loadQuotas(db, f);
  const spend = spendModel(db, f, leads, today);
  const m = dealMetrics(deals);
  const targetAvailable = !f.region;

  const mktRevenue = (a: string, b: string) => sum(m.won(a, b).filter((d) => d.source === 'marketing'), (d) => d.amount);

  return {
    period: p,
    targetAvailable,
    kpis: {
      revenue: kpi(p, wins, m.revenue),
      target: targetAvailable ? quotaIn(quotas, p.from, p.to) : null,
      newPipeline: kpi(p, wins, m.newPipeline),
      winRate: kpi(p, wins, m.winRate),
      avgDealSize: kpi(p, wins, m.avgDealSize),
      salesCycle: kpi(p, wins, m.salesCycle),
      leads: kpi(p, wins, (a, b) => leads.filter((l) => inWin(l.created_at, a, b)).length),
      mqlToSql: kpi(p, wins, (a, b) =>
        ratio(
          leads.filter((l) => inWin(l.sql_at, a, b)).length,
          leads.filter((l) => inWin(l.mql_at, a, b)).length,
        ),
      ),
      cac: kpi(p, wins, (a, b) => ratio(spend.total(a, b), m.newCustomers(a, b))),
      marketingRoi: kpi(p, wins, (a, b) => {
        const s = spend.total(a, b);
        return s > 0 ? (mktRevenue(a, b) - s) / s : null;
      }),
    },
    revenueSeries: p.buckets.map((bucket, i) => ({
      bucket,
      revenue: m.revenue(...wins[i]),
      target: targetAvailable ? quotaIn(quotas, ...wins[i]) : null,
    })),
    revenueBySource: p.buckets.map((bucket, i) => {
      const w = m.won(...wins[i]);
      return {
        bucket,
        marketing: sum(w.filter((d) => d.source === 'marketing'), (d) => d.amount),
        sales: sum(w.filter((d) => d.source === 'sales'), (d) => d.amount),
        partner: sum(w.filter((d) => d.source === 'partner'), (d) => d.amount),
      };
    }),
    funnel: funnelFor(leads, p.from, p.to),
    pipelineByStage: pipelineByStage(deals),
    closingSoon: deals
      .filter((d) => isOpen(d) && d.expected_close >= today && d.expected_close <= D.addDays(today, 30))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8),
  };
}

// ---------- Sales ----------

export function sales(db: Db, f: Filters, today: string): SalesResponse {
  const p = periodInfo(f);
  const wins = bucketWindows(p);
  const deals = loadDeals(db, f);
  const quotas = loadQuotas(db, f);
  const m = dealMetrics(deals);
  const targetAvailable = !f.region;
  const open = deals.filter(isOpen);

  // Current-quarter forecast (always the quarter containing today).
  const q = D.quarterOf(today);
  const inQuarter = open.filter((d) => d.expected_close <= q.end);
  const byStage = (s: OpenStage[]) => sum(inQuarter.filter((d) => (s as string[]).includes(d.stage)), (d) => d.amount);
  const wonQ = m.revenue(q.start, today);

  // Rep leaderboard.
  const reps = db
    .prepare(`SELECT id, name, team FROM reps WHERE role = 'AE' ${f.segment ? 'AND team = ?' : ''} ${f.owner ? 'AND id = ?' : ''} ORDER BY name`)
    .all(...([f.segment, f.owner].filter((v) => v !== undefined) as (string | number)[])) as { id: number; name: string; team: Segment }[];
  const s = scope(f, 'ac', true);
  const actWhere = [s.sql ? s.sql.replace(/^WHERE /, '') : '', 'act.date BETWEEN ? AND ?'].filter(Boolean).join(' AND ');
  const activityCounts = new Map(
    (
      db
        .prepare(
          `SELECT act.rep_id, COUNT(*) AS n FROM activities act
           JOIN deals d ON d.id = act.deal_id JOIN accounts ac ON ac.id = d.account_id
           WHERE ${actWhere} GROUP BY act.rep_id`,
        )
        .all(...s.params, p.from, p.to) as { rep_id: number; n: number }[]
    ).map((r) => [r.rep_id, r.n]),
  );
  const repRows: RepPerformance[] = reps.map((r) => {
    const mine = deals.filter((d) => d.owner_id === r.id);
    const rm = dealMetrics(mine);
    const quota = quotaIn(quotas, p.from, p.to, r.id);
    const won = rm.revenue(p.from, p.to);
    return {
      id: r.id,
      name: r.name,
      team: r.team,
      quota,
      won,
      wonCount: rm.won(p.from, p.to).length,
      attainment: targetAvailable ? ratio(won, quota) : null,
      openPipeline: sum(mine.filter(isOpen), (d) => d.amount),
      winRate: rm.winRate(p.from, p.to),
      avgCycle: rm.salesCycle(p.from, p.to),
      activities: activityCounts.get(r.id) ?? 0,
    };
  });

  const closed = deals.filter((d) => (d.stage === 'won' || d.stage === 'lost') && inWin(d.closed_at, p.from, p.to));
  const lost = closed.filter((d) => d.stage === 'lost');
  const wonP = m.won(p.from, p.to);

  return {
    period: p,
    targetAvailable,
    kpis: {
      revenue: kpi(p, wins, m.revenue),
      attainment: kpi(p, wins, (a, b) => (targetAvailable ? ratio(m.revenue(a, b), quotaIn(quotas, a, b)) : null)),
      winRate: kpi(p, wins, m.winRate),
      avgDealSize: kpi(p, wins, m.avgDealSize),
      salesCycle: kpi(p, wins, m.salesCycle),
      dealsWon: kpi(p, wins, (a, b) => m.won(a, b).length),
      openPipeline: sum(open, (d) => d.amount),
      weightedPipeline: Math.round(sum(open, (d) => d.amount * STAGE_PROBABILITY[d.stage])),
    },
    forecast: {
      quarter: q.label,
      start: q.start,
      end: q.end,
      quota: targetAvailable ? quotaIn(quotas, q.start, q.end) : null,
      won: wonQ,
      commit: byStage(['negotiation']),
      bestCase: byStage(['proposal']),
      pipeline: byStage(['prospecting', 'qualification']),
      projected: Math.round(wonQ + sum(inQuarter, (d) => d.amount * STAGE_PROBABILITY[d.stage])),
    },
    reps: repRows,
    pipelineByStage: pipelineByStage(deals),
    winRateBySegment: SEGMENTS.map((segment) => {
      const w = closed.filter((d) => d.segment === segment && d.stage === 'won').length;
      const l = closed.filter((d) => d.segment === segment && d.stage === 'lost').length;
      return { segment, won: w, lost: l, rate: ratio(w, w + l) };
    }),
    lostReasons: (['price', 'competitor', 'no_decision', 'timing', 'features', 'budget'] as LostReason[])
      .map((reason) => {
        const rows = lost.filter((d) => d.lost_reason === reason);
        return { reason, count: rows.length, amount: sum(rows, (d) => d.amount) };
      })
      .sort((a, b) => b.count - a.count),
    revenueByProduct: PRODUCTS.map((product) => {
      const rows = wonP.filter((d) => d.product === product);
      return { product, amount: sum(rows, (d) => d.amount), count: rows.length };
    }).sort((a, b) => b.amount - a.amount),
    atRisk: open
      .map((d) => ({
        ...d,
        days_in_stage: D.diffDays(d.stage_changed_at, today),
        overdue_days: Math.max(0, D.diffDays(d.expected_close, today)),
      }))
      .filter((d) => d.overdue_days > 0 || d.days_in_stage > 45)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 12),
  };
}

// ---------- Marketing ----------

export function marketing(db: Db, f: Filters, today: string): MarketingResponse {
  const scoped: Filters = { ...f, owner: undefined };
  const p = periodInfo(scoped);
  const wins = bucketWindows(p);
  const deals = loadDeals(db, scoped, false);
  const leads = loadLeads(db, scoped);
  const spend = spendModel(db, scoped, leads, today);
  const m = dealMetrics(deals);
  const mkt = deals.filter((d) => d.source === 'marketing');

  const leadsIn = (a: string, b: string, pred: (l: LeadFact) => boolean = () => true) =>
    leads.filter((l) => inWin(l.created_at, a, b) && pred(l)).length;
  const countAt = (key: 'mql_at' | 'sql_at' | 'converted_at', a: string, b: string, pred: (l: LeadFact) => boolean = () => true) =>
    leads.filter((l) => inWin(l[key], a, b) && pred(l)).length;
  const pipelineOf = (a: string, b: string, pred: (d: DealRow) => boolean = () => true) =>
    sum(mkt.filter((d) => inWin(d.created_at, a, b) && pred(d)), (d) => d.amount);
  const revenueOf = (a: string, b: string, pred: (d: DealRow) => boolean = () => true) =>
    sum(mkt.filter((d) => d.stage === 'won' && inWin(d.closed_at, a, b) && pred(d)), (d) => d.amount);
  const roi = (rev: number, s: number) => (s > 0 ? (rev - s) / s : null);

  const channels: ChannelPerformance[] = CHANNELS.map((channel) => {
    const byCh = (x: { channel: string | null }) => x.channel === channel;
    const s = spend.total(p.from, p.to, channel);
    const leadsN = leadsIn(p.from, p.to, byCh);
    const revenue = revenueOf(p.from, p.to, byCh);
    return {
      channel,
      spend: Math.round(s),
      leads: leadsN,
      mqls: countAt('mql_at', p.from, p.to, byCh),
      sqls: countAt('sql_at', p.from, p.to, byCh),
      opps: countAt('converted_at', p.from, p.to, byCh),
      pipeline: pipelineOf(p.from, p.to, byCh),
      revenue,
      cpl: ratio(s, leadsN),
      roi: roi(revenue, s),
    };
  });

  const campaigns: CampaignPerformance[] = spend.campaigns
    .filter((c) => c.start_date <= p.to && c.end_date >= p.from)
    .map((c) => {
      const byC = (x: { campaign_id: number | null }) => x.campaign_id === c.id;
      const s = spend.spendOf(c, p.from, p.to);
      const leadsN = leadsIn(p.from, p.to, byC);
      const revenue = revenueOf(p.from, p.to, byC);
      return {
        ...c,
        periodSpend: Math.round(s),
        leads: leadsN,
        mqls: countAt('mql_at', p.from, p.to, byC),
        sqls: countAt('sql_at', p.from, p.to, byC),
        opps: countAt('converted_at', p.from, p.to, byC),
        pipeline: pipelineOf(p.from, p.to, byC),
        revenue,
        cpl: ratio(s, leadsN),
        roi: roi(revenue, s),
      };
    })
    .sort((a, b) => b.pipeline - a.pipeline);

  return {
    period: p,
    kpis: {
      spend: kpi(p, wins, (a, b) => spend.total(a, b)),
      leads: kpi(p, wins, (a, b) => leadsIn(a, b)),
      cpl: kpi(p, wins, (a, b) => ratio(spend.total(a, b), leadsIn(a, b))),
      mqls: kpi(p, wins, (a, b) => countAt('mql_at', a, b)),
      sqls: kpi(p, wins, (a, b) => countAt('sql_at', a, b)),
      pipelineSourced: kpi(p, wins, (a, b) => pipelineOf(a, b)),
      revenueSourced: kpi(p, wins, (a, b) => revenueOf(a, b)),
      roi: kpi(p, wins, (a, b) => roi(revenueOf(a, b), spend.total(a, b))),
      cac: kpi(p, wins, (a, b) => ratio(spend.total(a, b), m.newCustomers(a, b))),
    },
    leadsByChannel: p.buckets.map((bucket, i) => {
      const row = { bucket } as MarketingResponse['leadsByChannel'][number];
      for (const ch of CHANNELS) row[ch] = leadsIn(...wins[i], (l) => l.channel === ch);
      return row;
    }),
    channels,
    campaigns,
    funnel: funnelFor(leads, p.from, p.to),
    sourceMix: SOURCES.map((source) => ({
      source,
      pipeline: sum(deals.filter((d) => d.source === source && inWin(d.created_at, p.from, p.to)), (d) => d.amount),
      revenue: sum(m.won(p.from, p.to).filter((d) => d.source === source), (d) => d.amount),
    })),
  };
}
