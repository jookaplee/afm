// One cycle of the AI lead agent: verify the accounts the API hands out, look
// for new leads, and post the results back. Claude does the research with the
// server-side web search and web fetch tools and reports through a strict
// client tool, so its output is schema-checked JSON. Runs in the browser
// (the user's own API key) and on the Node server (ANTHROPIC_API_KEY).

import Anthropic from '@anthropic-ai/sdk';
import {
  AGENT_FIELDS,
  CATEGORY_BRIEF,
  CONFIDENCES,
  DISCOVER_SYSTEM,
  DISCOVER_TOOL,
  REGION_BRIEF,
  VERIFY_SYSTEM,
  VERIFY_TOOL,
  cleanSources,
  cleanUrl,
  cleanValue,
  discoverPrompt,
  verifyPrompt,
  type AgentPlan,
  type AgentRunInput,
  type AgentRunSummary,
  type Candidate,
  type Confidence,
  type DiscoverTarget,
  type FoundValue,
  type SizeHint,
  type VerifyResult,
} from './agent.ts';

type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaMessage = Anthropic.Beta.Messages.BetaMessage;
type BetaToolUnion = Anthropic.Beta.Messages.BetaToolUnion;

/** The API surface the agent needs (the HTTP server or the in-browser API). */
export interface AgentApi {
  get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}

export interface AgentProgress {
  step: 'plan' | 'verify' | 'discover' | 'save';
  label?: string;
  done: number;
  total: number;
}

export interface CycleOutcome {
  /** null when there was nothing to do (all checked recently, or the daily limit reached). */
  summary: AgentRunSummary | null;
  error: string | null;
  /** The cycle stopped because of the key or quota, not a single account. */
  fatal: boolean;
}

interface Tally {
  calls: number;
  searches: number;
  input: number;
  output: number;
}

/** Errors the user should see as such (bad key, no credit, rate limit). */
function fatalReason(e: unknown): string | null {
  if (e instanceof Anthropic.AuthenticationError) return 'auth';
  if (e instanceof Anthropic.PermissionDeniedError) return 'permission';
  if (e instanceof Anthropic.RateLimitError) return 'rate_limit';
  if (e instanceof Anthropic.BadRequestError && /credit|billing|balance/i.test(e.message)) return 'billing';
  return null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

function webTools(model: string, searches: number, fetches: number): BetaToolUnion[] {
  const location = { type: 'approximate' as const, country: 'MY', timezone: 'Asia/Kuala_Lumpur' };
  // Haiku keeps the basic search tool; dynamic filtering needs the newer models.
  if (model.startsWith('claude-haiku')) return [{ type: 'web_search_20250305', name: 'web_search', max_uses: searches, user_location: location }];
  return [
    { type: 'web_search_20260209', name: 'web_search', max_uses: searches, user_location: location },
    { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: fetches },
  ];
}

/** URLs Claude actually opened or saw in search results during the request. */
function seenUrls(msg: BetaMessage): string[] {
  const out: string[] = [];
  for (const b of msg.content) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) if (r.type === 'web_search_result') out.push(r.url);
    } else if (b.type === 'web_fetch_tool_result' && b.content.type === 'web_fetch_result') {
      out.push(b.content.url);
    }
  }
  return out;
}

/**
 * Asks Claude to research with the web tools and report through `tool`.
 * Handles paused server-tool turns and a model that stops without reporting.
 */
