export type Format = ReturnType<typeof makeFormat>;

const DASH = '—';

export function makeFormat(lang: 'id' | 'en') {
  const locale = lang === 'id' ? 'id-ID' : 'en-US';
  const full = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const compact1 = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const pct1 = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const pct0 = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const dec1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthYear = new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  const monthYearLong = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const ok = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);
  const parse = (d: string) => new Date(`${d.length === 7 ? `${d}-01` : d}T00:00:00Z`);

  return {
    locale,
    /** Full rupiah, e.g. "Rp 1.250.000.000". */
    money: (v: number | null | undefined) => (ok(v) ? `Rp ${full.format(Math.round(v))}` : DASH),
    /** Compact rupiah, e.g. "Rp 1,3 M" / "Rp 450 jt". */
    moneyCompact: (v: number | null | undefined) => {
      if (!ok(v)) return DASH;
      return `Rp ${Math.abs(v) < 1000 ? full.format(v) : compact1.format(v)}`;
    },
    /** Compact axis tick without currency, e.g. "1,2 M". */
    axis: (v: number) => (Math.abs(v) < 10_000 ? full.format(v) : compact1.format(v)),
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
