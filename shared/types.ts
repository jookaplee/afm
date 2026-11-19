import type { AgentField, AgentSettings, Candidate, Confidence } from './agent.ts';
import type { PhoneType, WaSettings } from './whatsapp.ts';
import type {
  AbmTier,
  ActivityType,
  CampaignStatus,
  Channel,
  DealType,
  FunnelStage,
  Industry,
  OrderStatus,
  ProductCategory,
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
  address: string | null;
  email: string | null;
  /** When the AI agent last checked this account (ISO timestamp). */
  verified_at: string | null;
  verify_status: VerifyStatus | null;
  /** The agent's latest summary of the business. */
  agent_note: string | null;
}

export type VerifyStatus = 'ok' | 'changed' | 'closed' | 'not_found';

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
  /** Whether the number has WhatsApp, as marked by the user (null = not checked). */
  wa_status?: WaStatus | null;
  /** When the lead replied on WhatsApp (marked by the user). */
  wa_replied_at?: string | null;
}

export type WaStatus = 'yes' | 'no';

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

// ---------- AI agent ----------

export type AgentFindingKind = 'update' | 'closed' | 'new_lead';
export type AgentFindingStatus = 'pending' | 'accepted' | 'rejected' | 'auto' | 'superseded';

export interface AgentFindingRow {
  id: number;
  run_id: number | null;
  kind: AgentFindingKind;
  account_id: number | null;
  account_name: string | null;
  field: AgentField | null;
  old_value: string | null;
  new_value: string | null;
  /** The new business, for kind "new_lead". */
  payload: Candidate | null;
  confidence: Confidence;
  sources: string[];
  note: string | null;
  status: AgentFindingStatus;
  created_at: string;
  decided_at: string | null;
}

export interface AgentRunRow {
  id: number;
  kind: 'verify' | 'discover' | 'cycle';
  started_at: string;
  finished_at: string;
  model: string | null;
  calls: number;
  checked: number;
  found: number;
  searches: number;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
}

export interface AgentSummary {
  settings: AgentSettings;
  /** The server runs the agent itself; the browser only starts it. */
  serverAgent: boolean;
  findings: { pending: number; updates: number; closed: number; newLeads: number; accepted: number; rejected: number; auto: number };
  accounts: { total: number; verified: number; due: number; closed: number; notFound: number; fromAgent: number };
  today: { calls: number; limit: number; searches: number; inputTokens: number; outputTokens: number };
  lastRun: AgentRunRow | null;
}

// ---------- WhatsApp ----------

export interface WaTemplate {
  id: number;
  name: string;
  body: string;
  created_at: string;
}

/** A lead with a phone number, as listed on the WhatsApp page. */
export interface WaContact {
  lead_id: number;
  name: string;
  company: string;
  account_id: number | null;
  area: string | null;
  region: Region;
  segment: Segment;
  industry: Industry;
  status: LeadStatus;
  score: number;
  owner_name: string | null;
  phone: string;
  /** "60123456789" for wa.me, or null when the number cannot take a chat. */
  intl: string | null;
  phone_type: PhoneType;
  /** Other leads with the same number (often a head office or agency line). */
  shared: number;
  wa_status: WaStatus | null;
  wa_replied_at: string | null;
  sent_count: number;
  last_sent_at: string | null;
  last_template: string | null;
  /** Text of the latest message, for the chat list preview. */
  last_body: string | null;
  /** The AI agent's summary of the business, if any (for AI drafts). */
  note: string | null;
  wa_unread: number;
  wa_needs_human: number;
  wa_human_reason: string | null;
  wa_agent_off: number;
  wa_last_in_at: string | null;
  /** Direction, author and status of the latest message (for the list preview). */
  last_direction: WaDirection | null;
  last_author: WaAuthor | null;
  last_status: WaMessageStatus | null;
  last_at: string | null;
  drafts: number;
}

export type WaDirection = 'in' | 'out';
export type WaAuthor = 'user' | 'agent' | 'contact';
/** opened (wa.me), draft (waiting for approval), queued/sent/delivered/read/failed (Business API), received (incoming). */
export type WaMessageStatus = 'opened' | 'draft' | 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'received';

export interface WaMessageRow {
  id: number;
  lead_id: number | null;
  account_id: number | null;
  phone: string;
  body: string;
  template_id: number | null;
  template_name: string | null;
  lead_name: string | null;
  company: string | null;
  created_at: string;
  direction: WaDirection;
  author: WaAuthor;
  status: WaMessageStatus;
  wa_id: string | null;
  error: string | null;
}

export interface WaSummary {
  settings: WaSettings;
  withPhone: number;
  mobile: number;
  landline: number;
  invalid: number;
  shared: number;
  waYes: number;
  waNo: number;
  /** Leads that can take a chat and have not been messaged yet. */
  todo: number;
  contacted: number;
  replied: number;
  messages: number;
  messagesToday: number;
  unread: number;
  needsHuman: number;
  drafts: number;
  /** Connected to the WhatsApp Business Platform (messages arrive and send by themselves). */
  live: boolean;
  /** The server runs the WhatsApp agent (ANTHROPIC_API_KEY on the server). */
  agentServer: boolean;
}

// ---------- Orders ----------

/** A catalog item (not to be confused with the deal's product line). */
export interface CatalogProduct {
  id: number;
  name: string;
  category: ProductCategory;
  unit: string;
  price_sen: number;
  min_qty: number | null;
  stock: number | null;
  description: string | null;
  active: number;
  created_at: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  name: string;
  unit: string;
  qty: number;
  price_sen: number;
}

export type OrderSource = 'whatsapp_agent' | 'manual';

export interface OrderRow {
  id: number;
  lead_id: number | null;
  account_id: number | null;
  status: OrderStatus;
  total_sen: number;
  delivery_date: string | null;
  delivery_address: string | null;
  notes: string | null;
  source: OrderSource;
  deal_id: number | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
  lead_name: string | null;
  company: string | null;
  phone: string | null;
  items_count: number;
  items_summary: string | null;
}

export interface OrderDetail extends OrderRow {
  items: OrderItem[];
}

export interface OrderSummary {
  counts: Record<OrderStatus, number>;
  todayCount: number;
  /** Confirmed, processing and delivered orders this month. */
  monthValueSen: number;
  monthCount: number;
  pendingValueSen: number;
}
