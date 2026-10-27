import { type ReactNode } from 'react';

/**
 * What the workspace's tables share (item 107): a sortable column header
 * that says its order to a screen reader, and the arrow keys walking the
 * rows. The rows keep one stop in the tab order — the selected row, or the
 * first — and `↑ ↓ Home End` move the selection, so a table of ten pairs
 * costs one Tab to pass and one key a row to read.
 */

export interface SortThProps<K extends string> {
  readonly column: K;
  readonly sort: { readonly key: K; readonly dir: 'asc' | 'desc' };
  readonly onSort: (column: K) => void;
  /** Right-aligned, for numbers. */
  readonly numeric?: boolean;
  readonly tip?: string;
  readonly children: ReactNode;
}

export function SortTh<K extends string>({
  column,
  sort,
  onSort,
  numeric = false,
  tip,
  children,
}: SortThProps<K>) {
  const on = sort.key === column;
  return (
    <th
      className={numeric ? 'wst__n' : undefined}
      aria-sort={on ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      data-tip={tip}
    >
      <button
        type="button"
        className="wst__sort"
        onClick={() => {
          onSort(column);
        }}
      >
        {children}
        <i className="wst__arrow" aria-hidden="true">
          {on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
        </i>
      </button>
    </th>
  );
}
