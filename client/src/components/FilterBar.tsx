import { RotateCcw } from 'lucide-react';
import { REGIONS, SEGMENTS } from '../../../shared/constants.ts';
import { useI18n } from '../lib/i18n.tsx';
import { useMeta } from '../lib/app-context.tsx';
import { PERIODS, type PeriodKey, useDashboardFilters } from '../lib/filters.ts';
import { SelectFilter } from './ui.tsx';

/** One filter row above everything it scopes. Date range first. */
export function FilterBar({ showOwner = false, compare = true }: { showOwner?: boolean; compare?: boolean }) {
  const { t, fmt } = useI18n();
  const { aes } = useMeta();
  const { filters, set, reset } = useDashboardFilters();
  const dirty = filters.period !== 'ytd' || filters.segment || filters.region || filters.owner;
  const len = Math.round((Date.parse(filters.to) - Date.parse(filters.from)) / 86_400_000) + 1;
  const prevTo = new Date(Date.parse(filters.from) - 86_400_000).toISOString().slice(0, 10);
  const prevFrom = new Date(Date.parse(prevTo) - (len - 1) * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="filter-bar" role="group" aria-label={t('filter.period')}>
      <select className="select" aria-label={t('filter.period')} value={filters.period} onChange={(e) => set({ period: e.target.value as PeriodKey })}>
        {PERIODS.map((p) => (
          <option key={p} value={p}>
            {t(`period.${p}`)}
          </option>
        ))}
      </select>
      {filters.period === 'custom' && (
        <>
          <input
            className="input"
            type="date"
            aria-label={t('filter.from')}
            value={filters.from}
            max={filters.to}
            onChange={(e) => e.target.value && set({ from: e.target.value })}
          />
          <input
            className="input"
            type="date"
            aria-label={t('filter.to')}
            value={filters.to}
            min={filters.from}
            onChange={(e) => e.target.value && set({ to: e.target.value })}
          />
        </>
      )}
      <span className="divider" aria-hidden />
      <SelectFilter
        label={t('col.segment')}
        value={filters.segment}
        onChange={(v) => set({ segment: v })}
        options={SEGMENTS}
        allLabel={t('filter.allSegments')}
        render={(v) => t(`segment.${v}`)}
      />
      <SelectFilter
        label={t('col.region')}
        value={filters.region}
        onChange={(v) => set({ region: v })}
        options={REGIONS}
        allLabel={t('filter.allRegions')}
        render={(v) => t(`region.${v}`)}
      />
      {showOwner && (
        <select
          className="select"
          aria-label={t('col.rep')}
          value={filters.owner ?? ''}
          onChange={(e) => set({ owner: e.target.value || undefined })}
        >
          <option value="">{t('filter.allReps')}</option>
          {aes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      )}
      {dirty && (
        <button className="btn ghost sm" onClick={reset}>
          <RotateCcw aria-hidden />
          {t('filter.reset')}
        </button>
      )}
      <span className="range-note">
        {fmt.date(filters.from)} – {fmt.date(filters.to)}
        {compare && <> · {t('filter.compare', { from: fmt.date(prevFrom), to: fmt.date(prevTo) })}</>}
      </span>
    </div>
  );
}