async function research(
  client: Anthropic,
  model: string,
  system: string,
  user: string,
  tool: typeof VERIFY_TOOL | typeof DISCOVER_TOOL,
  limits: { searches: number; fetches: number },
  tally: Tally,
  signal?: AbortSignal,
): Promise<{ input: Record<string, unknown>; urls: string[] }> {
  const tools: BetaToolUnion[] = [...webTools(model, limits.searches, limits.fetches), tool as BetaToolUnion];
  // Server-side fallback when a safety classifier declines (Opus/Sonnet 5.5 only).
  const fallback = model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  let messages: BetaMessageParam[] = [{ role: 'user', content: user }];
  const urls: string[] = [];
  let nudged = false;
  tally.calls += 1;
  for (let turn = 0; turn < 6; turn++) {
    const res = await client.beta.messages.create(
      {
        model,
        max_tokens: 16000,
        system,
        messages,
        tools,
        output_config: { effort: 'medium' },
        cache_control: { type: 'ephemeral' },
        ...fallback,
      },
      { signal },
    );
    const u = res.usage;
    tally.input += (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    tally.output += u.output_tokens ?? 0;
    tally.searches += u.server_tool_use?.web_search_requests ?? 0;
    urls.push(...seenUrls(res));

    const report = res.content.find((b) => b.type === 'tool_use' && b.name === tool.name);
    if (report && report.type === 'tool_use') return { input: report.input as Record<string, unknown>, urls };
    if (res.stop_reason === 'pause_turn') {
      // A long server-tool turn: send it back as is and the server resumes it.
      messages = [...messages, { role: 'assistant', content: res.content }];
      continue;
    }
    if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
    if (res.stop_reason === 'max_tokens') throw new Error('The answer was cut off (max_tokens)');
    if (nudged) break;
    nudged = true;
    messages = [
      ...messages,
      { role: 'assistant', content: res.content },
      { role: 'user', content: `Call ${tool.name} now with what you found (null for anything you could not confirm).` },
    ];
  }
  throw new Error('Claude did not report a result');
}

const asConfidence = (v: unknown): Confidence => (CONFIDENCES.includes(v as Confidence) ? (v as Confidence) : 'low');
const asText = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function toVerifyResult(accountId: number, input: Record<string, unknown>, urls: string[] = []): VerifyResult {
  const raw = (input.fields && typeof input.fields === 'object' ? input.fields : {}) as Record<string, unknown>;
  const fields: VerifyResult['fields'] = {};
  for (const f of AGENT_FIELDS) {
    const v = raw[f] as Partial<FoundValue> | null | undefined;
    if (!v || typeof v !== 'object') continue;
    const value = cleanValue(f, typeof v.value === 'string' ? v.value : null);
    const source = cleanUrl(typeof v.source === 'string' ? v.source : null);
    if (value && source) fields[f] = { value, source, confidence: asConfidence(v.confidence) };
  }
  const operating = input.operating === 'yes' || input.operating === 'no' ? input.operating : 'unknown';
  return {
    account_id: accountId,
    found: input.found !== false,
    operating,
    operating_source: cleanUrl(typeof input.operating_source === 'string' ? input.operating_source : null),
    fields,
    summary: asText(input.summary, 600),
    sources: cleanSources([...(Array.isArray(input.sources) ? input.sources : []), ...urls]),
  };
}

export function toCandidates(target: DiscoverTarget, input: Record<string, unknown>): Candidate[] {
  const out: Candidate[] = [];
  for (const raw of Array.isArray(input.leads) ? input.leads : []) {
    const r = raw as Record<string, unknown>;
    const name = asText(r.name, 160);
    const sources = cleanSources(r.sources);
    const s = (k: 'phone' | 'email' | 'website' | 'facebook' | 'instagram' | 'tiktok' | 'address' | 'contact_name' | 'legal_name') =>
      cleanValue(k, typeof r[k] === 'string' ? (r[k] as string) : null);
    const c: Candidate = {
      name,
      legal_name: s('legal_name'),
      category: target.category,
      state: asText(r.state, 60) || null,
      area: asText(r.area, 120) || null,
      address: s('address'),
      phone: s('phone'),
      contact_name: s('contact_name'),
      email: s('email'),
      website: s('website'),
      facebook: s('facebook'),
      instagram: s('instagram'),
      tiktok: s('tiktok'),
      rating: typeof r.rating === 'number' && r.rating > 0 && r.rating <= 5 ? Math.round(r.rating * 10) / 10 : null,
      size: (['large', 'medium', 'small'] as SizeHint[]).includes(r.size as SizeHint) ? (r.size as SizeHint) : null,
      why: asText(r.why, 300),
      confidence: asConfidence(r.confidence),
      sources,
    };
    // Unusable without a name, a source and some way to reach the business.
    if (c.name && sources.length && (c.phone || c.website || c.facebook || c.instagram || c.tiktok)) out.push(c);
  }
  return out;
}

/**
 * Runs one cycle. `accountId` checks just that account (a manual "check now"),
 * `discover: false` skips looking for new leads.
 */
export async function runAgentCycle(o: {
  client: Anthropic;
  api: AgentApi;
  today: string;
  now: () => string;
  accountId?: number;
  discover?: boolean;
  signal?: AbortSignal;
  onProgress?: (p: AgentProgress) => void;
}): Promise<CycleOutcome> {
  const started = o.now();
  o.onProgress?.({ step: 'plan', done: 0, total: 0 });
  const plan = await o.api.get<AgentPlan>('/agent/plan', { accountId: o.accountId });
  const { settings } = plan;
  const target = o.discover === false ? null : plan.discover;
  const total = plan.accounts.length + (target ? 1 : 0);
  if (!total) return { summary: null, error: null, fatal: false };

  const tally: Tally = { calls: 0, searches: 0, input: 0, output: 0 };
  const results: VerifyResult[] = [];
  let candidates: Candidate[] = [];
  const errors: string[] = [];
  let fatal: string | null = null;
  let done = 0;

  for (const a of plan.accounts) {
    if (o.signal?.aborted) break;
    o.onProgress?.({ step: 'verify', label: a.name, done, total });
    try {
      const { input, urls } = await research(
        o.client,
        settings.model,
        VERIFY_SYSTEM,
        verifyPrompt(a, o.today, { category: CATEGORY_BRIEF[a.industry], region: REGION_BRIEF[a.region] }),
        VERIFY_TOOL,
        { searches: 6, fetches: 4 },
        tally,
        o.signal,
      );
      results.push(toVerifyResult(a.id, input, urls));
    } catch (e) {
      if (o.signal?.aborted) break;
      fatal = fatalReason(e);
      errors.push(`${a.name}: ${errorText(e)}`);
      if (fatal) break;
    }
    done++;
  }

  if (target && !fatal && !o.signal?.aborted) {
    o.onProgress?.({ step: 'discover', label: CATEGORY_BRIEF[target.category], done, total });
    try {
      const { input } = await research(
        o.client,
        settings.model,
        DISCOVER_SYSTEM,
        discoverPrompt(target, settings.discoverPerCycle, o.today),
        DISCOVER_TOOL,
        { searches: 8, fetches: 6 },
        tally,
        o.signal,
      );
      candidates = toCandidates(target, input).slice(0, settings.discoverPerCycle);
    } catch (e) {
      if (!o.signal?.aborted) {
        fatal = fatalReason(e);
        errors.push(`discover: ${errorText(e)}`);
      }
    }
    done++;
  }

  // Nothing reached Claude (stopped before the first call): record nothing.
  if (!tally.calls) return { summary: null, error: errors[0] ?? null, fatal: !!fatal };

  o.onProgress?.({ step: 'save', done, total });
  const body: AgentRunInput = {
    kind: plan.accounts.length && target ? 'cycle' : target ? 'discover' : 'verify',
    started_at: started,
    finished_at: o.now(),
    model: settings.model,
    calls: tally.calls,
    searches: tally.searches,
    input_tokens: tally.input,
    output_tokens: tally.output,
    error: errors.length ? errors.join(' · ').slice(0, 1000) : null,
    results,
    candidates,
  };
  const summary = await o.api.post<AgentRunSummary>('/agent/runs', body);
  return { summary, error: fatal ?? (errors[0] || null), fatal: !!fatal };
}
