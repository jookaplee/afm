// Deterministic generator for realistic B2B demo data (a Malaysian B2B software
// company, amounts in RM). Everything is anchored to `today`, so the dashboards always show a
// live-looking picture: ~2 years of history, open pipeline, active campaigns.

import type { Db } from './db.ts';
import { clearAll, tx } from './db.ts';
import * as D from '../shared/dates.ts';
import {
  CHANNELS,
  INDUSTRIES,
  PRODUCTS,
  type ActivityType,
  type Channel,
  type Industry,
  type LostReason,
  type Product,
  type Region,
  type Segment,
  type Source,
} from '../shared/constants.ts';
import type { Account, Activity, Campaign, Deal, Lead, Rep } from '../shared/types.ts';

export interface SeedOptions {
  today: string;
  seed?: number;
}

export interface SeedSummary {
  reps: number;
  accounts: number;
  campaigns: number;
  leads: number;
  deals: number;
  activities: number;
}

// ---------- Random helpers ----------

class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    // mulberry32
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r <= 0) return v;
    }
    return entries[entries.length - 1][0];
  }
  /** Log-uniform: skewed toward the low end, like real deal sizes. */
  logRange(min: number, max: number): number {
    return Math.exp(this.float(Math.log(min), Math.log(max)));
  }
  poisson(lambda: number): number {
    const l = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l);
    return k - 1;
  }
}

// ---------- Reference data ----------

const REP_SEED: [string, 'AE' | 'SDR', Segment | 'sdr'][] = [
  ['Aiman Hakim', 'AE', 'enterprise'],
  ['Tan Mei Ling', 'AE', 'enterprise'],
  ['Rajesh Nair', 'AE', 'enterprise'],
  ['Nurul Huda', 'AE', 'midmarket'],
  ['Jason Lim', 'AE', 'midmarket'],
  ['Farah Aziz', 'AE', 'midmarket'],
  ['Kumar Selvam', 'AE', 'midmarket'],
  ['Siti Aisyah', 'AE', 'smb'],
  ['Daniel Wong', 'AE', 'smb'],
  ['Hafiz Rahman', 'AE', 'smb'],
  ['Irfan Zulkifli', 'SDR', 'sdr'],
  ['Chloe Tan', 'SDR', 'sdr'],
  ['Kavitha Raj', 'SDR', 'sdr'],
  ['Syafiqah Omar', 'SDR', 'sdr'],
];

const NAME_A = [
  'Seri', 'Bina', 'Perdana', 'Gemilang', 'Delima', 'Intan', 'Mutiara', 'Kenanga', 'Cempaka', 'Teratai',
  'Wawasan', 'Murni', 'Sinar', 'Bestari', 'Harmoni', 'Tiara', 'Damai', 'Restu', 'Puncak', 'Utama',
  'Prima', 'Sentosa', 'Makmur', 'Kukuh', 'Wira', 'Tekun', 'Jaya', 'Mega', 'Pacific', 'Orient',
  'Summit', 'Apex', 'Vista', 'Titan', 'Synergy', 'Meridian', 'Borneo', 'Nusantara', 'Kinabalu', 'Langkawi',
];

const NAME_B: Record<Industry, string[]> = {
  manufacturing: ['Industries', 'Manufacturing', 'Precision', 'Plastik', 'Packaging', 'Engineering'],
  finance: ['Capital', 'Kewangan', 'Ventures', 'Credit', 'Insurans', 'Holdings'],
  retail: ['Trading', 'Mart', 'Retail', 'Niaga', 'Distributors', 'Marketing'],
  logistics: ['Logistics', 'Express', 'Freight', 'Shipping', 'Haulage', 'Warehousing'],
  healthcare: ['Medical', 'Healthcare', 'Pharma', 'Klinik', 'Medik', 'Diagnostics'],
  technology: ['Technology', 'Digital', 'Solutions', 'Systems', 'Data', 'Infotech'],
  energy: ['Energy', 'Petroleum', 'Power', 'Resources', 'Oil & Gas', 'Utilities'],
  property: ['Properties', 'Development', 'Construction', 'Realty', 'Builders', 'Land'],
};

