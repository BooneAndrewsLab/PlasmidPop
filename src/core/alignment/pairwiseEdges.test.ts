import { type Band, alignInBand, alignPairwise, scoreInBand } from './pairwise';

/**
 * What `pairwise.ts` does at its edges, pinned on its own (item 50, 1.25):
 * which of two equal alignments comes back at the corner, the cache of the
 * first sequence's codes, the progress callback that is not there, the band a
 * path can run out of on the right, and the count of ambiguous columns. The
 * other suites reach these only through whole alignments, or through suites a
 * mutation run leaves out. Sequences are short; the one long fill is two
 * million cells, scored and not traced.
 */

function band(lo: number[], hi: number[]): Band {
  return { lo: Int32Array.from(lo), hi: Int32Array.from(hi) };
}

/** The whole matrix as a band: every row holds columns 0 to `m`. */
function wholeBand(n: number, m: number): Band {
  return band(
    Array.from({ length: n + 1 }, () => 0),
    Array.from({ length: n + 1 }, () => m),
  );
}

describe('a global alignment that ends where a gap ends it as well', () => {
  it('puts the gap of AA against A in front, the diagonal ending it', () => {
    // -10 and +5 either way; the match that ends in the corner is kept.
    expect(alignPairwise('AA', 'A').alignedB).toBe('-A');
  });

  it('puts the gap of A against AA in front, as it does for the other sequence', () => {
    expect(alignPairwise('A', 'AA').alignedA).toBe('-A');
  });

  it('puts the gap of AA against C in front, a mismatch ending it', () => {
    expect(alignPairwise('AA', 'C').alignedB).toBe('-C');
  });
});

describe('the codes of the first sequence, kept for the next call', () => {
  it('does not take a nucleotide sequence for a protein one with the same letters', () => {
    // A, C, G and T are bases to one table and residues to the other: 6 x 5 and 4 + 9 + 6 + 5 + 4 + 9.
    const bases = alignPairwise('ACGTAC', 'ACGTAC').score;
    const residues = alignPairwise('ACGTAC', 'ACGTAC', { alphabet: 'protein' }).score;
    expect([bases, residues]).toEqual([30, 37]);
  });

  it('does not take a protein sequence for a nucleotide one with the same letters', () => {
    const residues = alignPairwise('CATGCA', 'CATGCA', { alphabet: 'protein' }).score;
    const bases = alignPairwise('CATGCA', 'CATGCA').score;
    expect([residues, bases]).toEqual([37, 30]);
  });
});

describe('a long fill and its progress', () => {
  const unit = 'ACGT';
  const long = unit.repeat(375);

  it('needs no callback to run its 1,500 rows', () => {
    expect(scoreInBand(long, long, wholeBand(1500, 1500))).toBe(7500);
  });

  it('tells a callback once, after the 1,332 rows that hold two million cells', () => {
    const told: number[] = [];
    scoreInBand(long, long, wholeBand(1500, 1500), {}, (fraction) => told.push(fraction));
    expect(told).toEqual([1332 / 1500]);
  });
});

describe('a band whose path runs out of it', () => {
  it('says so when the path leaves on the right', () => {
    // The corner is alone in the last row, and the cell the trace needs above it is out of band.
    expect(() => alignInBand('NC', 'NT', band([0, 0, 2], [0, 0, 2]))).toThrow(
      'Alignment path left its band',
    );
  });

  it('says so when the path leaves on the left', () => {
    expect(() => alignInBand('NC', 'NT', band([2, 2, 2], [2, 2, 2]))).toThrow(
      'Alignment path left its band',
    );
  });
});

describe('the first row of a band that starts right of column 0', () => {
  it('lets a local alignment start at each of its columns', () => {
    // Row 0 holds columns 1 to 3; the A of the read matches the last of them.
    const r = alignInBand('A', 'CCA', band([1, 1], [3, 3]), { mode: 'local' });
    expect(r.alignment.score).toBe(5);
  });
});

describe('how columns are counted', () => {
  it('counts a mismatch as neither identical nor ambiguous', () => {
    const r = alignPairwise('A', 'C');
    expect([r.identities, r.ambiguous, r.gaps]).toEqual([0, 0, 0]);
  });

  it('counts a match through an ambiguity code as ambiguous only', () => {
    const r = alignPairwise('A', 'N');
    expect([r.identities, r.ambiguous, r.gaps]).toEqual([0, 1, 0]);
  });
});
