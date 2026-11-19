import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useI18n } from '../lib/i18n.tsx';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Value used for client-side sorting; presence makes the column sortable. */
  sortValue?: (row: T) => number | string | null;
  /** Server-side sort key; presence makes the column sortable in server mode. */
  sortKey?: string;
  align?: 'right';
  nowrap?: boolean;
  width?: number | string;
  /** Secondary column: shown only on wide screens so the table fits without scrolling. */
  wide?: boolean;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  onRowClick,
  empty,
  caption,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  sort?: SortState;
  onSort?: (s: SortState) => void;
  onRowClick?: (row: T) => void;
  empty?: string;
  caption?: string;
}) {
  const { t } = useI18n();
  const toggle = (key: string) => {
    if (!onSort) return;
    onSort(sort?.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  };
  return (
    <div className="table-scroll">
      <table className="data">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => {
              const sortable = !!onSort && (c.sortKey || c.sortValue);
              const active = sort?.key === (c.sortKey ?? c.key);
              return (
                <th
                  key={c.key}
                  className={`${c.align ?? ''} ${sortable ? 'sortable' : ''} ${c.wide ? 'col-wide' : ''}`}
                  style={c.width ? { width: c.width } : undefined}
                  aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={sortable ? () => toggle(c.sortKey ?? c.key) : undefined}
                  onKeyDown={sortable ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle(c.sortKey ?? c.key)) : undefined}
                  tabIndex={sortable ? 0 : undefined}
                >
                  {c.header}
                  {sortable && (
                    <span className="sort" aria-hidden>
                      {active ? sort!.dir === 'asc' ? <ArrowUp /> : <ArrowDown /> : <ArrowUpDown style={{ opacity: 0.35 }} />}
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="empty">
                {empty ?? t('common.noData')}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={rowKey(r)}
                className={onRowClick ? 'clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${c.align === 'right' ? 'right num' : ''} ${c.nowrap ? 'nowrap' : ''} ${c.wide ? 'col-wide' : ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Client-side sorting for small, fully loaded tables. */
export function useClientSort<T>(rows: T[], columns: Column<T>[], initial: SortState) {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    const col = columns.find((c) => (c.sortKey ?? c.key) === sort.key);
    if (!col?.sortValue) return rows;
    const get = col.sortValue;
    const mul = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * mul;
    });
  }, [rows, columns, sort]);
  return { sorted, sort, setSort };
}