const INDUSTRY_LABEL_MS: Record<Industry, string> = {
  manufacturing: 'Pembuatan',
  finance: 'Kewangan',
  retail: 'Runcit & FMCG',
  logistics: 'Logistik',
  healthcare: 'Kesihatan',
  technology: 'Teknologi',
  energy: 'Tenaga',
  property: 'Hartanah',
};

// Malaysian names: Malay, Chinese and Indian naming patterns.
const MALAY_FIRST = [
  'Ahmad', 'Nurul', 'Hafiz', 'Aina', 'Syafiq', 'Hidayah', 'Faizal', 'Amira', 'Azlan', 'Farhana', 'Rizal', 'Liyana',
  'Haziq', 'Nadia', 'Khairul', 'Aisyah', 'Zulkifli', 'Shahira', 'Firdaus', 'Izzati', 'Hakim', 'Balqis',
];
const MALAY_FATHER = ['Rahman', 'Ismail', 'Hassan', 'Abdullah', 'Yusof', 'Ibrahim', 'Othman', 'Hamid', 'Salleh', 'Razak', 'Ali', 'Mokhtar'];
const CHINESE_SURNAME = ['Tan', 'Lim', 'Lee', 'Wong', 'Ng', 'Chong', 'Ong', 'Teh', 'Goh', 'Chan', 'Yap', 'Low'];
const CHINESE_GIVEN = ['Wei Ming', 'Mei Ling', 'Kah Wai', 'Siew Lan', 'Jun Hao', 'Li Ying', 'Chee Keong', 'Pei Shan', 'Boon Huat', 'Hui Min', 'Zhi Hao', 'Xin Yi'];
const INDIAN_FIRST = ['Ramesh', 'Priya', 'Suresh', 'Kavitha', 'Arjun', 'Deepa', 'Vinod', 'Anitha', 'Ganesh', 'Shalini', 'Mohan', 'Revathi'];
const INDIAN_FATHER = ['Kumar', 'Ramasamy', 'Subramaniam', 'Krishnan', 'Muthu', 'Pillai', 'Nair', 'Raju', 'Govindasamy', 'Arumugam'];

function personName(rng: Rng): { name: string; emailLocal: string } {
  const r = rng.next();
  let name: string;
  if (r < 0.55) name = `${rng.pick(MALAY_FIRST)} ${rng.pick(MALAY_FATHER)}`;
  else if (r < 0.85) name = `${rng.pick(CHINESE_SURNAME)} ${rng.pick(CHINESE_GIVEN)}`;
  else name = `${rng.pick(INDIAN_FIRST)} ${rng.pick(INDIAN_FATHER)}`;
  return { name, emailLocal: name.toLowerCase().replace(/[^a-z]+/g, '.') };
}

const TITLES: Record<Segment, string[]> = {
  enterprise: ['Ketua Pegawai Maklumat (CIO)', 'Ketua IT', 'Naib Presiden Operasi', 'Pengarah Kewangan', 'Ketua Perolehan', 'Ketua Pegawai Digital'],
  midmarket: ['Pengurus IT', 'Pengurus Operasi', 'Pengurus Kewangan', 'Pengurus Sumber Manusia', 'Pengarah Operasi', 'Ketua Jualan'],
  smb: ['Pemilik', 'Pengarah Urusan', 'Pengurus Besar', 'Pengurus Kewangan', 'Eksekutif IT', 'Pengurus Am'],
};

