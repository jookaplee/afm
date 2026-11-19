export type Format = ReturnType<typeof makeFormat>;

const DASH = '—';

export function makeFormat(lang: 'ms' | 'en') {
  const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const compact1 = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const compact2 = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 });
  const pct1 = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const pct0 = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthYear = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const monthYearLong = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Timestamps (ISO) shown in the viewer's own time zone.
  const stamp = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const clock = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  const parse = (d: string) => new Date(`${d.length === 7 ? `${d}-01` : d}T00:00:00Z`);

  return {
    locale,
    /** "19 Nov, 10:30" for an ISO timestamp. */
    stamp: (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? stamp.format(new Date(iso)) : DASH),
    /** "10:30" for an ISO timestamp or epoch ms. */
    clock: (v: string | number | null | undefined) => (v !== null && v !== undefined && !Number.isNaN(new Date(v).getTime()) ? clock.format(new Date(v)) : DASH),
    /** Full ringgit, e.g. "RM1,250,000". */
    money: (v: number | null | undefined) => (ok(v) ? `${v < 0 ? '−' : ''}RM${full.format(Math.abs(Math.round(v)))}` : DASH),
    /** Compact ringgit, e.g. "RM1.3J" (juta) / "RM450K"; English: "RM1.3M". */
    moneyCompact: (v: number | null | undefined) => {
      if (!ok(v)) return DASH;
      const abs = Math.abs(v);
      return `${v < 0 ? '−' : ''}RM${abs < 1000 ? full.format(abs) : compact1.format(abs)}`;
    },
    /** Compact axis tick without currency, e.g. "1.2J". */
    axis: (v: number) => (Math.abs(v) < 10_000 ? full.format(v) : compact2.format(v)),
    num: (v: number | null | undefined) => (ok(v) ? full.format(v) : DASH),
    compact: (v: number | null | undefined) => (ok(v) ? (Math.abs(v) < 10_000 ? full.format(v) : compact1.format(v)) : DASH),
    pct: (v: number | null | undefined) => (ok(v) ? pct1.format(v) : DASH),
    pct0: (v: number | null | undefined) => (ok(v) ? pct0.format(v) : DASH),
    dec: (v: number | null | undefined) => (ok(v) ? dec1.format(v) : DASH),
    multiple: (v: number | null | undefined) => (ok(v) ? `${dec1.format(v)}×` : DASH),
    date: (d: string | null | undefined) => (d ? date.format(parse(d)) : DASH),
    dayMonth: (d: string) => dayMonth.format(parse(d)),
    /** Bucket label for chart axes: month "Jan 26" or week start "17 Agu". */
    bucket: (key: string, granularity: 'week' | 'month') =>
      granularity === 'month' ? monthYear.format(parse(key)) : dayMonth.format(parse(key)),
    bucketLong: (key: string, granularity: 'week' | 'month') =>
      granularity === 'month' ? monthYearLong.format(parse(key)) : date.format(parse(key)),
  };
}
