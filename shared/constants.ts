// Enumerations shared by the API and the UI. The database stores these keys;
// the UI translates them through i18n (see client/src/lib/i18n.ts).

export const SEGMENTS = ['enterprise', 'midmarket', 'smb'] as const;
export type Segment = (typeof SEGMENTS)[number];

export const REGIONS = ['klang_valley', 'northern', 'southern', 'east_coast', 'sabah', 'sarawak'] as const;
export type Region = (typeof REGIONS)[number];

// Lead / customer categories (the CRM's "kategori") are a table (lead_categories),
// managed per business of the group. These are the starting categories; their keys
// match the imported CRM data. "other" is the fallback and always exists.
export const INDUSTRIES = ['restoran_halal_western', 'kafe_premium_steak_bbq', 'penjual_perap_online', 'other'] as const;
export type DefaultIndustry = (typeof INDUSTRIES)[number];
/** A lead category key (lead_categories.key). */
export type Industry = string;
export const FALLBACK_CATEGORY = 'other';
/** Category colours are chart series 1-8 (7 is neutral grey). */
export const CATEGORY_COLORS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

// Lead channels. Order is the categorical colour order in charts - never reorder.
// The first six are marketing channels with campaigns; "prospect_list" is an
// imported or researched prospect list (charted in neutral grey); "whatsapp" is
// a customer who wrote in on WhatsApp first.
export const MARKETING_CHANNELS = ['linkedin', 'search', 'events', 'email', 'content', 'referral'] as const;
export const CHANNELS = [...MARKETING_CHANNELS, 'prospect_list', 'whatsapp'] as const;
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];
export type Channel = (typeof CHANNELS)[number];

// Where a deal came from.
export const SOURCES = ['marketing', 'sales', 'partner'] as const;
export type Source = (typeof SOURCES)[number];

export const OPEN_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation'] as const;
export const STAGES = [...OPEN_STAGES, 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];
export type OpenStage = (typeof OPEN_STAGES)[number];

export const STAGE_PROBABILITY: Record<Stage, number> = {
  prospecting: 0.1,
  qualification: 0.2,
  proposal: 0.4,
  negotiation: 0.6,
  won: 1,
  lost: 0,
};

// Frozen halal meat & seafood product lines.
export const PRODUCTS = ['beef', 'lamb', 'chicken', 'seafood'] as const;
export type Product = (typeof PRODUCTS)[number];

// Catalog categories (product lines plus anything else sold, e.g. sauces).
export const PRODUCT_CATEGORIES = [...PRODUCTS, 'other'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

// pending (taken, waiting for staff) -> confirmed -> processing -> delivered; or cancelled.
export const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'delivered', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const DEAL_TYPES = ['new_business', 'expansion'] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const LOST_REASONS = ['price', 'competitor', 'no_decision', 'timing', 'features', 'budget'] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LEAD_STATUSES = ['new', 'mql', 'sql', 'converted', 'disqualified'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const CAMPAIGN_STATUSES = ['planned', 'active', 'completed'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'demo'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const REP_ROLES = ['AE', 'SDR'] as const;
export type RepRole = (typeof REP_ROLES)[number];

export const ABM_TIERS = ['tier1', 'tier2', 'tier3'] as const;
export type AbmTier = (typeof ABM_TIERS)[number];

export const FUNNEL_STAGES = ['lead', 'mql', 'sql', 'opportunity', 'won'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