const SEGMENT_W: [Segment, number][] = [
  ['enterprise', 0.25],
  ['midmarket', 0.35],
  ['smb', 0.4],
];
const REGION_W: [Region, number][] = [
  ['klang_valley', 0.4],
  ['northern', 0.17],
  ['southern', 0.17],
  ['east_coast', 0.08],
  ['sabah', 0.09],
  ['sarawak', 0.09],
];
const INDUSTRY_W: [Industry, number][] = [
  ['manufacturing', 0.19],
  ['finance', 0.14],
  ['retail', 0.16],
  ['logistics', 0.14],
  ['healthcare', 0.1],
  ['technology', 0.12],
  ['energy', 0.07],
  ['property', 0.08],
];
const PRODUCT_W: [Product, number][] = [
  ['platform', 0.45],
  ['analytics', 0.2],
  ['hr', 0.2],
  ['services', 0.15],
];
const PRODUCT_DEAL_NAME: Record<Product, string> = {
  platform: 'Pelaksanaan Platform',
  analytics: 'Modul Analitik',
  hr: 'Modul HR & Gaji',
  services: 'Perkhidmatan Perundingan',
};
const PRODUCT_FACTOR: Record<Product, number> = { platform: 1.15, analytics: 0.85, hr: 0.85, services: 0.55 };
const LOST_W: [LostReason, number][] = [
  ['price', 0.24],
  ['competitor', 0.22],
  ['no_decision', 0.2],
  ['timing', 0.14],
  ['features', 0.1],
  ['budget', 0.1],
];
const NEXT_STEP: Record<string, string[]> = {
  prospecting: ['Jadualkan panggilan penemuan', 'Kenal pasti pihak berkepentingan utama', 'Hantar e-mel perkenalan'],
  qualification: ['Jadualkan demo produk', 'Sahkan bajet & garis masa', 'Hantar kajian kes industri'],
  proposal: ['Susulan cadangan', 'Pembentangan kepada lembaga pengarah', 'Semak semula sebut harga'],
  negotiation: ['Muktamadkan kontrak', 'Semakan perundangan & perolehan', 'Rundingan terma pembayaran'],
};
const ACTIVITY_SUBJECTS: Record<ActivityType, string[]> = {
  call: ['Panggilan penemuan', 'Panggilan susulan', 'Panggilan kelayakan', 'Perbincangan keperluan'],
  email: ['Hantar cadangan', 'E-mel susulan', 'Hantar kajian kes', 'Pengesahan jadual mesyuarat'],
  meeting: ['Mesyuarat pihak berkepentingan', 'Pembentangan penyelesaian', 'Rundingan harga', 'Semakan kontrak'],
  demo: ['Demo produk', 'Demo teknikal', 'Bengkel bukti konsep'],
};

const SEG_PARAMS: Record<Segment, { amount: [number, number]; cycle: [number, number]; win: number; employees: [number, number] }> = {
  enterprise: { amount: [130e3, 920e3], cycle: [90, 210], win: 0.22, employees: [1000, 15000] },
  midmarket: { amount: [32e3, 185e3], cycle: [45, 110], win: 0.27, employees: [200, 999] },
  smb: { amount: [6e3, 40e3], cycle: [18, 55], win: 0.33, employees: [15, 199] },
};

interface ChannelCfg {
  cpl: number;
  mqlRate: number;
  seg: [Segment, number][];
  campaigns: { name: (q: string, i: number) => string; budget: [number, number]; window?: 'month' }[];
}

