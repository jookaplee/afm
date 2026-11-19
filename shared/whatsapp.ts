// WhatsApp outreach: which lead numbers can take a WhatsApp chat, message
// templates with placeholders, and click-to-chat links. Messages are sent
// from the user's own WhatsApp (app or web) through wa.me links; the
// dashboard prepares the text and keeps the record.

import { normPhone } from './agent.ts';

export type PhoneType = 'mobile' | 'landline' | 'invalid';

export interface PhoneInfo {
  /** "0123456789", or null when it is not a Malaysian number. */
  digits: string | null;
  /** "60123456789" for wa.me, or null when the number cannot take a chat. */
  intl: string | null;
  type: PhoneType;
}

/** Mobiles (01x) normally have WhatsApp; landlines only if the business registered one. */
export function phoneInfo(phone: string | null | undefined): PhoneInfo {
  const digits = normPhone(phone);
  if (!digits) return { digits: null, intl: null, type: 'invalid' };
  if (/^1[38]00/.test(digits)) return { digits, intl: null, type: 'landline' };
  return { digits, intl: `6${digits}`, type: digits.startsWith('01') ? 'mobile' : 'landline' };
}

/** wa.me link that opens a chat with the text filled in. */
export function waUrl(intl: string, text?: string): string {
  return `https://wa.me/${intl}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

export const WA_PLACEHOLDERS = ['nama', 'perniagaan', 'kawasan', 'nama_saya', 'syarikat_saya'] as const;
export type WaPlaceholder = (typeof WA_PLACEHOLDERS)[number];

/** Replaces {placeholders}; unknown or empty ones are left visible so they get noticed. */
export function fillTemplate(body: string, vars: Partial<Record<WaPlaceholder, string | null | undefined>>): string {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k as WaPlaceholder];
    return typeof v === 'string' && v.trim() ? v.trim() : m;
  });
}

/** Placeholders still unfilled in a message (e.g. sender name not set yet). */
export function missingPlaceholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => (WA_PLACEHOLDERS as readonly string[]).includes(k)))];
}

export interface WaSettings {
  /** Sender's name, for {nama_saya}. */
  myName: string;
  /** Sender's company, for {syarikat_saya}. */
  company: string;
}

export function normalizeWaSettings(input: unknown): WaSettings {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  return { myName: text(s.myName, 80), company: text(s.company, 120) };
}

/** Starting templates for a halal frozen meat and seafood supplier (editable). */
export const DEFAULT_WA_TEMPLATES: { name: string; body: string }[] = [
  {
    name: 'Perkenalan',
    body:
      'Salam {nama}, saya {nama_saya} dari {syarikat_saya}. Kami membekalkan daging lembu, kambing, ayam dan makanan laut sejuk beku halal untuk restoran dan kafe. Boleh saya kongsikan senarai harga terkini untuk {perniagaan}?',
  },
  {
    name: 'Susulan',
    body:
      'Salam {nama}, saya {nama_saya} dari {syarikat_saya}. Sekadar bertanya sama ada {perniagaan} sudah sempat melihat senarai harga kami. Ada produk yang boleh kami bantu bekalkan?',
  },
  {
    name: 'Tawaran sampel',
    body: 'Salam {nama}, {syarikat_saya} ada sampel percuma untuk restoran dan kafe di {kawasan}. Boleh saya hantar sampel ke {perniagaan} minggu ini?',
  },
  {
    name: 'Terima kasih',
    body: 'Terima kasih {nama} atas masa anda tadi. Saya akan hantar maklumat dan harga yang kita bincangkan untuk {perniagaan}. — {nama_saya}, {syarikat_saya}',
  },
];
