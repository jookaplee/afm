// Server-side autopilot for the AI lead agent: when ANTHROPIC_API_KEY is set,
// the server runs a cycle every `intervalMin` minutes (agent settings), so the
// data keeps being checked even when nobody has the dashboard open.

import Anthropic from '@anthropic-ai/sdk';
import type { Db } from './schema.ts';
import { createRouter } from './routes.ts';
import { getSettings } from './agent-store.ts';
import { runAgentCycle, type AgentApi } from '../shared/agent-runner.ts';

export interface ServerAgent {
  start: (accountId?: number) => { started: boolean; running: boolean };
  startAutopilot: () => void;
  stop: () => void;
}

export function createServerAgent(o: { db: Db; today: () => string; client?: Anthropic; log?: (msg: string) => void }): ServerAgent {
  const log = o.log ?? ((m: string) => console.log(`[agent] ${m}`));
  // Reads ANTHROPIC_API_KEY (or another configured credential) from the environment.
  const client = o.client ?? new Anthropic();
  const { handle } = createRouter({ db: o.db, today: o.today });
  const call = async <T>(method: string, path: string, query: Record<string, unknown>, body?: unknown): Promise<T> => {
    const res = handle(method, path, query, body);
    if (res.status >= 400) throw new Error(`${method} ${path}: ${JSON.stringify(res.body)}`);
    return res.body as T;
  };
  const api: AgentApi = {
    get: (path, params) => call('GET', path, Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))),
    post: (path, body) => call('POST', path, {}, body),
  };

  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function cycle(accountId?: number) {
    if (running) return;
    running = true;
    try {
      const out = await runAgentCycle({ client, api, today: o.today(), now: () => new Date().toISOString(), accountId });
      if (out.summary) {
        const s = out.summary;
        log(`checked ${s.checked}, ${s.findings} to review, ${s.auto} filled, ${s.new_leads} new leads${out.error ? ` (${out.error})` : ''}`);
      } else if (out.error) log(`stopped: ${out.error}`);
    } catch (e) {
      log(`failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  }

  function schedule() {
    if (stopped) return;
    const minutes = getSettings(o.db).intervalMin;
    timer = setTimeout(async () => {
      if (getSettings(o.db).autopilot) await cycle();
      schedule();
    }, minutes * 60_000);
    timer.unref?.();
  }

  return {
    start(accountId) {
      const started = !running;
      if (started) void cycle(accountId);
      return { started, running: true };
    },
    startAutopilot() {
      log(`autopilot on (every ${getSettings(o.db).intervalMin} min while enabled in the agent settings)`);
      schedule();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