const CHANNEL_CFG: Record<Channel, ChannelCfg> = {
  linkedin: {
    cpl: 900,
    mqlRate: 0.42,
    seg: [['enterprise', 0.38], ['midmarket', 0.4], ['smb', 0.22]],
    campaigns: [
      {
        name: (q, i) => `LinkedIn ABM – ${INDUSTRY_LABEL_MS[INDUSTRIES[i % INDUSTRIES.length]]} ${q}`,
        budget: [56e3, 85e3],
      },
    ],
  },
  search: {
    cpl: 630,
    mqlRate: 0.35,
    seg: [['enterprise', 0.1], ['midmarket', 0.35], ['smb', 0.55]],
    campaigns: [{ name: (q) => `Google Ads – Jenama & Generik ${q}`, budget: [37e3, 63e3] }],
  },
  events: {
    cpl: 1100,
    mqlRate: 0.5,
    seg: [['enterprise', 0.4], ['midmarket', 0.4], ['smb', 0.2]],
    campaigns: [
      { name: (q) => `Siri Webinar ${q}`, budget: [22e3, 41e3] },
      { name: (q) => `Pameran & Jelajah ${q}`, budget: [45e3, 82e3], window: 'month' },
    ],
  },
  email: {
    cpl: 140,
    mqlRate: 0.3,
    seg: [['enterprise', 0.2], ['midmarket', 0.4], ['smb', 0.4]],
    campaigns: [{ name: (q) => `E-mel Pemupukan Lead ${q}`, budget: [6e3, 11e3] }],
  },
  content: {
    cpl: 340,
    mqlRate: 0.32,
    seg: [['enterprise', 0.15], ['midmarket', 0.35], ['smb', 0.5]],
    campaigns: [{ name: (q) => `SEO & Kandungan Teras ${q}`, budget: [19e3, 33e3] }],
  },
  referral: {
    cpl: 510,
    mqlRate: 0.55,
    seg: [['enterprise', 0.25], ['midmarket', 0.4], ['smb', 0.35]],
    campaigns: [{ name: (q) => `Program Rujukan Pelanggan ${q}`, budget: [9e3, 19e3] }],
  },
};

/** Company name without the legal suffix, e.g. "Seri Logistics Sdn Bhd" -> "Seri Logistics". */
export function shortCompany(name: string): string {
  return name.replace(/\s+(Sdn\.?\s*Bhd\.?|Berhad|Bhd\.?)$/i, '');
}

// ---------- Generator ----------

