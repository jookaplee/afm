// The AI lead agent's shared vocabulary: settings, the records it exchanges
// with the API, how values are compared, and its prompts and report schemas.
// Pure module (no SDK, no DB) so the server, the browser and tests share it.

import type { Industry, Region } from './constants.ts';

// ---------- Settings ----------

export interface AgentModel {
  id: string;
  label: string;
  /** USD per million tokens (input, output), for cost estimates only. */
  price: [number, number];
}

export const AGENT_MODELS: AgentModel[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: [4, 20] },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: [2, 10] },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: [0.1, 0.5] },
];

export interface AgentSettings {
  model: string;
  /** Accounts verified per cycle. */
  perCycle: number;
  /** New leads asked for per cycle (0 turns discovery off). */
  discoverPerCycle: number;
  /** Minutes between cycles while autopilot is on. */
  intervalMin: number;
  /** Claude calls allowed per day (each verified account or discovery search is one call). */
  dailyCalls: number;
  /** An account is checked again after this many days. */
  reverifyDays: number;
  autopilot: boolean;
  /** Fill empty fields straight away when the agent is highly confident (never overwrites). */
  autoFillEmpty: boolean;
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  model: 'claude-opus-5-5',
  perCycle: 3,
  discoverPerCycle: 2,
  intervalMin: 20,
  dailyCalls: 30,
  reverifyDays: 30,
  autopilot: true,
  autoFillEmpty: true,
};

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** Accepts partial or untrusted input and returns complete, bounded settings. */
export function normalizeSettings(input: unknown): AgentSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof AgentSettings, unknown>>;
  const d = DEFAULT_AGENT_SETTINGS;
  return {
    model: AGENT_MODELS.some((m) => m.id === s.model) ? (s.model as string) : d.model,
    perCycle: clampInt(s.perCycle, 1, 20, d.perCycle),
    discoverPerCycle: clampInt(s.discoverPerCycle, 0, 10, d.discoverPerCycle),
    intervalMin: clampInt(s.intervalMin, 5, 1440, d.intervalMin),
    dailyCalls: clampInt(s.dailyCalls, 1, 500, d.dailyCalls),
    reverifyDays: clampInt(s.reverifyDays, 1, 365, d.reverifyDays),
    autopilot: typeof s.autopilot === 'boolean' ? s.autopilot : d.autopilot,
    autoFillEmpty: typeof s.autoFillEmpty === 'boolean' ? s.autoFillEmpty : d.autoFillEmpty,
  };
}

// ---------- Records ----------

export type Confidence = 'high' | 'medium' | 'low';
export const CONFIDENCES: Confidence[] = ['high', 'medium', 'low'];

/** Account fields the agent checks. Socials live in the account's `socials` JSON. */
export const AGENT_FIELDS = ['phone', 'contact_name', 'address', 'email', 'website', 'facebook', 'instagram', 'tiktok', 'legal_name'] as const;
export type AgentField = (typeof AGENT_FIELDS)[number];
export const SOCIAL_FIELDS: AgentField[] = ['facebook', 'instagram', 'tiktok'];

export interface FoundValue {
  value: string;
  source: string;
  confidence: Confidence;
}

export type Operating = 'yes' | 'no' | 'unknown';

/** What the agent reports for one account. */
export interface VerifyResult {
  account_id: number;
  found: boolean;
  operating: Operating;
  operating_source: string | null;
  fields: Partial<Record<AgentField, FoundValue | null>>;
  summary: string;
  sources: string[];
}

export type SizeHint = 'large' | 'medium' | 'small';

/** A new business the agent found. */
export interface Candidate {
  name: string;
  legal_name: string | null;
  category: Industry;
  state: string | null;
  area: string | null;
  address: string | null;
  phone: string | null;
  contact_name: string | null;
  email: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  tiktok: string | null;
  rating: number | null;
  size: SizeHint | null;
  why: string;
  confidence: Confidence;
  sources: string[];
}

/** The account data the agent is given to check. */
export interface AgentAccountRecord {
  id: number;
  name: string;
  legal_name: string | null;
  industry: Industry;
  /** The category's name and description, for the prompt. */
  category_brief: string;
  region: Region;
  area: string | null;
  address: string | null;
  phone: string | null;
  contact_name: string | null;
  email: string | null;
  website: string | null;
  socials: string | null;
  rating: number | null;
  verified_at: string | null;
}

export interface DiscoverTarget {
  category: Industry;
  /** The category's name. */
  label: string;
  /** Who belongs in the category (its name and description). */
  brief: string;
  /** The business of the group the leads are for (name and description). */
  business: string;
  region: Region;
  /** Names already in the CRM for this category and region. */
  exclude: string[];
}

export interface AgentPlan {
  settings: AgentSettings;
  accounts: AgentAccountRecord[];
  discover: DiscoverTarget | null;
  budget: { used: number; limit: number };
}

/** Body of POST /agent/runs: one cycle's results. */
export interface AgentRunInput {
  kind: 'verify' | 'discover' | 'cycle';
  started_at: string;
  finished_at: string;
  model: string;
  calls: number;
  searches: number;
  input_tokens: number;
  output_tokens: number;
  error: string | null;
  results: VerifyResult[];
  candidates: Candidate[];
}

