import { type PrimerPair, type SeqDocument, cleanPrimer, findPrimerBindingSites } from '@/core';

/**
 * The Results table's order, filters and the detail pane's checks (item
 * 107, stage two): what the table shows is the design's pairs as rows, each
 * still numbered by its rank, so a sorted or filtered table never loses
 * which pair is which.
 */

export interface ResultRow {
  /** The pair's place in the design, 0-based; its rank is one more. */
  readonly index: number;
  readonly pair: PrimerPair;
}

export type ResultsSortKey =
  'rank' | 'product' | 'dtm' | 'fwd' | 'fwdTm' | 'fwdGc' | 'rev' | 'revTm' | 'revGc';

export interface ResultsSort {
  readonly key: ResultsSortKey;
  readonly dir: 'asc' | 'desc';
}

export const DEFAULT_RESULTS_SORT: ResultsSort = { key: 'rank', dir: 'asc' };

/** The column's value, as the table compares it. */
function keyOf(row: ResultRow, key: ResultsSortKey): number | string {
  const p = row.pair;
  switch (key) {
    case 'rank':
      return row.index;
    case 'product':
      return p.productLength;
    case 'dtm':
      return p.tmDifference;
    case 'fwd':
      return p.forward.sequence;
    case 'fwdTm':
      return p.forward.tm;
    case 'fwdGc':
      return p.forward.gc;
    case 'rev':
      return p.reverse.sequence;
    case 'revTm':
      return p.reverse.tm;
    case 'revGc':
      return p.reverse.gc;
  }
}

/** The rows in the sort's order; ties keep the rank order, so the table is stable. */
export function sortRows(rows: readonly ResultRow[], sort: ResultsSort): ResultRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = keyOf(a, sort.key);
    const y = keyOf(b, sort.key);
    const d =
      typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
    return d === 0 ? a.index - b.index : sign * d;
  });
}

/** A click on a column: the same column turns the order round, another starts ascending. */
export function toggleSort(sort: ResultsSort, key: ResultsSortKey): ResultsSort {
  return sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' };
}

export interface ResultsFilter {
  /** Bases, a position or a rank; empty is everything. */
  readonly query: string;
  /** ΔTm of 1 °C or less. */
  readonly closeTm: boolean;
  /** Both primers end in G or C. */
  readonly clampBoth: boolean;
  /** Neither primer folds into a hairpin. */
  readonly noHairpin: boolean;
}

export const NO_RESULTS_FILTER: ResultsFilter = {
  query: '',
  closeTm: false,
  clampBoth: false,
  noHairpin: false,
};

/** The last base of a site, 1-based, wrapped onto a circle as the lists write it. */
function lastBase(end: number, seqLength: number): number {
  return ((end - 1) % Math.max(1, seqLength)) + 1;
}

/**
 * Whether the row answers the box: a run of four or more bases in either
 * primer (the box is cleaned as a primer is, so `acg t` finds `ACGT`), a
 * 1-based position inside either site or the product, or `#3` for a rank.
 */
export function rowMatches(row: ResultRow, query: string, seqLength: number): boolean {
  const q = query.trim();
  if (q === '') return true;
  const rank = /^#?(\d+)$/.exec(q);
  if (rank !== null) {
    const n = Number(rank[1]);
    if (q.startsWith('#')) return row.index + 1 === n;
    const { forwardSite, reverseSite } = row.pair;
    const inside = (start: number, end: number): boolean =>
      n >= start + 1 && n <= lastBase(end, seqLength);
    if (row.index + 1 === n || inside(forwardSite.start, forwardSite.end)) return true;
    if (inside(reverseSite.start, reverseSite.end)) return true;
    // The product may run over the origin; its unrolled end is past the length then.
    const first = forwardSite.start + 1;
    const last = lastBase(reverseSite.end, seqLength);
    return first <= last ? n >= first && n <= last : n >= first || n <= last;
  }
  const bases = cleanPrimer(q);
  if (bases.length < 4) return false;
  return row.pair.forward.sequence.includes(bases) || row.pair.reverse.sequence.includes(bases);
}

export function filterRows(
  rows: readonly ResultRow[],
  filter: ResultsFilter,
  seqLength: number,
): ResultRow[] {
  return rows.filter(({ index, pair }) => {
    if (filter.closeTm && pair.tmDifference > 1) return false;
    if (filter.clampBoth && !(pair.forward.gcClamp && pair.reverse.gcClamp)) return false;
    if (filter.noHairpin && (pair.forward.hairpin > 0 || pair.reverse.hairpin > 0)) return false;
    return rowMatches({ index, pair }, filter.query, seqLength);
  });
}

/** The detail pane's checks for a pair, forward and reverse. */
export interface PairChecks {
  /** Longest hairpin stem, bp. */
  readonly hairpin: readonly [number, number];
  /** Longest self-complementary stretch, bp. */
  readonly selfDimer: readonly [number, number];
  /** Longest 3′-end pairing with itself, bp. */
  readonly threePrimeSelf: readonly [number, number];
  /** Longest 3′-end pairing between the two, bp. */
  readonly crossDimer: number;
  /** Where else on the document each primer would also anneal (its own site not counted). */
  readonly elsewhere: readonly [number, number];
}

export function pairChecks(pair: PrimerPair, doc: SeqDocument): PairChecks {
  const template = doc.sequence.toString();
  const elsewhere = (primer: string): number =>
    Math.max(0, findPrimerBindingSites(template, doc.topology, primer).length - 1);
  return {
    hairpin: [pair.forward.hairpin, pair.reverse.hairpin],
    selfDimer: [pair.forward.selfComplementarity, pair.reverse.selfComplementarity],
    threePrimeSelf: [pair.forward.threePrimeSelf, pair.reverse.threePrimeSelf],
    crossDimer: pair.crossDimer,
    elsewhere: [elsewhere(pair.forward.sequence), elsewhere(pair.reverse.sequence)],
  };
}

/** Both oligos as a clipboard copies them: name, tab, bases, one a line. */
export function pairAsText(pair: PrimerPair, rank: number): string {
  return `Fwd ${rank}\t${pair.forward.sequence}\nRev ${rank}\t${pair.reverse.sequence}\n`;
}
