// Runs the WhatsApp agent on one conversation: on the server when it has its
// own key, otherwise in this browser with the key from the AI agent page.
// Keeps a small "typing…" state per conversation for the chat screens.

import { useSyncExternalStore } from 'react';
import { api } from '../lib/api.ts';
import { IN_CLAUDE_VIEWER } from '../lib/env.ts';
import { getApiKey } from '../agent/engine.ts';
import type { WaSummary } from '../../../shared/types.ts';
import type { WaAgentOutcome } from '../../../shared/wa-agent.ts';

const typing = new Set<number>();
const listeners = new Set<() => void>();
let snapshot: ReadonlySet<number> = new Set();
const emit = () => {
  snapshot = new Set(typing);
  for (const fn of listeners) fn();
};

export function useAgentTyping(): ReadonlySet<number> {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => snapshot,
  );
}

/** Where the agent can run for this page, if anywhere. */
export function agentWhere(s: WaSummary | undefined): 'server' | 'browser' | null {
  if (s?.agentServer) return 'server';
  if (!IN_CLAUDE_VIEWER && getApiKey()) return 'browser';
  return null;
}

/**
 * Lets the agent answer the conversation's latest messages. Its reply is saved
 * as a draft here (the server sends it itself when auto-send is on).
 */
export async function answerConversation(leadId: number, s: WaSummary | undefined): Promise<WaAgentOutcome | null> {
  const where = agentWhere(s);
  if (!where || typing.has(leadId)) return null;
  typing.add(leadId);
  emit();
  try {
    if (where === 'server') return await api.post<WaAgentOutcome>('/wa/agent/run', { lead_id: leadId });
    const [{ default: Anthropic }, { runWaAgent }] = await Promise.all([import('@anthropic-ai/sdk'), import('../../../shared/wa-agent.ts')]);
    const client = new Anthropic({ apiKey: getApiKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
    const out = await runWaAgent({
      client,
      api: { get: (p, params) => api.get(p, params), post: (p, b) => api.post(p, b), patch: (p, b) => api.patch(p, b) },
      leadId,
    });
    if (out.reply) await api.post('/wa/messages', { lead_id: leadId, body: out.reply, author: 'agent', status: 'draft', at: new Date().toISOString() });
    return out;
  } finally {
    typing.delete(leadId);
    emit();
  }
}
