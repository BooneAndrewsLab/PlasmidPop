/**
 * How the Enzymes tab orders its list.
 *
 * By name is the list as a catalogue: you know what you are looking for and
 * want to find it. By band separation is the list as an answer to "which
 * enzyme cuts this plasmid into bands I can tell apart on a gel", which is
 * what a diagnostic digest is chosen by and what the cut-count filter could
 * only approximate (item 30). The judgement itself is
 * `compareDiagnostic` in `core/analysis/gel.ts`.
 */
export type EnzymeSort = 'name' | 'bands';

export interface EnzymeSortOption {
  readonly value: EnzymeSort;
  readonly label: string;
  readonly title: string;
}

export const ENZYME_SORT_OPTIONS: readonly EnzymeSortOption[] = [
  { value: 'name', label: 'Name', title: 'List the enzymes alphabetically' },
  {
    value: 'bands',
    label: 'Band separation',
    title:
      'List the enzymes whose fragments would be furthest apart on a gel first — the ones a diagnostic digest is chosen from',
  },
];

export function isEnzymeSort(v: unknown): v is EnzymeSort {
  return v === 'name' || v === 'bands';
}
