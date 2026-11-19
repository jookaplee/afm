// Lead categories and the businesses of the group: tags, pickers and the
// category chips of the Leads page.

import type { CSSProperties } from 'react';
import { useMeta } from '../lib/app-context.tsx';
import { useI18n } from '../lib/i18n.tsx';

export const catColor = (color: number | null | undefined): string => `var(--series-${color && color >= 1 && color <= 8 ? color : 7})`;

/** A coloured dot and the category's name. */
export function CategoryTag({ k, className }: { k: string | null | undefined; className?: string }) {
  const { category, catName } = useMeta();
  const c = category(k);
  return (
    <span className={`cat-tag ${className ?? ''}`}>
      <i className="cat-dot" style={{ background: catColor(c?.color) }} aria-hidden />
      <span className="truncate">{catName(k)}</span>
    </span>
  );
}

/**
 * Category picker. With a business, only that business's categories and the
 * group-wide ones; without one, all of them, grouped by business. The current
 * value stays listed even when it is archived.
 */
export function CategorySelect({
  id,
  value,
  onChange,
  businessId,
  allLabel,
  label,
}: {
  id?: string;
  value: string;
  onChange: (key: string) => void;
  businessId?: number | null;
  /** Adds an "all categories" option (for filters). */
  allLabel?: string;
  label?: string;
}) {
  const { t } = useI18n();
  const { businesses, categories, catName, categoriesFor, multiBusiness } = useMeta();
  const list = categoriesFor(businessId);
  const current = categories.find((c) => c.key === value);
  if (current && !list.includes(current)) list.push(current);
  const option = (key: string) => (
    <option key={key} value={key}>
      {catName(key)}
    </option>
  );
  const grouped = multiBusiness && businessId == null;
  return (
    <select id={id} className="select" aria-label={id ? undefined : label} value={value} onChange={(e) => onChange(e.target.value)}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {grouped ? (
        <>
          {businesses.map((b) => {
            const own = list.filter((c) => c.business_id === b.id);
            return own.length ? (
              <optgroup key={b.id} label={b.name}>
                {own.map((c) => option(c.key))}
              </optgroup>
            ) : null;
          })}
          {list.some((c) => c.business_id == null) && <optgroup label={t('cat.groupWide')}>{list.filter((c) => c.business_id == null).map((c) => option(c.key))}</optgroup>}
        </>
      ) : (
        list.map((c) => option(c.key))
      )}
    </select>
  );
}

/** Business picker (active businesses, plus the current one). */
export function BusinessSelect({
  id,
  value,
  onChange,
  allLabel,
  label,
}: {
  id?: string;
  value: string;
  onChange: (id: string) => void;
  allLabel?: string;
  label?: string;
}) {
  const { businesses } = useMeta();
  return (
    <select id={id} className="select" aria-label={id ? undefined : label} value={value} onChange={(e) => onChange(e.target.value)}>
      {allLabel !== undefined && <option value="">{allLabel}</option>}
      {businesses
        .filter((b) => b.active || String(b.id) === value)
        .map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
    </select>
  );
}

/** One row of category chips with lead counts (horizontal scroll on phones). */
export function CategoryChips({
  value,
  onChange,
  counts,
  total,
  businessId,
}: {
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  counts: Map<string, number> | null;
  total: number | null;
  businessId: number | undefined;
}) {
  const { t, fmt } = useI18n();
  const { categories, catName } = useMeta();
  // This business's categories (and group-wide ones) that are active or still hold leads.
  const shown = categories.filter(
    (c) => (businessId == null || c.business_id == null || c.business_id === businessId) && (c.active || (counts?.get(c.key) ?? 0) > 0 || c.key === value),
  );
  return (
    <div className="cat-chips" role="group" aria-label={t('col.industry')}>
      <button type="button" className="cat-chip" aria-pressed={!value} onClick={() => onChange(undefined)}>
        {t('cat.all')}
        {total != null && <span className="count">{fmt.num(total)}</span>}
      </button>
      {shown.map((c) => {
        const n = counts?.get(c.key) ?? 0;
        return (
          <button
            key={c.key}
            type="button"
            className={`cat-chip ${n === 0 ? 'empty' : ''}`}
            aria-pressed={value === c.key}
            onClick={() => onChange(value === c.key ? undefined : c.key)}
            style={{ '--cat': catColor(c.color) } as CSSProperties}
          >
            <i className="cat-dot" aria-hidden />
            {catName(c.key)}
            {counts && <span className="count">{fmt.num(n)}</span>}
          </button>
        );
      })}
    </div>
  );
}
