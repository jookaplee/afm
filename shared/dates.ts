// Date helpers on 'YYYY-MM-DD' strings. All arithmetic is done in UTC so that
// results never depend on the server's time zone.

const DAY = 86_400_000;

export function parse(d: string): Date {
  return new Date(`${d}T00:00:00Z`);
}

export function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayLocal(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(d: string, n: number): string {
  return fmt(new Date(parse(d).getTime() + Math.round(n) * DAY));
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
}

export function isValidDate(d: unknown): d is string {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const p = parse(d);
  return !Number.isNaN(p.getTime()) && fmt(p) === d;
}

export function monthKey(d: string): string {
  return d.slice(0, 7);
}

export function monthStart(d: string): string {
  return `${d.slice(0, 7)}-01`;
}

export function monthEnd(d: string): string {
  const p = parse(monthStart(d));
  return fmt(new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + 1, 0)));
}

export function addMonths(d: string, n: number): string {
  const p = parse(d);
  const target = new Date(Date.UTC(p.getUTCFullYear(), p.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(p.getUTCDate(), last));
  return fmt(target);
}

/** Monday of the ISO week containing d. */
export function weekKey(d: string): string {
  const p = parse(d);
  const dow = (p.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(d, -dow);
}

export function quarterOf(d: string): { label: string; start: string; end: string } {
  const p = parse(d);
  const q = Math.floor(p.getUTCMonth() / 3);
  const y = p.getUTCFullYear();
  const start = fmt(new Date(Date.UTC(y, q * 3, 1)));
  const end = fmt(new Date(Date.UTC(y, q * 3 + 3, 0)));
  return { label: `Q${q + 1} ${y}`, start, end };
}

/** Month keys ('YYYY-MM') covering [from, to]. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = monthStart(from);
  while (cur <= to) {
    out.push(monthKey(cur));
    cur = addMonths(cur, 1);
  }
  return out;
}

/** Week keys (Mondays) covering [from, to]. */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = weekKey(from);
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 7);
  }
  return out;
}

/** Number of days of [aStart, aEnd] that overlap [bStart, bEnd], inclusive. */
export function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const s = aStart > bStart ? aStart : bStart;
  const e = aEnd < bEnd ? aEnd : bEnd;
  return s > e ? 0 : diffDays(s, e) + 1;
}
