// Imports a B2B prospect list (the single-file CRM HTML export, or its JSON data) as the
// starting database: every business becomes an account and its owner/PIC a
// lead, ready to be contacted, qualified and turned into deals.
//
// Accepted input: the CRM's HTML file (with <script id="lead-data"> JSON),
// or JSON - either the lead array itself or {leads, categories}.

import { clearAll, tx, type Db } from './schema.ts';
import { INDUSTRIES, type AbmTier, type Industry, type Region, type Segment } from '../shared/constants.ts';

export interface CrmRecord {
  id?: number;
  rank?: number;
  category: string;
  categoryLabel?: string;
  name: string;
  salesText?: string;
  salesValue?: number;
  company?: string;
  region?: string;
  primaryRegion?: string;
  owner?: string;
  phone?: string;
  ratingText?: string;
  ratingValue?: number;
  website?: string;
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  threads?: string;
  youtube?: string;
  source?: string;
}

export interface CrmDataset {
  categories?: Record<string, { label: string; color?: string }>;
  leads: CrmRecord[];
}

export interface ImportSummary {
  reps: number;
  accounts: number;
  leads: number;
  /** Records dropped because the same business (name + phone) appeared earlier. */
  merged: number;
  /** Records without a business name. */
  skipped: number;
}

// ---------- Parsing ----------