export function seed(db: Db, opts: SeedOptions): SeedSummary {
  const rng = new Rng(opts.seed ?? 20261118);
  const today = opts.today;
  // History starts nine months before last year so that last year is already in a
  // steady state (no empty pipeline at the start of the comparison period).
  const START = D.addMonths(`${Number(today.slice(0, 4)) - 1}-01-01`, -9);
  /** Business growth multiplier over the history window. */
  const growth = (d: string, rate: number) => 1 + rate * (D.diffDays(START, d) / 365);
  const roundTo = (v: number, step: number) => Math.max(step, Math.round(v / step) * step);

  // Reps
  const reps: Rep[] = REP_SEED.map(([name, role, team], i) => ({
    id: i + 1,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@afm.example`,
    role,
    team,
    active: 1,
  }));
  const aes = reps.filter((r) => r.role === 'AE');
  const sdrs = reps.filter((r) => r.role === 'SDR');
  const aesBySeg = (s: Segment) => aes.filter((r) => r.team === s);

  // Accounts
  const accounts: Account[] = [];
  const usedNames = new Set<string>();
  const companyName = (industry: Industry, enterprise: boolean): string => {
    for (let attempt = 0; attempt < 50; attempt++) {
      const a = rng.pick(NAME_A);
      const b = rng.pick(NAME_B[industry]);
      let name = attempt < 25 ? `${a} ${b}` : `${a} ${rng.pick(NAME_A)} ${b}`;
      name += enterprise && rng.chance(0.3) ? ' Berhad' : ' Sdn Bhd';
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
    }
    const fallback = `${rng.pick(NAME_A)} ${rng.pick(NAME_B[industry])} ${usedNames.size} Sdn Bhd`;
    usedNames.add(fallback);
    return fallback;
  };
  const newAccount = (segment: Segment, createdAt: string, ownerId?: number): Account => {
    const industry = rng.weighted(INDUSTRY_W);
    const p = SEG_PARAMS[segment];
    const acc: Account = {
      id: accounts.length + 1,
      name: companyName(industry, segment === 'enterprise'),
      industry,
      segment,
      region: rng.weighted(REGION_W),
      employees: Math.round(rng.logRange(p.employees[0], p.employees[1])),
      website: null,
      owner_id: ownerId ?? rng.pick(aesBySeg(segment)).id,
      tier:
        segment === 'enterprise'
          ? 'tier1'
          : segment === 'midmarket'
            ? rng.chance(0.2)
              ? 'tier1'
              : 'tier2'
            : rng.chance(0.15)
              ? 'tier2'
              : 'tier3',
      created_at: createdAt,
    };
    accounts.push(acc);
    return acc;
  };
  for (let i = 0; i < 140; i++) {
    newAccount(rng.weighted(SEGMENT_W), D.addDays(START, -rng.int(30, 720)));
  }
  const pickAccount = (segment: Segment, ownerId?: number): Account | undefined => {
    const pool = accounts.filter((a) => a.segment === segment && (ownerId === undefined || a.owner_id === ownerId));
    return pool.length ? rng.pick(pool) : undefined;
  };

  // Campaigns
  const campaigns: Campaign[] = [];
  const firstQ = D.quarterOf(START);
  const lastQ = D.quarterOf(D.addMonths(D.quarterOf(today).start, 3)); // include next quarter (planned)
  for (let qStart = firstQ.start, qi = 0; qStart <= lastQ.start; qStart = D.addMonths(qStart, 3), qi++) {
    const q = D.quarterOf(qStart);
    for (const channel of CHANNELS) {
      for (const tpl of CHANNEL_CFG[channel].campaigns) {
        let start = q.start;
        let end = q.end;
        if (tpl.window === 'month') {
          start = D.addMonths(q.start, 1);
          end = D.addDays(start, 27);
        }
        const budget = roundTo(rng.float(...tpl.budget) * growth(start, 0.1), 500);
        let status: Campaign['status'];
        let spend: number;
        if (end < today) {
          status = 'completed';
          spend = budget * rng.float(0.88, 1.03);
        } else if (start <= today) {
          status = 'active';
          const frac = (D.diffDays(start, today) + 1) / (D.diffDays(start, end) + 1);
          spend = budget * frac * rng.float(0.92, 1.05);
        } else {
          status = 'planned';
          spend = 0;
        }
        campaigns.push({
          id: campaigns.length + 1,
          name: tpl.name(q.label, qi),
          channel,
          start_date: start,
          end_date: end,
          budget,
          spend: roundTo(spend, 10),
          status,
        });
      }
    }
  }
  // A planned campaign has no spend; keep it at zero rather than the rounding floor.
  for (const c of campaigns) if (c.status === 'planned') c.spend = 0;

  // Deals
  const deals: Deal[] = [];
  const buildDeal = (o: {
    account: Account;
    ownerId: number;
    created: string;
    source: Source;
    type: Deal['type'];
    channel?: Channel | null;
    campaignId?: number | null;
    leadId?: number | null;
    product?: Product;
  }): Deal => {
    const p = SEG_PARAMS[o.account.segment];
    const product = o.product ?? rng.weighted(PRODUCT_W);
    const expansion = o.type === 'expansion';
    let amount =
      rng.logRange(p.amount[0], p.amount[1]) *
      growth(o.created, 0.1) *
      PRODUCT_FACTOR[product] *
      (expansion ? rng.float(0.3, 0.6) : 1);
    amount = roundTo(amount, 100);
    const winP =
      p.win +
      (o.source === 'partner' ? 0.08 : o.source === 'marketing' ? 0.03 : 0) +
      (o.channel === 'referral' ? 0.1 : 0) +
      (expansion ? 0.25 : 0);
    const cycle = Math.max(10, Math.round(rng.int(p.cycle[0], p.cycle[1]) * (expansion ? 0.6 : 1)));
    const won = rng.chance(winP);
    // The plan: every deal is expected to close after a full cycle.
    let planned = D.addDays(o.created, cycle);
    if (won && rng.chance(0.45)) {
      // End-of-quarter push: many B2B deals land in the last weeks of the quarter.
      const q = D.quarterOf(planned);
      if (D.diffDays(planned, q.end) <= 25) planned = D.addDays(q.end, -rng.int(0, 9));
    }
    if (D.diffDays(o.created, planned) < 7) planned = D.addDays(o.created, 7);
    // Losses mostly happen before the late stages, so late-stage deals win more often.
    let close = won ? planned : D.addDays(o.created, Math.round(cycle * rng.float(0.2, 0.95)));
    if (D.diffDays(o.created, close) < 7) close = D.addDays(o.created, 7);
    const span = Math.max(1, D.diffDays(o.created, planned));

    const deal: Deal = {
      id: deals.length + 1,
      name: `${shortCompany(o.account.name)} – ${PRODUCT_DEAL_NAME[product]}${expansion ? ' (Pengembangan)' : ''}`,
      account_id: o.account.id,
      owner_id: o.ownerId,
      stage: 'prospecting',
      amount,
      product,
      type: o.type,
      source: o.source,
      channel: o.channel ?? null,
      campaign_id: o.campaignId ?? null,
      lead_id: o.leadId ?? null,
      created_at: o.created,
      expected_close: won ? close : planned,
      closed_at: null,
      stage_changed_at: o.created,
      lost_reason: null,
      next_step: null,
    };
    if (close <= today) {
      deal.stage = won ? 'won' : 'lost';
      deal.closed_at = close;
      deal.expected_close = close;
      deal.stage_changed_at = close;
      if (!won) deal.lost_reason = rng.weighted(LOST_W);
    } else {
      const f = D.diffDays(o.created, today) / span;
      const idx = f < 0.25 ? 0 : f < 0.5 ? 1 : f < 0.75 ? 2 : 3;
      deal.stage = (['prospecting', 'qualification', 'proposal', 'negotiation'] as const)[idx];
      const stageStart = D.addDays(o.created, Math.round(span * [0, 0.25, 0.5, 0.75][idx]));
      deal.stage_changed_at = stageStart > today ? today : stageStart;
      deal.next_step = rng.pick(NEXT_STEP[deal.stage]);
      if (f > 0.5 && rng.chance(0.3)) deal.expected_close = D.addDays(today, -rng.int(3, 35)); // slipped
    }
    deals.push(deal);
    return deal;
  };

  // Leads (marketing) -> some convert to accounts + deals
  const leads: Lead[] = [];
  let sdrTurn = 0;
  for (const c of campaigns) {
    if (c.status === 'planned' || c.spend <= 0) continue;
    const cfg = CHANNEL_CFG[c.channel];
    const effEnd = c.end_date < today ? c.end_date : today;
    const span = D.diffDays(c.start_date, effEnd);
    const n = Math.round((c.spend / cfg.cpl) * rng.float(0.85, 1.15));
    for (let i = 0; i < n; i++) {
      const created = D.addDays(c.start_date, rng.int(0, span));
      const segment = rng.weighted(cfg.seg);
      const owner = sdrs[sdrTurn++ % sdrs.length];
      const existing = rng.chance(0.15) ? pickAccount(segment) : undefined;
      const industry = existing?.industry ?? rng.weighted(INDUSTRY_W);
      const person = personName(rng);

      let mql: string | null = null;
      let sql: string | null = null;
      let conv: string | null = null;
      if (rng.chance(cfg.mqlRate)) {
        const d = D.addDays(created, rng.int(1, 14));
        if (d <= today) mql = d;
      }
      const sqlRate = segment === 'enterprise' ? 0.42 : segment === 'midmarket' ? 0.38 : 0.33;
      if (mql && rng.chance(sqlRate)) {
        const d = D.addDays(mql, rng.int(3, 21));
        if (d <= today) sql = d;
      }
      if (sql && rng.chance(0.55)) {
        const d = D.addDays(sql, rng.int(2, 12));
        if (d <= today) conv = d;
      }
      let status: Lead['status'] = conv ? 'converted' : sql ? 'sql' : mql ? 'mql' : 'new';
      const lastStep = sql ?? mql ?? created;
      if (status !== 'converted' && D.diffDays(lastStep, today) > 45) {
        const p = status === 'new' ? 0.85 : status === 'mql' ? 0.7 : 0.5;
        if (rng.chance(p)) status = 'disqualified';
      }
      const score =
        status === 'converted'
          ? rng.int(75, 99)
          : status === 'sql'
            ? rng.int(70, 92)
            : status === 'mql'
              ? rng.int(50, 78)
              : status === 'new'
                ? rng.int(10, 48)
                : rng.int(5, 40);

      const lead: Lead = {
        id: leads.length + 1,
        name: person.name,
        email: '',
        title: rng.pick(TITLES[segment]),
        company: existing?.name ?? '',
        industry,
        segment,
        region: existing?.region ?? rng.weighted(REGION_W),
        channel: c.channel,
        campaign_id: c.id,
        status,
        score,
        owner_id: owner.id,
        account_id: existing?.id ?? null,
        deal_id: null,
        created_at: created,
        mql_at: mql,
        sql_at: sql,
        converted_at: conv,
      };
      if (conv) {
        let acc = existing;
        if (!acc) {
          acc = newAccount(segment, conv);
          acc.industry = industry;
          acc.region = lead.region;
        }
        lead.account_id = acc.id;
        lead.company = acc.name;
        const deal = buildDeal({
          account: acc,
          ownerId: acc.owner_id ?? rng.pick(aesBySeg(segment)).id,
          created: conv,
          source: 'marketing',
          type: 'new_business',
          channel: c.channel,
          campaignId: c.id,
          leadId: lead.id,
        });
        lead.deal_id = deal.id;
      } else if (!lead.company) {
        lead.company = companyName(industry, segment === 'enterprise');
      }
      const slug = shortCompany(lead.company).toLowerCase().replace(/[^a-z]+/g, '');
      lead.email = `${person.emailLocal}@${slug}.example`;
      leads.push(lead);
    }
  }

  // Sales-sourced (outbound) deals, per AE per month.
  const months = D.monthsBetween(START, today);
  const OUTBOUND_RATE: Record<Segment, number> = { enterprise: 0.9, midmarket: 1.3, smb: 1.6 };
  for (const m of months) {
    const mStart = `${m}-01`;
    const mEnd = D.monthEnd(mStart) < today ? D.monthEnd(mStart) : today;
    for (const ae of aes) {
      const seg = ae.team as Segment;
      const n = rng.poisson(OUTBOUND_RATE[seg] * growth(mStart, 0.08));
      for (let i = 0; i < n; i++) {
        const created = D.addDays(mStart, rng.int(0, D.diffDays(mStart, mEnd)));
        const acc = (rng.chance(0.7) && pickAccount(seg, ae.id)) || newAccount(seg, created, ae.id);
        buildDeal({ account: acc, ownerId: ae.id, created, source: 'sales', type: 'new_business' });
      }
    }
    // Partner-sourced deals.
    const np = rng.poisson(3.5 * growth(mStart, 0.08));
    for (let i = 0; i < np; i++) {
      const seg = rng.weighted<Segment>([['enterprise', 0.3], ['midmarket', 0.45], ['smb', 0.25]]);
      const created = D.addDays(mStart, rng.int(0, D.diffDays(mStart, mEnd)));
      const acc = (rng.chance(0.4) && pickAccount(seg)) || newAccount(seg, created);
      buildDeal({ account: acc, ownerId: acc.owner_id!, created, source: 'partner', type: 'new_business' });
    }
  }

  // Expansion deals on top of won new business.
  const accById = new Map(accounts.map((a) => [a.id, a]));
  for (const d of [...deals]) {
    if (d.stage !== 'won' || d.type !== 'new_business' || !rng.chance(0.35)) continue;
    const created = D.addDays(d.closed_at!, rng.int(60, 240));
    if (created > today) continue;
    const acc = accById.get(d.account_id)!;
    const product = rng.pick(PRODUCTS.filter((p) => p !== d.product));
    buildDeal({ account: acc, ownerId: d.owner_id, created, source: 'sales', type: 'expansion', product });
  }
  // A deal can't predate its account.
  for (const d of deals) {
    const acc = accById.get(d.account_id)!;
    if (acc.created_at > d.created_at) acc.created_at = d.created_at;
  }

  // Activities
  const activities: Activity[] = [];
  const ACT_W: [ActivityType, number][] = [
    ['email', 0.4],
    ['call', 0.3],
    ['meeting', 0.2],
    ['demo', 0.1],
  ];
  for (const d of deals) {
    const end = d.closed_at ?? today;
    const span = Math.max(1, D.diffDays(d.created_at, end));
    const n = Math.min(30, Math.max(2, Math.round((span / 8) * rng.float(0.7, 1.3))));
    for (let i = 0; i < n; i++) {
      const type = rng.weighted(ACT_W);
      activities.push({
        id: activities.length + 1,
        rep_id: d.owner_id,
        deal_id: d.id,
        account_id: d.account_id,
        lead_id: null,
        type,
        date: D.addDays(d.created_at, rng.int(0, span)),
        subject: rng.pick(ACTIVITY_SUBJECTS[type]),
      });
    }
  }
  for (const l of leads) {
    if (!l.mql_at || !l.owner_id) continue;
    const end = l.sql_at ?? D.addDays(l.mql_at, 14);
    const span = Math.max(1, D.diffDays(l.created_at, end < today ? end : today));
    const n = rng.int(2, 5);
    for (let i = 0; i < n; i++) {
      const type = rng.chance(0.55) ? 'email' : 'call';
      activities.push({
        id: activities.length + 1,
        rep_id: l.owner_id,
        deal_id: null,
        account_id: l.account_id,
        lead_id: l.id,
        type,
        date: D.addDays(l.created_at, rng.int(0, span)),
        subject: rng.pick(ACTIVITY_SUBJECTS[type]),
      });
    }
  }

  // Quotas: set per segment team from the team's realised run-rate for that year,
  // so individual reps land above or below plan depending on their own results.
  const quotas: { rep_id: number; month: string; amount: number }[] = [];
  const quotaMonths = D.monthsBetween(START, D.quarterOf(D.addMonths(D.quarterOf(today).start, 3)).end);
  const elapsedMonths = (year: string) => D.monthsBetween(START, today).filter((m) => m.startsWith(year)).length;
  for (const seg of ['enterprise', 'midmarket', 'smb'] as const) {
    const team = aesBySeg(seg);
    const teamIds = new Set(team.map((r) => r.id));
    const perRep = new Map<string, number>();
    let last = 0;
    for (const year of [...new Set(quotaMonths.map((m) => m.slice(0, 4)))]) {
      const elapsed = elapsedMonths(year);
      if (elapsed === 0) {
        perRep.set(year, last * 1.12);
        continue;
      }
      const won = deals
        .filter((d) => d.stage === 'won' && teamIds.has(d.owner_id) && d.closed_at!.startsWith(year))
        .reduce((s, d) => s + d.amount, 0);
      last = (won / team.length / elapsed) * 1.1;
      perRep.set(year, last);
    }
    for (const ae of team) {
      for (const m of quotaMonths) {
        const ramp = 0.9 + 0.2 * ((Number(m.slice(5, 7)) - 1) / 11);
        const amount = perRep.get(m.slice(0, 4))! * ramp * rng.float(0.95, 1.05);
        quotas.push({ rep_id: ae.id, month: m, amount: roundTo(amount, 1_000) });
      }
    }
  }

  // Persist
  tx(db, () => {
    clearAll(db);
    const ins = (table: string, rows: object[]) => {
      if (!rows.length) return;
      const cols = Object.keys(rows[0]);
      const stmt = db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
      for (const r of rows) stmt.run(...(cols.map((c) => (r as Record<string, unknown>)[c]) as (string | number | null)[]));
    };
    ins('reps', reps);
    ins('accounts', accounts);
    ins('campaigns', campaigns);
    ins('leads', leads);
    ins('deals', deals);
    ins('activities', activities);
    ins('quotas', quotas);
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('seeded_at', new Date().toISOString());
    meta.run('anchor_date', today);
  });

  return {
    reps: reps.length,
    accounts: accounts.length,
    campaigns: campaigns.length,
    leads: leads.length,
    deals: deals.length,
    activities: activities.length,
  };
}
