import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as D from '../../../shared/dates.ts';
import { REGIONS, SEGMENTS, type Region, type Segment } from '../../../shared/constants.ts';
import { useMeta } from './app-context.tsx';

export const PERIODS = ['last30', 'last90', 'qtd', 'lastq', 'ytd', 'last12m', 'lastyear', 'custom'] as const;
export type PeriodKey = (typeof PERIODS)[number];

export function resolvePeriod(key: PeriodKey, today: string, from?: string | null, to?: string | null): { from: string; to: string } {
  switch (key) {
    case 'last30':
      return { from: D.addDays(today, -29), to: today };
    case 'last90':
      return { from: D.addDays(today, -89), to: today };
    case 'qtd':
      return { from: D.quarterOf(today).start, to: today };
    case 'lastq': {
      const q = D.quarterOf(D.addDays(D.quarterOf(today).start, -1));
      return { from: q.start, to: q.end };
    }
    case 'last12m':
      return { from: D.addDays(D.addMonths(today, -12), 1), to: today };
    case 'lastyear': {
      const y = Number(today.slice(0, 4)) - 1;
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    case 'custom': {
      const f = from && D.isValidDate(from) ? from : `${today.slice(0, 4)}-01-01`;
      const t = to && D.isValidDate(to) ? to : today;
      return f <= t ? { from: f, to: t } : { from: t, to: f };
    }
    case 'ytd':
    default:
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

export interface DashboardFilters {
  period: PeriodKey;
  from: string;
  to: string;
  segment?: Segment;
  region?: Region;
  owner?: number;
}

/** Dashboard filters live in the URL so every view is shareable and survives reloads. */
export function useDashboardFilters() {
  const [sp, setSp] = useSearchParams();
  const { meta } = useMeta();

  const filters = useMemo<DashboardFilters>(() => {
    const p = sp.get('period');
    const period: PeriodKey = (PERIODS as readonly string[]).includes(p ?? '') ? (p as PeriodKey) : 'ytd';
    const { from, to } = resolvePeriod(period, meta.today, sp.get('from'), sp.get('to'));
    const seg = sp.get('segment');
    const reg = sp.get('region');
    const owner = Number(sp.get('owner'));
    return {
      period,
      from,
      to,
      segment: (SEGMENTS as readonly string[]).includes(seg ?? '') ? (seg as Segment) : undefined,
      region: (REGIONS as readonly string[]).includes(reg ?? '') ? (reg as Region) : undefined,
      owner: Number.isInteger(owner) && owner > 0 ? owner : undefined,
    };
  }, [sp, meta.today]);

  const set = useCallback(
    (patch: Partial<Record<'period' | 'from' | 'to' | 'segment' | 'region' | 'owner', string | number | undefined>>) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '') next.delete(k);
            else next.set(k, String(v));
          }
          if (patch.period && patch.period !== 'custom') {
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSp],
  );

  const reset = useCallback(() => setSp(new URLSearchParams(), { replace: true }), [setSp]);

  const params = useMemo(
    () => ({ from: filters.from, to: filters.to, segment: filters.segment, region: filters.region, owner: filters.owner }),
    [filters],
  );

  return { filters, set, reset, params };
}