function jsonBlock(html: string, id: string): unknown {
  const re = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)</script>`, 'i');
  const m = re.exec(html);
  return m ? JSON.parse(m[1]) : undefined;
}

/** Parses the CRM HTML export or a JSON dataset. Throws a readable error on anything else. */
export function parseCrmInput(text: string): CrmDataset {
  const trimmed = text.trimStart();
  let leads: unknown;
  let categories: unknown;
  if (trimmed.startsWith('<')) {
    leads = jsonBlock(text, 'lead-data');
    categories = jsonBlock(text, 'category-meta');
    if (!leads) throw new Error('No <script id="lead-data"> block found in the HTML file.');
  } else {
    const data = JSON.parse(text) as unknown;
    if (Array.isArray(data)) leads = data;
    else if (data && typeof data === 'object') {
      leads = (data as CrmDataset).leads;
      categories = (data as CrmDataset).categories;
    }
  }
  if (!Array.isArray(leads)) throw new Error('The dataset has no lead list.');
  return {
    leads: leads.filter((r): r is CrmRecord => !!r && typeof r === 'object'),
    categories: categories && typeof categories === 'object' ? (categories as CrmDataset['categories']) : undefined,
  };
}

// ---------- Mapping rules ----------

/** Account size tier from estimated sales, as in the source CRM: A >= RM1M, B >= RM300K, C below. */
export function tierOf(sales: number | undefined): Segment {
  const v = Number(sales) || 0;
  return v >= 1_000_000 ? 'enterprise' : v >= 300_000 ? 'midmarket' : 'smb';
}

const REGION_WORDS: [Region, string[]][] = [
  ['sabah', ['sabah', 'kota kinabalu', 'labuan', 'sandakan', 'tawau']],
  ['sarawak', ['sarawak', 'kuching', 'miri', 'sibu', 'bintulu']],
  ['northern', ['pulau pinang', 'penang', 'perak', 'kedah', 'perlis', 'ipoh', 'alor setar', 'langkawi', 'butterworth', 'taiping']],
  ['southern', ['johor', 'melaka', 'malacca', 'sembilan', 'seremban', 'nilai', 'muar', 'batu pahat', 'kluang']],
  ['east_coast', ['pahang', 'kelantan', 'terengganu', 'kuantan', 'kota bharu', 'temerloh']],
  [
    'klang_valley',
    [
      'kuala lumpur', 'lembah klang', 'selangor', 'putrajaya', 'cyberjaya', 'klang', 'bangi', 'kajang', 'ttdi', 'subang',
      'bangsar', 'tropicana', 'wangsa maju', 'puchong', 'ampang', 'petaling', 'kelana jaya', 'keramat', 'shah alam',
      'setia alam', 'damansara', 'cheras', 'gombak', 'rawang', 'sepang', 'serdang', 'semenyih', 'mont kiara', 'sentul',
    ],
  ],
];

/** Maps a state/town to one of the dashboard's regions; unknown places default to the Klang Valley. */
export function regionOf(primary: string | undefined, full?: string): Region {
  const p = ` ${String(primary ?? '').toLowerCase()} `;
  if (/\bkl\b/.test(p)) return 'klang_valley';
  for (const text of [p, String(full ?? '').toLowerCase()]) {
    for (const [region, words] of REGION_WORDS) if (words.some((w) => text.includes(w))) return region;
  }
  return 'klang_valley';
}

export function categoryOf(category: string | undefined): Industry {
  return (INDUSTRIES as readonly string[]).includes(category ?? '') ? (category as Industry) : 'other';
}

const TIER_POINTS: Record<Segment, number> = { enterprise: 35, midmarket: 22, smb: 10 };
const CATEGORY_FIT: Record<Industry, number> = { restoran_halal_western: 20, kafe_premium_steak_bbq: 20, penjual_perap_online: 16, other: 12 };

/** Lead score 0-100 using the source CRM's weights: size tier + rating + category fit. */
export function scoreOf(r: CrmRecord): number {
  const tier = TIER_POINTS[tierOf(r.salesValue)];
  const rating = Math.max(0, Math.min(15, (((Number(r.ratingValue) || 0) - 3.5) / 1.5) * 15));
  const fit = CATEGORY_FIT[categoryOf(r.category)];
  return Math.max(0, Math.min(100, Math.round(tier + rating + fit)));
}

const ABM_FROM_TIER: Record<Segment, AbmTier> = { enterprise: 'tier1', midmarket: 'tier2', smb: 'tier3' };

/** Only plain web links survive (no javascript: or data: URLs from imported text). */
export function safeUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

const clean = (v: unknown, max = 200): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** The starting sales team, matching the source CRM's default team. */
export const DEFAULT_TEAM: [name: string, team: Segment][] = [
  ['Pengurus Jualan', 'enterprise'],
  ['Sales 1', 'midmarket'],
  ['Sales 2', 'smb'],
];

// ---------- Import ----------

/** Replaces everything in the database with the dataset. */
export function importCrm(db: Db, dataset: CrmDataset, opts: { today: string }): ImportSummary {
  const seen = new Set<string>();
  let merged = 0;
  let skipped = 0;
  const rows: CrmRecord[] = [];
  for (const r of dataset.leads) {
    const name = clean(r.name);
    if (!name) {
      skipped++;
      continue;
    }
    const key = `${name.toLowerCase()}|${String(r.phone ?? '').replace(/\D/g, '')}`;
    if (seen.has(key)) {
      merged++;
      continue;
    }
    seen.add(key);
    rows.push(r);
  }

  return tx(db, () => {
    clearAll(db);
    const insRep = db.prepare('INSERT INTO reps (name, email, role, team, active) VALUES (?, ?, ?, ?, 1)');
    for (const [name, team] of DEFAULT_TEAM) insRep.run(name, '', 'AE', team);

    const insAccount = db.prepare(
      `INSERT INTO accounts (name, industry, segment, region, employees, website, owner_id, tier, created_at,
         legal_name, contact_name, phone, sales_estimate, rating, area, socials, source)
       VALUES (?, ?, ?, ?, 0, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insLead = db.prepare(
      `INSERT INTO leads (name, email, phone, title, company, industry, segment, region, channel, campaign_id, status,
         score, owner_id, account_id, deal_id, created_at)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'prospect_list', NULL, 'new', ?, NULL, ?, NULL, ?)`,
    );

    for (const r of rows) {
      const name = clean(r.name)!;
      const industry = categoryOf(r.category);
      const segment = tierOf(r.salesValue);
      const region = regionOf(r.primaryRegion, r.region);
      const socials: Record<string, string> = {};
      for (const k of ['facebook', 'instagram', 'tiktok', 'threads', 'youtube'] as const) {
        const u = safeUrl(r[k]);
        if (u) socials[k] = u;
      }
      const sales = Number(r.salesValue);
      const rating = Number(r.ratingValue);
      const res = insAccount.run(
        name,
        industry,
        segment,
        region,
        safeUrl(r.website),
        ABM_FROM_TIER[segment],
        opts.today,
        clean(r.company),
        clean(r.owner, 120),
        clean(r.phone, 40),
        Number.isFinite(sales) && sales > 0 ? Math.round(sales) : null,
        Number.isFinite(rating) && rating > 0 ? Math.round(rating * 10) / 10 : null,
        clean(r.region, 300),
        Object.keys(socials).length ? JSON.stringify(socials) : null,
        clean(r.source, 200),
      );
      insLead.run(
        clean(r.owner, 120) ?? name,
        clean(r.phone, 40),
        'Pemilik / PIC',
        name,
        industry,
        segment,
        region,
        scoreOf(r),
        Number(res.lastInsertRowid),
        opts.today,
      );
    }
    const meta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    meta.run('seeded_at', new Date().toISOString());
    meta.run('anchor_date', opts.today);
    meta.run('base', 'crm');
    return { reps: DEFAULT_TEAM.length, accounts: rows.length, leads: rows.length, merged, skipped };
  });
}

/** A short, stable fingerprint of a dataset (changes when its content changes). */
export function datasetFingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}
