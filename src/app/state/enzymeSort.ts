/**
 * How the Enzymes tab orders its list.
 *
 * By name is the list as a catalogue: you know what you are looking for and
 * want to find it. By band separation is the list as an answer to "which
 * enzyme cuts this plasmid into bands I can tell apart on a gel", which is
 * what a diagnostic digest is chosen by and what the cut-count filter could
 * only approximate (item 30). The judgement itself is
 * `compareDiagnostic` in `core/analysis/gel.ts`. By cuts is fewest first,
 * the unique cutters at the top; by overhang is blunt, then 5′, then 3′,
 * the shorter overhang first within a kind (#402). Name breaks every tie.
 */
export type EnzymeSort = 'name' | 'bands' | 'cuts' | 'overhang';

const SORTS: readonly string[] = ['name', 'bands', 'cuts', 'overhang'];

export function isEnzymeSort(v: unknown): v is EnzymeSort {
  return typeof v === 'string' && SORTS.includes(v);
}
