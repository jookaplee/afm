// Runs the AI lead agent from the browser: on a timer while the dashboard is
// open (autopilot) and on demand. Claude is called with the user's own
// Anthropic API key, kept only in this browser. Where the server runs the
// agent itself (ANTHROPIC_API_KEY on the server), this only starts it.

import { useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';
import { IN_CLAUDE_VIEWER } from '../lib/env.ts';
import { load, save } from '../lib/storage.ts';
import { todayLocal } from '../../../shared/dates.ts';
import type { AgentSummary } from '../../../shared/types.ts';
import type { AgentProgress, CycleOutcome } from '../../../shared/agent-runner.ts';

/** Where cycles run: this browser, the server, or nowhere (a claude.ai page cannot reach the web). */
export type Runner = 'browser' | 'server' | 'none';

export interface AgentState {
  runner: Runner;
  hasKey: boolean;
  summary: AgentSummary | null;
  running: boolean;
  progress: AgentProgress | null;
  /** The last cycle run from this tab. */
  last: { at: string; outcome: CycleOutcome | null; error: string | null } | null;
  /** Autopilot stopped after a key/quota problem until the key or settings change. */
  blocked: string | null;
  nextAt: number | null;
  /** Bumped after every cycle and decision, so pages refetch. */
  version: number;
}

const KEY_STORE = 'joosons.anthropicKey';
const LOCK = 'joosons.agentLock';
const FIRST_DELAY = 45_000;

export const getApiKey = () => load(KEY_STORE) ?? '';

function tabId() {
  return Math.random().toString(36).slice(2);
}

class AgentEngine {
  private state: AgentState = {
    runner: IN_CLAUDE_VIEWER ? 'none' : 'browser',
    hasKey: !!getApiKey(),
    summary: null,
    running: false,
    progress: null,
    last: null,
    blocked: null,
    nextAt: null,
    version: 0,
  };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private abort: AbortController | null = null;
  private id = tabId();
  private started = false;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;

  private set(patch: Partial<AgentState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  /** Called once by the app shell: loads the summary and starts the autopilot timer. */
  boot() {
    if (this.started) return;
    this.started = true;
    void this.refresh();
  }

  async refresh() {
    try {
      const summary = await api.get<AgentSummary>('/agent/summary');
      const runner: Runner = summary.serverAgent ? 'server' : IN_CLAUDE_VIEWER ? 'none' : 'browser';
      this.set({ summary, runner, hasKey: !!getApiKey() });
    } catch {
      /* the page shows its own error */
    }
    this.reschedule();
  }

  /** A decision or settings change elsewhere: refetch everything that depends on agent data. */
  touched() {
    this.set({ version: this.state.version + 1 });
    void this.refresh();
  }

  setApiKey(key: string | null) {
    save(KEY_STORE, key && key.trim() ? key.trim() : null);
    this.set({ hasKey: !!getApiKey(), blocked: null });
    this.reschedule();
  }

  unblock() {
    this.set({ blocked: null });
    this.reschedule();
  }

  private reschedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.state;
    const auto = s.summary?.settings.autopilot;
    if (s.runner !== 'browser' || !s.hasKey || !auto || s.blocked || s.running) {
      if (s.nextAt !== null) this.set({ nextAt: null });
      return;
    }
    // Keep to the interval since the last recorded cycle (from any tab or device),
    // so reopening the dashboard does not trigger extra cycles.
    const interval = (s.summary?.settings.intervalMin ?? 20) * 60_000;
    const lastRun = Date.parse(s.summary?.lastRun?.finished_at ?? '');
    const due = Number.isFinite(lastRun) ? lastRun + interval : Date.now() + FIRST_DELAY;
    const nextAt = Math.max(due, Date.now() + FIRST_DELAY);
    const delay = nextAt - Date.now();
    this.timer = setTimeout(() => void this.run({ auto: true }), delay);
    this.set({ nextAt });
  }

  /** One tab at a time runs the autopilot. */
  private takeLock(): boolean {
    try {
      const cur = JSON.parse(load(LOCK) ?? 'null') as { id: string; until: number } | null;
      if (cur && cur.id !== this.id && cur.until > Date.now()) return false;
    } catch {
      /* stale or unreadable: take it */
    }
    save(LOCK, JSON.stringify({ id: this.id, until: Date.now() + 15 * 60_000 }));
    return true;
  }

  private dropLock() {
    try {
      const cur = JSON.parse(load(LOCK) ?? 'null') as { id: string } | null;
      if (cur?.id === this.id) save(LOCK, null);
    } catch {
      save(LOCK, null);
    }
  }

  async run(o: { accountId?: number; discover?: boolean; auto?: boolean } = {}) {
    const s = this.state;
    if (s.running) return;
    if (s.runner === 'server') return this.runOnServer(o.accountId);
    if (s.runner !== 'browser' || !getApiKey()) return;
    if (o.auto && !this.takeLock()) {
      this.reschedule();
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.abort = new AbortController();
    this.set({ running: true, progress: null, nextAt: null });
    const at = new Date().toISOString();
    try {
      const [{ default: Anthropic }, { runAgentCycle }] = await Promise.all([import('@anthropic-ai/sdk'), import('../../../shared/agent-runner.ts')]);
      const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
      const outcome = await runAgentCycle({
        client,
        api: { get: (path, params) => api.get(path, params), post: (path, body) => api.post(path, body) },
        today: todayLocal(),
        now: () => new Date().toISOString(),
        accountId: o.accountId,
        discover: o.discover,
        signal: this.abort.signal,
        onProgress: (progress) => this.set({ progress }),
      });
      this.set({ last: { at, outcome, error: outcome.error }, blocked: outcome.fatal ? outcome.error : null });
    } catch (e) {
      this.set({ last: { at, outcome: null, error: e instanceof Error ? e.message : String(e) } });
    } finally {
      this.dropLock();
      this.abort = null;
      this.set({ running: false, progress: null, version: this.state.version + 1 });
      await this.refresh();
    }
  }

  /** Server-side agent: start a cycle and watch for its run to appear. */
  private async runOnServer(accountId?: number) {
    const before = this.state.summary?.lastRun?.id ?? 0;
    this.set({ running: true, progress: null });
    try {
      await api.post('/agent/start', { accountId });
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const summary = await api.get<AgentSummary>('/agent/summary');
        this.set({ summary });
        if ((summary.lastRun?.id ?? 0) !== before) break;
      }
    } catch (e) {
      this.set({ last: { at: new Date().toISOString(), outcome: null, error: e instanceof Error ? e.message : String(e) } });
    } finally {
      this.set({ running: false, version: this.state.version + 1 });
      await this.refresh();
    }
  }

  stop() {
    this.abort?.abort();
  }
}

export const agentEngine = new AgentEngine();

export function useAgent(): AgentState {
  return useSyncExternalStore(agentEngine.subscribe, agentEngine.getState);
}
