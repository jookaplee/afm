import type {
  AbmTier,
  ActivityType,
  CampaignStatus,
  Channel,
  DealType,
  FunnelStage,
  Industry,
  LeadStatus,
  LostReason,
  OpenStage,
  Product,
  Region,
  RepRole,
  Segment,
  Source,
  Stage,
} from './constants.ts';

// ---------- Entities ----------

export interface Rep {
  id: number;
  name: string;
  email: string;
  role: RepRole;
  team: Segment | 'sdr';
  active: number;
}

/** A rep with the quota for the current month, as listed on the team page. */
export interface RepRow extends Rep {
  monthly_quota: number | null;
  open_deals: number;
  accounts: number;
}

export interface Account {
  id: number;
  name: string;
  industry: Industry;
  segment: Segment;
  region: Region;
  employees: number;
  website: string | null;
  owner_id: number | null;
  tier: AbmTier;
  created_at: string;
  legal_name: string | null;
  contact_name: string | null;
  phone: string | null;
  /** Estimated sales from the imported prospect list (RM). */
  sales_estimate: number | null;
  rating: number | null;
  /** Areas served, as free text. */
  area: string | null;
  /** JSON object of social links (facebook, instagram, tiktok, threads, youtube). */
  socials: string | null;
  source: string | null;
}

export interface Deal {
  id: number;
  name: string;
  account_id: number;
  owner_id: number;
  stage: Stage;
  amount: number;
  product: Product;
  type: DealType;
  source: Source;
  channel: Channel | null;
  campaign_id: number | null;
  lead_id: number | null;
  created_at: string;
  expected_close: string;
  closed_at: string | null;
  stage_changed_at: string;
  lost_reason: LostReason | null;
  next_step: string | null;
}

/** Deal joined with its account and owner, as returned by list endpoints. */
export interface DealRow extends Deal {
  account_name: string;
  segment: Segment;
  region: Region;
  industry: Industry;
  owner_name: string;
}

export interface Lead {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  company: string;
  industry: Industry;
  segment: Segment;
  region: Region;
  channel: Channel;
  campaign_id: number | null;
  status: LeadStatus;
  score: number;
  owner_id: number | null;
  account_id: number | null;
  deal_id: number | null;
  created_at: string;
  mql_at: string | null;
  sql_at: string | null;
  converted_at: string | null;
}

export interface LeadRow extends Lead {
  owner_name: string | null;
  campaign_name: string | null;
}

export interface Campaign {
  id: number;
  name: string;
  channel: Channel;
  start_date: string;
  end_date: string;
  budget: number;
  spend: number;
  status: CampaignStatus;
}

export interface Activity {
  id: number;
  rep_id: number;
  deal_id: number | null;
  account_id: number | null;
  lead_id: number | null;
  type: ActivityType;
  date: string;
  subject: string;
}

// ---------- Filters & analytics ----------

export type Granularity = 'week' | 'month';

export interface PeriodInfo {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  granularity: Granularity;
  buckets: string[];
}

/** A headline metric for the period, its value in the previous equal-length period, and a per-bucket trend. */
export interface Kpi {
  value: number | null;
  prev: number | null;
  trend: (number | null)[];
}

export interface FunnelStep {
  stage: FunnelStage;
  count: number;
}

export interface StageAmount {
  stage: OpenStage;
  amount: number;
  weighted: number;
  count: number;
}

export interface OverviewResponse {
  period: PeriodInfo;
  targetAvailable: boolean;
  kpis: {
    revenue: Kpi;
    target: number | null;
    newPipeline: Kpi;
    winRate: Kpi;
    avgDealSize: Kpi;
    salesCycle: Kpi;
    leads: Kpi;
    mqlToSql: Kpi;
    cac: Kpi;
    marketingRoi: Kpi;
  };
  revenueSeries: { bucket: string; revenue: number; target: number | null }[];
  revenueBySource: ({ bucket: string } & Record<Source, number>)[];
  funnel: FunnelStep[];
  pipelineByStage: StageAmount[];
  closingSoon: DealRow[];
}

export interface RepPerformance {
  id: number;
  name: string;
  team: Segment;
  quota: number;
  won: number;
  wonCount: number;
  attainment: number | null;
  openPipeline: number;
  winRate: number | null;
  avgCycle: number | null;
  activities: number;
}

export interface ForecastInfo {
  quarter: string;
  start: string;
  end: string;
  quota: number | null;
  won: number;
  commit: number;
  bestCase: number;
  pipeline: number;
  projected: number;
}

export interface SalesResponse {
  period: PeriodInfo;
  targetAvailable: boolean;
  kpis: {
    revenue: Kpi;
    attainment: Kpi;
    winRate: Kpi;
    avgDealSize: Kpi;
    salesCycle: Kpi;
    dealsWon: Kpi;
    openPipeline: number;
    weightedPipeline: number;
  };
  forecast: ForecastInfo;
  reps: RepPerformance[];
  pipelineByStage: StageAmount[];
  winRateBySegment: { segment: Segment; won: number; lost: number; rate: number | null }[];
  lostReasons: { reason: LostReason; count: number; amount: number }[];
  revenueByProduct: { product: Product; amount: number; count: number }[];
  atRisk: (DealRow & { days_in_stage: number; overdue_days: number })[];
}

export interface ChannelPerformance {
  channel: Channel;
  spend: number;
  leads: number;
  mqls: number;
  sqls: number;
  opps: number;
  pipeline: number;
  revenue: number;
  cpl: number | null;
  roi: number | null;
}

export interface CampaignPerformance extends Campaign {
  periodSpend: number;
  leads: number;
  mqls: number;
  sqls: number;
  opps: number;
  pipeline: number;
  revenue: number;
  cpl: number | null;
  roi: number | null;
}

export interface MarketingResponse {
  period: PeriodInfo;
  kpis: {
    spend: Kpi;
    leads: Kpi;
    cpl: Kpi;
    mqls: Kpi;
    sqls: Kpi;
    pipelineSourced: Kpi;
    revenueSourced: Kpi;
    roi: Kpi;
    cac: Kpi;
  };
  leadsByChannel: ({ bucket: string } & Record<Channel, number>)[];
  channels: ChannelPerformance[];
  campaigns: CampaignPerformance[];
  funnel: FunnelStep[];
  sourceMix: { source: Source; pipeline: number; revenue: number }[];
}

export interface AccountRow extends Account {
  owner_name: string | null;
  won_revenue: number;
  open_pipeline: number;
  open_deals: number;
  won_deals: number;
  leads: number;
  last_activity: string | null;
}

export interface AccountDetail {
  account: AccountRow;
  deals: DealRow[];
  leads: LeadRow[];
  activities: (Activity & { rep_name: string })[];
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MetaResponse {
  today: string;
  appName: string;
  reps: Rep[];
  campaigns: Pick<Campaign, 'id' | 'name' | 'channel' | 'status'>[];
  dataRange: { min: string; max: string };
}
