import { type PrimerPair, type PrimerReport, SeqDocument } from '@/core';

import {
  DEFAULT_RESULTS_SORT,
  NO_RESULTS_FILTER,
  type ResultRow,
  filterRows,
  pairAsText,
  pairChecks,
  rowMatches,
  sortRows,
} from './primerResults';
import { toggleSort } from './tableKeys';

function report(
  sequence: string,
  tm: number,
  gc: number,
  extra: Partial<PrimerReport> = {},
): PrimerReport {
  return {
    sequence,
    length: sequence.length,
    tm,
    gc,
    homopolymer: 2,
    selfDimerDg: 0,
    hairpinDg: 0,
    hairpinTm: 0,
    threePrimeSelf: 1,
    gcClamp: /[GC]$/.test(sequence),
    degenerate: 0,
    molecules: 1,
    tmRange: null,
    gcRange: { min: gc, max: gc },
    warnings: [],
    ...extra,
  };
}

function pair(
  fwd: string,
  rev: string,
  product: number,
  start: number,
  tmF = 60,
  tmR = 60,
  extra: Partial<PrimerPair> = {},
): PrimerPair {
  return {
    forward: report(fwd, tmF, 0.5),
    reverse: report(rev, tmR, 0.5),
    forwardSite: { start, end: start + fwd.length },
    reverseSite: { start: start + product - rev.length, end: start + product },
    productLength: product,
    tmDifference: Math.abs(tmF - tmR),
    crossDimer: 2,
    crossDimerDg: -1,
    penalty: 1,
    ...extra,
  };
}

const rows: ResultRow[] = [
  { index: 0, pair: pair('ACGTACGTACGTACGTACGG', 'TTGCAAGGCCTTGGAACCTC', 400, 100, 60, 59.6) },
  { index: 1, pair: pair('GGCCAATTGGCCAATTGGCA', 'CCGGTTAACCGGTTAACCGT', 300, 50, 62, 60.4) },
  { index: 2, pair: pair('TTAACCGGTTAACCGGTTAC', 'AAGGCCTTAAGGCCTTAAGG', 500, 20, 61, 61) },
];

describe('the Results table (item 107)', () => {
  it('sorts by any column, ties in rank order, and a second click turns the order round', () => {
    expect(sortRows(rows, DEFAULT_RESULTS_SORT).map((r) => r.index)).toEqual([0, 1, 2]);
    expect(sortRows(rows, { key: 'product', dir: 'asc' }).map((r) => r.index)).toEqual([1, 0, 2]);
    expect(sortRows(rows, { key: 'product', dir: 'desc' }).map((r) => r.index)).toEqual([2, 0, 1]);
    expect(sortRows(rows, { key: 'dtm', dir: 'asc' }).map((r) => r.index)).toEqual([2, 0, 1]);
    expect(sortRows(rows, { key: 'fwd', dir: 'asc' }).map((r) => r.index)).toEqual([0, 1, 2]);
    expect(sortRows(rows, { key: 'revTm', dir: 'desc' }).map((r) => r.index)).toEqual([2, 1, 0]);
    const s1 = toggleSort(DEFAULT_RESULTS_SORT, 'product');
    expect(s1).toEqual({ key: 'product', dir: 'asc' });
    expect(toggleSort(s1, 'product')).toEqual({ key: 'product', dir: 'desc' });
    expect(toggleSort(s1, 'dtm')).toEqual({ key: 'dtm', dir: 'asc' });
  });

  it('finds a row by bases, a position inside a site or the product, or a rank', () => {
    const [a, b, c] = rows as [ResultRow, ResultRow, ResultRow];
    expect(rowMatches(a, '', 1000)).toBe(true);
    expect(rowMatches(a, 'acg tac', 1000)).toBe(true);
    expect(rowMatches(b, 'ACGTAC', 1000)).toBe(false);
    // Fewer than four bases is not a search yet.
    expect(rowMatches(a, 'AC', 1000)).toBe(false);
    // 1-based: a's forward site is 101–120, its product 101–500.
    expect(rowMatches(a, '105', 1000)).toBe(true);
    expect(rowMatches(a, '500', 1000)).toBe(true);
    expect(rowMatches(a, '501', 1000)).toBe(false);
    expect(rowMatches(c, '#3', 1000)).toBe(true);
    expect(rowMatches(c, '#1', 1000)).toBe(false);
  });

  it('matches a position in a product that runs over the origin', () => {
    const over: ResultRow = {
      index: 0,
      pair: pair('ACGTACGTACGTACGTACGG', 'TTGCAAGGCCTTGGAACCTC', 100, 950),
    };
    // On a 1,000 bp circle the product is 951–50.
    expect(rowMatches(over, '990', 1000)).toBe(true);
    expect(rowMatches(over, '20', 1000)).toBe(true);
    expect(rowMatches(over, '500', 1000)).toBe(false);
  });

  it('narrows by the chips', () => {
    expect(filterRows(rows, NO_RESULTS_FILTER, 1000)).toHaveLength(3);
    expect(
      filterRows(rows, { ...NO_RESULTS_FILTER, closeTm: true }, 1000).map((r) => r.index),
    ).toEqual([0, 2]);
    // b's reverse ends in T: no clamp.
    expect(
      filterRows(rows, { ...NO_RESULTS_FILTER, clampBoth: true }, 1000).map((r) => r.index),
    ).toEqual([0, 2]);
    const folded: ResultRow[] = [
      ...rows,
      {
        index: 3,
        pair: pair('ACGTACGTACGTACGTACGG', 'TTGCAAGGCCTTGGAACCTC', 400, 100, 60, 60, {
          forward: report('ACGTACGTACGTACGTACGG', 60, 0.5, { hairpinDg: -2.5 }),
        }),
      },
    ];
    expect(
      filterRows(folded, { ...NO_RESULTS_FILTER, noHairpin: true }, 1000).map((r) => r.index),
    ).toEqual([0, 1, 2]);
    expect(filterRows(rows, { ...NO_RESULTS_FILTER, query: 'GGCCAATT' }, 1000)).toHaveLength(1);
  });

  it('counts where else each primer anneals, its own site not counted', () => {
    const site = 'ACGTTGCAGGCTTAGCCATG';
    // The reverse primer reads the bottom strand: its site on top is its reverse complement.
    const rev = 'GGATCCTTAGCAACGGTCAG';
    const revSiteOnTop = 'CTGACCGTTGCTAAGGATCC';
    const once = SeqDocument.create({
      sequence: `${'T'.repeat(50)}${site}${'A'.repeat(200)}${revSiteOnTop}${'T'.repeat(30)}`,
    });
    const p = pair(site, rev, 290, 50);
    const checks = pairChecks(p, once);
    expect(checks.elsewhere).toEqual([0, 0]);
    expect(checks.hairpin).toEqual([0, 0]);
    expect(checks.crossDimer).toBe(2);
    expect(checks.crossDimerDg).toBe(-1);
    const twice = SeqDocument.create({ sequence: `${once.sequence.toString()}${site}` });
    expect(pairChecks(p, twice).elsewhere[0]).toBe(1);
  });

  it('writes both oligos for the clipboard, a line each', () => {
    const [a] = rows as [ResultRow];
    expect(pairAsText(a.pair, 1)).toBe(
      'Fwd 1\tACGTACGTACGTACGTACGG\nRev 1\tTTGCAAGGCCTTGGAACCTC\n',
    );
  });
});
