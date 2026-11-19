// WhatsApp Business Platform (Cloud API) connection: Meta delivers incoming
// messages and delivery reports to the webhook; replies go out through the
// Graph API. The WhatsApp agent answers each conversation a few seconds after
// the customer's last message (so a burst of messages gets one reply), and its
// reply is either sent straight away (autoSend) or kept as a draft for a person.
//
// Environment: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
// WHATSAPP_VERIFY_TOKEN, optional WHATSAPP_API_VERSION; ANTHROPIC_API_KEY for the agent.

import { createHmac, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import type { Db } from './schema.ts';
import { HttpError } from './http.ts';
import { createRouter } from './routes.ts';
import { getAgentSettings, updateStatusByWaId } from './whatsapp-store.ts';
import { runWaAgent, type WaAgentApi, type WaAgentOutcome } from '../shared/wa-agent.ts';
import { phoneInfo } from '../shared/whatsapp.ts';
import type { WaMessageRow } from '../shared/types.ts';

export interface WaLiveConfig {
  token?: string;
  phoneNumberId?: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion?: string;
  /** An Anthropic credential is configured: the server runs the agent. */
  agent: boolean;
}

export interface WaLive {
  live: boolean;
  agentServer: boolean;
  /** GET webhook check: the challenge to echo, or null to refuse. */
  verify: (query: Record<string, unknown>) => string | null;
  /** POST webhook: returns the HTTP status to answer with. */
  handleWebhook: (raw: Buffer, signature: string | undefined) => Promise<number>;
  /** Sends text to a lead (or an existing draft) through the Business API. */
  send: (leadId: number, body: string, o?: { author?: 'user' | 'agent'; draftId?: number; templateId?: number | null }) => Promise<WaMessageRow>;
  /** Runs the agent on one conversation now. */
  runAgent: (leadId: number) => Promise<WaAgentOutcome | null>;
  stop: () => void;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Text of an incoming message of any type (media become a short label, with a caption if any). */
function messageText(m: Record<string, unknown>): string {
  const type = String(m.type ?? 'text');
  const part = (m[type] ?? {}) as Record<string, unknown>;
  if (type === 'text') return String(part.body ?? '');
  if (type === 'button') return String(part.text ?? '');
  if (type === 'interactive') {
    const r = (part.button_reply ?? part.list_reply ?? {}) as Record<string, unknown>;
    return String(r.title ?? '[interactive]');
  }
  if (type === 'location') return `[lokasi] ${part.name ?? ''} ${part.address ?? ''} ${part.latitude ?? ''},${part.longitude ?? ''}`.trim();
  const label: Record<string, string> = { image: 'gambar', audio: 'audio', video: 'video', document: 'dokumen', sticker: 'pelekat', contacts: 'kenalan' };
  return `[${label[type] ?? type}]${part.caption ? ` ${part.caption}` : ''}`;
}

export function createWaLive(o: {
  db: Db;
  today: () => string;
  config: WaLiveConfig;
  client?: Anthropic;
  fetchImpl?: typeof fetch;
  debounceMs?: number;
  log?: (msg: string) => void;
}): WaLive {
  const { db, config } = o;
  const log = o.log ?? ((m: string) => console.log(`[whatsapp] ${m}`));
  const live = !!(config.token && config.phoneNumberId && config.appSecret);
  const agentServer = config.agent;
  const fetchImpl = o.fetchImpl ?? fetch;
  const version = config.apiVersion || 'v23.0';
  const client = agentServer ? (o.client ?? new Anthropic()) : null;
  const { handle } = createRouter({ db, today: o.today });

  const call = (method: string, path: string, body?: unknown, query: Record<string, unknown> = {}) => {
    const r = handle(method, path, query, body);
    if (r.status >= 400) {
      const b = r.body as { error?: string; details?: { fields?: Record<string, string> } } | undefined;
      const e = new HttpError(r.status, b?.error ?? 'Error', b?.details);
      (e as Error & { fields?: Record<string, string> }).fields = b?.details?.fields;
      throw e;
    }
    return r.body;
  };
  const api: WaAgentApi = {
    get: async (path, params) => call('GET', path, undefined, Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined))) as never,
    post: async (path, body) => call('POST', path, body) as never,
    patch: async (path, body) => call('PATCH', path, body) as never,
  };

  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const busy = new Set<number>();
  const again = new Set<number>();

  function verify(query: Record<string, unknown>): string | null {
    if (!config.verifyToken) return null;
    if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === config.verifyToken) return String(query['hub.challenge'] ?? '');
    return null;
  }

  /** Meta signs each delivery with the app secret (X-Hub-Signature-256). */
  function signed(raw: Buffer, header: string | undefined): boolean {
    if (!config.appSecret || !header?.startsWith('sha256=')) return false;
    const want = Buffer.from(createHmac('sha256', config.appSecret).update(raw).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return want.length === got.length && timingSafeEqual(want, got);
  }

  function schedule(leadId: number) {
    if (!agentServer) return;
    const old = timers.get(leadId);
    if (old) clearTimeout(old);
    const t = setTimeout(() => {
      timers.delete(leadId);
      void runAgent(leadId).catch((e) => log(`agent failed for lead ${leadId}: ${e instanceof Error ? e.message : e}`));
    }, o.debounceMs ?? 4000);
    t.unref?.();
    timers.set(leadId, t);
  }

  async function handleWebhook(raw: Buffer, signature: string | undefined): Promise<number> {
    if (!live) return 404;
    if (!signed(raw, signature)) return 401;
    let payload: { entry?: { changes?: { value?: Record<string, unknown> }[] }[] };
    try {
      payload = JSON.parse(raw.toString('utf8'));
    } catch {
      return 400;
    }
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value ?? {};
        // Only our own number's traffic.
        const meta = value.metadata as { phone_number_id?: string } | undefined;
        if (meta?.phone_number_id && meta.phone_number_id !== config.phoneNumberId) continue;
        const contacts = (value.contacts as { wa_id?: string; profile?: { name?: string } }[] | undefined) ?? [];
        for (const m of (value.messages as Record<string, unknown>[] | undefined) ?? []) {
          const from = String(m.from ?? '');
          const name = contacts.find((c) => c.wa_id === from)?.profile?.name ?? null;
          const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
          try {
            const r = call('POST', '/wa/inbound', { phone: `+${from}`, name, body: messageText(m) || '[mesej]', wa_id: m.id, at }) as { lead_id: number; duplicate: boolean };
            if (!r.duplicate) schedule(r.lead_id);
          } catch (e) {
            log(`could not record a message from ${from}: ${e instanceof Error ? e.message : e}`);
          }
        }
        for (const s of (value.statuses as { id?: string; status?: string; errors?: { title?: string; message?: string }[] }[] | undefined) ?? []) {
          if (s.id && s.status) updateStatusByWaId(db, s.id, s.status, s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null);
        }
      }
    }
    return 200;
  }

  async function send(leadId: number, body: string, opts: { author?: 'user' | 'agent'; draftId?: number; templateId?: number | null } = {}): Promise<WaMessageRow> {
    if (!live) throw new HttpError(409, 'WhatsApp Business API is not connected');
    const lead = db.prepare('SELECT id, phone, wa_last_in_at FROM leads WHERE id = ?').get(leadId) as { id: number; phone: string | null; wa_last_in_at: string | null } | undefined;
    if (!lead) throw new HttpError(404, 'Not found');
    const intl = phoneInfo(lead.phone).intl;
    if (!intl) throw new HttpError(400, 'Validation failed', { fields: { phone: 'invalid' } });
    // Free text is allowed only within 24 hours of the customer's last message.
    const last = lead.wa_last_in_at ? Date.parse(lead.wa_last_in_at) : NaN;
    if (!Number.isFinite(last) || Date.now() - last > WINDOW_MS) throw new HttpError(409, 'window_closed');
    const text = body.trim();
    if (!text) throw new HttpError(400, 'Validation failed', { fields: { body: 'required' } });
    const now = () => new Date().toISOString();
    let msg: WaMessageRow;
    if (opts.draftId) {
      call('PATCH', `/wa/messages/${opts.draftId}`, { body: text });
      msg = call('PATCH', `/wa/messages/${opts.draftId}`, { status: 'queued', at: now() }) as WaMessageRow;
    } else {
      msg = call('POST', '/wa/messages', { lead_id: leadId, body: text, author: opts.author ?? 'user', status: 'queued', template_id: opts.templateId ?? null, at: now() }) as WaMessageRow;
    }
    try {
      const res = await fetchImpl(`https://graph.facebook.com/${version}/${config.phoneNumberId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: intl, type: 'text', text: { preview_url: false, body: text } }),
      });
      const data = (await res.json().catch(() => ({}))) as { messages?: { id?: string }[]; error?: { message?: string } };
      if (!res.ok || !data.messages?.[0]?.id) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
      return call('PATCH', `/wa/messages/${msg.id}`, { status: 'sent', wa_id: data.messages[0].id }) as WaMessageRow;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log(`send to lead ${leadId} failed: ${error}`);
      return call('PATCH', `/wa/messages/${msg.id}`, { status: 'failed', error }) as WaMessageRow;
    }
  }

  async function runAgent(leadId: number): Promise<WaAgentOutcome | null> {
    if (!client) return null;
    // One run per conversation at a time; messages that arrive meanwhile get a second pass.
    if (busy.has(leadId)) {
      again.add(leadId);
      return null;
    }
    busy.add(leadId);
    try {
      const out = await runWaAgent({ client, api, leadId });
      if (out.reply) {
        const settings = getAgentSettings(db);
        if (live && settings.autoSend) {
          try {
            await send(leadId, out.reply, { author: 'agent' });
          } catch {
            // Outside the 24-hour window, or sending failed before it started: keep it as a draft.
            call('POST', '/wa/messages', { lead_id: leadId, body: out.reply, author: 'agent', status: 'draft' });
          }
        } else {
          call('POST', '/wa/messages', { lead_id: leadId, body: out.reply, author: 'agent', status: 'draft' });
        }
      }
      if (out.skipped === null) log(`lead ${leadId}: ${out.reply ? 'replied' : 'no reply'}${out.orders.length ? `, orders ${out.orders.join(',')}` : ''}${out.handoff ? ', handed off' : ''}`);
      return out;
    } finally {
      busy.delete(leadId);
      if (again.delete(leadId)) schedule(leadId);
    }
  }

  return {
    live,
    agentServer,
    verify,
    handleWebhook,
    send,
    runAgent,
    stop: () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
