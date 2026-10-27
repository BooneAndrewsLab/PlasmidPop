import { type CollectionPrimer, meltingTemperature } from '@/core';

import { type SortState } from './tableKeys';

/**
 * My primers as a sortable table (item 107, stage two). `added` is the
 * list's own order, which is the order the primers were kept in.
 */
export type CollectionSortKey = 'added' | 'name' | 'bases' | 'nt' | 'tm' | 'notes';

export type CollectionSort = SortState<CollectionSortKey>;

export const DEFAULT_COLLECTION_SORT: CollectionSort = { key: 'added', dir: 'asc' };

/** The Tm the table shows: the bases' at the tab's conditions, or none for a degenerate primer. */
export function collectionTm(primer: CollectionPrimer): number | null {
  const tm = meltingTemperature(primer.sequence);
  return Number.isNaN(tm) ? null : tm;
}

function compare(a: CollectionPrimer, b: CollectionPrimer, key: CollectionSortKey): number {
  switch (key) {
    case 'added':
      return 0;
    case 'name':
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    case 'bases':
      return a.sequence.localeCompare(b.sequence);
    case 'nt':
      return a.sequence.length - b.sequence.length;
    case 'tm': {
      // A primer without a Tm sorts after every one with one, whichever way.
      const x = collectionTm(a);
      const y = collectionTm(b);
      if (x === null || y === null)
        return x === y ? 0 : x === null ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      return x - y;
    }
    case 'notes':
      return a.notes.localeCompare(b.notes, undefined, { sensitivity: 'base' });
  }
}

/** The primers in the sort's order; ties keep the list's order, so it is stable. */
export function sortCollection(
  primers: readonly CollectionPrimer[],
  sort: CollectionSort,
): CollectionPrimer[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return primers
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const d = compare(a.p, b.p, sort.key);
      if (d === 0) return a.i - b.i;
      // The infinities keep a Tm-less primer last in either direction.
      return Number.isFinite(d) ? sign * d : d;
    })
    .map(({ p }) => p);
}
