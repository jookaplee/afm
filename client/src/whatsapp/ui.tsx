// Small pieces of the WhatsApp-style screens: avatars, ticks, badges, times.
import { CheckCheck } from 'lucide-react';
import { phoneInfo } from '../../../shared/whatsapp.ts';
import type { Format } from '../lib/format.ts';
import type { TFn } from '../lib/i18n.tsx';
import { useI18n } from '../lib/i18n.tsx';

/**
 * One named window for every chat, so a series of messages reuses one WhatsApp
 * Web tab instead of piling up tabs (no noopener: that would defeat the reuse).
 */
export const WA_WINDOW = 'joosons-whatsapp';

const AVATAR_COLORS = ['#25a58f', '#2f8fd1', '#8e6ad8', '#d9822b', '#cf4f78', '#3c9e5f', '#c0874a', '#5b7fa6'];

function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? '')).toUpperCase();
}

export function Avatar({ name, seed, size = 49 }: { name: string; seed: number; size?: number }) {
  return (
    <span className="wa-avatar" style={{ width: size, height: size, fontSize: size * 0.36, background: AVATAR_COLORS[seed % AVATAR_COLORS.length] }} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** Double tick: grey once opened in WhatsApp, blue once the lead has replied (so it was read). */
export function Ticks({ read }: { read: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`wa-ticks ${read ? 'read' : ''}`} title={read ? t('wa.readTick') : t('wa.sentTick')}>
      <CheckCheck aria-hidden />
      <span className="sr-only">{read ? t('wa.readTick') : t('wa.sentTick')}</span>
    </span>
  );
}

export function PhoneBadges({ phone, shared }: { phone: string | null; shared?: number }) {
  const { t } = useI18n();
  const info = phoneInfo(phone);
  return (
    <>
      <span className={`badge ${info.type === 'mobile' ? 'good' : info.type === 'invalid' ? 'bad' : ''}`}>{t(`wa.type.${info.type}`)}</span>
      {!!shared && (
        <span className="badge warn" title={t('wa.sharedHint', { n: shared })}>
          {t('wa.shared', { n: shared + 1 })}
        </span>
      )}
    </>
  );
}

const DAY = 86_400_000;
const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Chat-list time: "10:30" today, "Semalam", a weekday this week, else a date. */
export function chatTime(iso: string | null, fmt: Format, t: TFn): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / DAY);
  if (days <= 0) return fmt.clock(iso);
  if (days === 1) return t('wa.yesterday');
  if (days < 7) return new Intl.DateTimeFormat(fmt.locale, { weekday: 'long' }).format(d);
  return new Intl.DateTimeFormat(fmt.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
}

/** Conversation day separator: "Hari ini", "Semalam", or the full date. */
export function dayLabel(iso: string, fmt: Format, t: TFn): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(new Date()) - dayStart(d)) / DAY);
  if (days <= 0) return t('wa.today');
  if (days === 1) return t('wa.yesterday');
  return new Intl.DateTimeFormat(fmt.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

export const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};
