// Helpers for writing a WhatsApp message to a lead: template placeholders and
// an optional AI draft (the user's own Anthropic key, as for the AI agent).

import type { Region } from '../../../shared/constants.ts';
import type { WaStatus } from '../../../shared/types.ts';
import type { WaPlaceholder, WaSettings } from '../../../shared/whatsapp.ts';
import type { TFn } from '../lib/i18n.tsx';
import { agentEngine, getApiKey } from '../agent/engine.ts';

/** Whom a message goes to (a WhatsApp contact row or a lead). */
export interface WaTarget {
  lead_id: number;
  name: string;
  company: string;
  phone: string | null;
  region: Region;
  area?: string | null;
  account_id?: number | null;
  wa_status?: WaStatus | null;
  industry?: string;
  /** The AI agent's latest summary of the business, if any. */
  note?: string | null;
}

/** A short place name for {kawasan}: the account's area when it is short, else the region. */
function place(target: WaTarget, t: TFn): string {
  const area = target.area?.trim();
  if (area && area.length <= 30 && (area.match(/,/g) ?? []).length <= 1) return area;
  return t(`region.${target.region}`);
}

export function templateVars(target: WaTarget, settings: WaSettings, t: TFn): Record<WaPlaceholder, string> {
  return {
    nama: target.name,
    perniagaan: target.company,
    kawasan: place(target, t),
    nama_saya: settings.myName,
    syarikat_saya: settings.company,
  };
}

const SYSTEM = `You write WhatsApp messages for a B2B salesperson at a Malaysian supplier of halal frozen meat and seafood (beef, lamb, chicken, seafood) to restaurants, cafés and food sellers.
Write in Bahasa Melayu (Malaysia): friendly and polite, two to four short sentences, plain text, at most one emoji, no hashtags or links.
Personalise it to the business from the details given, and sign with the sender's name and company when they are given.
Reply with the message text only.`;

/** Asks Claude for a personalised draft. Throws "no_key" when no API key is set. */
export async function aiDraft(o: { target: WaTarget; settings: WaSettings; template: string | null; t: TFn; catName: (key: string) => string }): Promise<string> {
  const key = getApiKey();
  if (!key) throw new Error('no_key');
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const model = agentEngine.getState().summary?.settings.model ?? 'claude-opus-5-5';
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const details = {
    business: o.target.company,
    contact_name: o.target.name,
    category: o.target.industry ? o.catName(o.target.industry) : null,
    area: place(o.target, o.t),
    notes: o.target.note ?? null,
    sender_name: o.settings.myName || null,
    sender_company: o.settings.company || null,
  };
  const user = `Lead details:\n${JSON.stringify(details, null, 2)}${o.template ? `\n\nStart from this template and keep its purpose:\n${o.template}` : ''}`;
  const res = await client.beta.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low' },
    // Server-side fallback when a safety classifier declines (Opus/Sonnet 5.5 only).
    ...(model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
  });
  if (res.stop_reason === 'refusal') throw new Error('Claude declined this request');
  const text = res.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
  if (!text) throw new Error('Empty draft');
  return text;
}
