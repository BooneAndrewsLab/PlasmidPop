/**
 * The order and set of samples the large alignment view shows (#127). The
 * window never reorders or edits its samples; it asks `shownSamples` for the
 * indices to stack, so every consumer (drawing, picking, verdicts, the
 * differences list, Find, export) sees the shown rows as the only rows. A
 * hidden sample is out of the verdicts and coverage as well as the picture.
 */

export type SampleSort = 'original' | 'identity' | 'name' | 'position';

export const SAMPLE_SORTS: readonly { readonly key: SampleSort; readonly label: string }[] = [
  { key: 'original', label: 'As aligned' },
  { key: 'identity', label: 'Identity, highest first' },
  { key: 'name', label: 'Name' },
  { key: 'position', label: 'Position on the reference' },
];

/** What a sort looks at in one sample. */
export interface SortKeys {
  readonly name: string;
  readonly identity: number;
  /** Where the sample's alignment starts on the reference. */
  readonly start: number;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Indices 0..n-1 in the order `sort` asks for; ties keep the original order. */
export function sortedIndices(keys: readonly SortKeys[], sort: SampleSort): number[] {
  const order = keys.map((_, i) => i);
  if (sort === 'original') return order;
  const cmp = (a: number, b: number): number => {
    const x = keys[a];
    const y = keys[b];
    if (x === undefined || y === undefined) return 0;
    switch (sort) {
      case 'identity':
        return y.identity - x.identity;
      case 'name':
        return collator.compare(x.name, y.name);
      case 'position':
        return x.start - y.start;
    }
  };
  return order.sort((a, b) => cmp(a, b) || a - b);
}

/** The indices to show: the sorted ones that are not hidden. */
export function shownSamples(
  keys: readonly SortKeys[],
  sort: SampleSort,
  hidden: ReadonlySet<number>,
): number[] {
  return sortedIndices(keys, sort).filter((i) => !hidden.has(i));
}

/** "from 3 of 4 samples" when some are hidden, else ''. */
export function hiddenNote(total: number, shown: number): string {
  return shown < total ? `from ${shown.toLocaleString()} of ${total.toLocaleString()} samples` : '';
}