export interface AgentRunSummary {
  run_id: number;
  checked: number;
  findings: number;
  auto: number;
  confirmed: number;
  new_leads: number;
  duplicates: number;
}

// ---------- Comparing values ----------

/**
 * Malaysian phone number as digits starting with 0, or null when it isn't one.
 * Mobiles 01x + 7-8 digits, landlines 0[3-9] + 7-8 digits, 1300/1800 numbers.
 */
export function normPhone(v: string | null | undefined): string | null {
  if (!v) return null;
  let d = String(v).replace(/\D/g, '');
  if (d.startsWith('60')) d = `0${d.slice(2)}`;
  if (/^01\d{8,9}$/.test(d) || /^0[3-9]\d{7,8}$/.test(d) || /^1[38]00\d{6}$/.test(d)) return d;
  return null;
}

/** "0123456789" -> "012-3456789", "0322019055" -> "03-22019055". */
export function formatPhone(digits: string): string {
  if (/^1[38]00/.test(digits)) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
  if (digits.startsWith('01')) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  if (/^08[2-9]/.test(digits)) return `${digits.slice(0, 3)}-${digits.slice(3)}`; // Sabah/Sarawak
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

/** Only http(s) links, normalised (no javascript:/data: from model output). */
export function cleanUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  let s = String(v).trim();
  if (!/^https?:\/\//i.test(s) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const urlKey = (v: string) =>
  v
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^(www\.|m\.|web\.)/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');

const textKey = (v: string) =>
  v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Comparable form of a field value: equal keys mean "same information". */
export function valueKey(field: AgentField, v: string | null | undefined): string | null {
  if (v === null || v === undefined || !String(v).trim()) return null;
  const s = String(v).trim();
  switch (field) {
    case 'phone':
      return normPhone(s) ?? textKey(s);
    case 'email':
      return s.toLowerCase();
    case 'website':
    case 'facebook':
    case 'instagram':
    case 'tiktok':
      return urlKey(s);
    default:
      return textKey(s);
  }
}

/** Cleans a value the agent found; null when it isn't usable for that field. */
export function cleanValue(field: AgentField, v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s || /^(null|n\/a|tiada|unknown|-)$/i.test(s)) return null;
  switch (field) {
    case 'phone': {
      const d = normPhone(s);
      return d ? formatPhone(d) : null;
    }
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null;
    case 'website':
    case 'facebook':
    case 'instagram':
    case 'tiktok':
      return cleanUrl(s);
    default:
      return s.slice(0, field === 'address' ? 300 : 160);
  }
}

/** Source links the agent cites: http(s) only, unique, at most `max`. */
export function cleanSources(list: unknown, max = 8): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(list) ? list : []) {
    const u = typeof v === 'string' ? cleanUrl(v) : null;
    if (u && !out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/** Same business? Compares names loosely and phones/websites exactly. */
export function nameKey(name: string): string {
  return textKey(name)
    .replace(/\b(sdn|bhd|berhad|enterprise|ent|plt|restaurant|restoran|cafe|kafe|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Prompts and report tools ----------

export const REGION_BRIEF: Record<Region, string> = {
  klang_valley: 'Klang Valley (Kuala Lumpur, Selangor, Putrajaya)',
  northern: 'Northern Malaysia (Penang, Perak, Kedah, Perlis)',
  southern: 'Southern Malaysia (Johor, Melaka, Negeri Sembilan)',
  east_coast: 'East Coast (Pahang, Kelantan, Terengganu)',
  sabah: 'Sabah and Labuan',
  sarawak: 'Sarawak',
};

const COMPANY = 'JOOSONS, a Malaysian group of businesses selling B2B';

/** A category for a prompt: "Name: description". */
export function categoryBrief(name: string, description: string | null | undefined): string {
  const d = description?.trim();
  return d ? `${name}: ${d}` : name;
}

export const VERIFY_SYSTEM = `You are the data verification agent in the B2B sales CRM of ${COMPANY}.
Check that one prospect record is correct and current, using web search and web fetch: the business's Google Maps / Google Business listing, official website, Facebook, Instagram, TikTok, delivery platforms (GrabFood, Foodpanda) for F&B, business directories and news.

Rules:
- Report only facts you found in a source during this check. Never guess or invent; use null when you did not find a value.
- Every value needs the exact URL where you saw it.
- Make sure each source is about this same business (same name and town). For chains, use the outlet that matches the record's area, or the headquarters.
- confidence: "high" = the business's own listing, website or page; "medium" = a reliable third-party listing; "low" = indirect, old or ambiguous.
- phone: the business's contact number in Malaysian format (e.g. 012-3456789, 03-12345678).
- contact_name: owner, founder, manager or person in charge, only if a source names them.
- address: full street address of the matching outlet.
- legal_name: registered company name (Sdn Bhd, Enterprise, PLT) only if a source states it.
- operating: "no" only with evidence the business closed permanently (e.g. "Permanently closed" on Google Maps, a closure post); "unknown" if unsure.
- summary: one or two sentences in Bahasa Melayu for a salesperson: what the business is, outlets, menu focus, and any change you found.
- When done, call report_verification exactly once. Write nothing after it.`;

export const DISCOVER_SYSTEM = `You are the lead-generation agent in the B2B sales CRM of ${COMPANY}.
Find NEW prospects: real businesses in Malaysia, currently operating, that match the target category and region and could buy in volume from our business described in the message. Use web search and web fetch: Google Maps listings, business and food directories, delivery platforms, Facebook and Instagram pages, news and "best of" lists.

Rules:
- Follow every requirement in our business description (for example halal or Muslim-friendly only).
- Skip every business in the exclusion list; another outlet of a listed brand counts as listed.
- Never invent details; use null for anything you did not find. Every lead needs at least one source URL and at least one way to reach it (phone, website or social page).
- confidence: "high" when the business's own listing or page confirms the details, "medium" for reliable third-party listings, "low" otherwise.
- size: "large" for chains or busy multi-outlet businesses, "medium" for an established single outlet, "small" for home-based or new sellers; null if unclear.
- why: one sentence in Bahasa Melayu on why this business is a good prospect.
- Return fewer leads rather than doubtful ones. When done, call report_new_leads exactly once. Write nothing after it.`;

/** User message for verifying one account. */
export function verifyPrompt(a: AgentAccountRecord, today: string, labels: { region: string }): string {
  let socials: Record<string, string> = {};
  try {
    socials = a.socials ? (JSON.parse(a.socials) as Record<string, string>) : {};
  } catch {
    /* ignore */
  }
  const record = {
    name: a.name,
    legal_name: a.legal_name,
    category: a.category_brief,
    region: labels.region,
    area: a.area,
    address: a.address,
    phone: a.phone,
    contact_name: a.contact_name,
    email: a.email,
    website: a.website,
    facebook: socials.facebook ?? null,
    instagram: socials.instagram ?? null,
    tiktok: socials.tiktok ?? null,
    google_rating: a.rating,
    last_verified: a.verified_at,
  };
  return `Prospect record currently in the CRM (values may be outdated or wrong):\n${JSON.stringify(record, null, 2)}\n\nToday is ${today}. Verify every field and report what the sources say now.`;
}

/** User message for finding new leads. */
export function discoverPrompt(t: DiscoverTarget, count: number, today: string): string {
  const list = t.exclude.length ? t.exclude.map((n) => `- ${n}`).join('\n') : '(none yet)';
  return `Our business: ${t.business}\nTarget category: ${t.brief}\nTarget region: ${REGION_BRIEF[t.region]}\nFind up to ${count} new leads.\nToday is ${today}.\n\nAlready in the CRM for this category and region (exclude):\n${list}`;
}

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] });
const STR = { type: 'string' };
const FOUND = {
  type: 'object',
  additionalProperties: false,
  required: ['value', 'source', 'confidence'],
  properties: {
    value: STR,
    source: { type: 'string', description: 'URL where this value was seen' },
    confidence: { type: 'string', enum: CONFIDENCES },
  },
};

export const VERIFY_TOOL = {
  name: 'report_verification',
  description: 'Report the verified data for the prospect record. Call exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['found', 'operating', 'operating_source', 'fields', 'summary', 'sources'],
    properties: {
      found: { type: 'boolean', description: 'Whether the business was found online at all' },
      operating: { type: 'string', enum: ['yes', 'no', 'unknown'] },
      operating_source: nullable({ type: 'string', description: 'URL supporting the operating status' }),
      fields: {
        type: 'object',
        additionalProperties: false,
        required: [...AGENT_FIELDS],
        properties: Object.fromEntries(AGENT_FIELDS.map((f) => [f, nullable(FOUND)])),
      },
      summary: STR,
      sources: { type: 'array', items: STR },
    },
  },
};

export const DISCOVER_TOOL = {
  name: 'report_new_leads',
  description: 'Report the new leads found. Call exactly once, at the end.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    required: ['leads'],
    properties: {
      leads: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'name', 'legal_name', 'state', 'area', 'address', 'phone', 'contact_name', 'email',
            'website', 'facebook', 'instagram', 'tiktok', 'rating', 'size', 'why', 'confidence', 'sources',
          ],
          properties: {
            name: STR,
            legal_name: nullable(STR),
            state: nullable(STR),
            area: nullable({ type: 'string', description: 'Town or district' }),
            address: nullable(STR),
            phone: nullable(STR),
            contact_name: nullable(STR),
            email: nullable(STR),
            website: nullable(STR),
            facebook: nullable(STR),
            instagram: nullable(STR),
            tiktok: nullable(STR),
            rating: nullable({ type: 'number', description: 'Google rating out of 5' }),
            size: nullable({ type: 'string', enum: ['large', 'medium', 'small'] }),
            why: STR,
            confidence: { type: 'string', enum: CONFIDENCES },
            sources: { type: 'array', items: STR },
          },
        },
      },
    },
  },
};

