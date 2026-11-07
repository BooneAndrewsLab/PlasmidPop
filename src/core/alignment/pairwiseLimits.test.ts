import { vi } from 'vitest';
import {
  AlignmentTooLargeError,
  type Band,
  alignInBand,
  alignPairwise,
  bandCells,
  scoreInBand,
} from './pairwise';

/** The whole matrix as a band: every row holds columns 0 to `m`. */
function wholeBand(n: number, m: number): Band {
  return { lo: new Int32Array(n + 1), hi: new Int32Array(n + 1).fill(m) };
}

function band(lo: number[], hi: number[]): Band {
  return { lo: Int32Array.from(lo), hi: Int32Array.from(hi) };
}

// The survivors of #399 in the limits and the errors of `pairwise.ts`.

describe('AlignmentTooLargeError says why (#399)', () => {
  it('names the limit by default and when told so', () => {
    const limit = 'These sequences would need 45 alignment cells; the in-browser limit is 9.';
    for (const e of [
      new AlignmentTooLargeError(45, 9),
      new AlignmentTooLargeError(45, 9, 'limit'),
    ]) {
      expect(e).toBeInstanceOf(Error);
      expect(e.name).toBe('AlignmentTooLargeError');
      expect(e.message).toBe(limit);
    }
  });

  it('says the memory was refused, without a limit', () => {
    const e = new AlignmentTooLargeError(45, 9, 'memory');
    expect(e.name).toBe('AlignmentTooLargeError');
    expect(e.message).toBe(
      'These sequences need 45 alignment cells, more memory than this browser would give.',
    );
  });

  it('says there was no band to align in', () => {
    const e = new AlignmentTooLargeError(45, 9, 'unanchored');
    expect(e.name).toBe('AlignmentTooLargeError');
    expect(e.message).toBe(
      'These sequences share too little to align in a band around their matches, ' +
        'and in full they would need 45 alignment cells; the in-browser limit is 9.',
    );
  });

  it('writes the numbers the way the reader does', () => {
    const cells = 1_234_567_890;
    const max = 150_000_000;
    expect(new AlignmentTooLargeError(cells, max).message).toBe(
      `These sequences would need ${cells.toLocaleString()} alignment cells; ` +
        `the in-browser limit is ${max.toLocaleString()}.`,
    );
    expect(new AlignmentTooLargeError(cells, max, 'memory').message).toContain(
      cells.toLocaleString(),
    );
    expect(new AlignmentTooLargeError(cells, max, 'unanchored').message).toContain(
      max.toLocaleString(),
    );
  });
});

describe('the cell limit of a fill (#399)', () => {
  it('counts the cells of the whole matrix, both sides plus one', () => {
    // 101 x 4 = 404 cells; each of the other counts (100 x 4, 101 x 2, 101 / 4) differs.
    expect(() => alignPairwise('A'.repeat(100), 'AAA', { maxCells: 5 })).toThrow(
      new AlignmentTooLargeError(404, 5),
    );
    expect(() => alignPairwise('A'.repeat(100), 'AAA', { maxCells: 5 })).toThrow(
      'These sequences would need 404 alignment cells; the in-browser limit is 5.',
    );
  });

  it('runs a matrix of exactly maxCells cells and refuses one more', () => {
    // 3 x 3 = 9 cells.
    for (const mode of ['global', 'local'] as const) {
      expect(alignPairwise('AC', 'AC', { mode, maxCells: 9 }).score).toBe(10);
      expect(() => alignPairwise('AC', 'AC', { mode, maxCells: 8 })).toThrow(
        'These sequences would need 9 alignment cells; the in-browser limit is 8.',
      );
    }
  });

  it('applies to a band too: its cells against maxCells', () => {
    const b = wholeBand(2, 2);
    expect(alignInBand('AC', 'AC', b, { maxCells: 9 }).alignment.score).toBe(10);
    expect(() => alignInBand('AC', 'AC', b, { maxCells: 8 })).toThrow(
      new AlignmentTooLargeError(9, 8),
    );
    // A narrow band has fewer cells: 3 + 2 + 2 = 7.
    const narrow = band([0, 0, 1], [1, 2, 2]);
    expect(bandCells(narrow)).toBe(7);
    expect(alignInBand('AC', 'AC', narrow, { maxCells: 7 }).alignment.score).toBe(10);
    expect(() => alignInBand('AC', 'AC', narrow, { maxCells: 6 })).toThrow(
      'These sequences would need 7 alignment cells; the in-browser limit is 6.',
    );
  });

  it('does not count the cells when only the score is wanted: nothing is kept', () => {
    expect(scoreInBand('ACGT', 'ACGT', wholeBand(4, 4), { maxCells: 1 })).toBe(20);
    expect(scoreInBand('ACGT', 'ACGT', wholeBand(4, 4), { mode: 'local', maxCells: 1 })).toBe(20);
  });

  it('reports a refused allocation as too large, with the cells it wanted', () => {
    // 4 x 6 = 24 cells for the traceback; the other byte arrays are 3 and 5 long.
    class Refusing extends Uint8Array {
      constructor(length: number) {
        if (length === 24) throw new RangeError('Array buffer allocation failed');
        super(length);
      }
    }
    vi.stubGlobal('Uint8Array', Refusing);
    try {
      const run = (): unknown => alignInBand('ACG', 'ACGTA', wholeBand(3, 5));
      expect(run).toThrow(AlignmentTooLargeError);
      expect(run).toThrow(
        'These sequences need 24 alignment cells, more memory than this browser would give.',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('bandCells (#399)', () => {
  it('adds up the columns of every row, both ends included', () => {
    expect(bandCells(band([0, 1, 2], [2, 2, 3]))).toBe(3 + 2 + 2);
    expect(bandCells(band([4], [4]))).toBe(1);
    expect(bandCells(wholeBand(3, 5))).toBe(4 * 6);
  });

  it('is nothing for no rows', () => {
    expect(bandCells({ lo: new Int32Array(0), hi: new Int32Array(0) })).toBe(0);
  });
});

describe('a band that cannot be filled (#399)', () => {
  it('refuses a band that does not have a row per base and one more', () => {
    const fit = 'Band does not fit the sequences';
    // 'ACG' needs 4 rows.
    expect(() =>
      alignInBand('ACG', 'AC', { lo: new Int32Array(3), hi: new Int32Array(4).fill(2) }),
    ).toThrow(fit);
    expect(() =>
      alignInBand('ACG', 'AC', { lo: new Int32Array(4), hi: new Int32Array(3).fill(2) }),
    ).toThrow(fit);
    expect(() =>
      alignInBand('ACG', 'AC', { lo: new Int32Array(5), hi: new Int32Array(5).fill(2) }),
    ).toThrow(fit);
    expect(alignInBand('ACG', 'AC', wholeBand(3, 2)).alignment.columns).toBe(3);
  });

  it('refuses a global alignment whose band stops short of the last column', () => {
    const corner = 'A global alignment needs the last corner in its band';
    const short = band([0, 0, 0], [2, 2, 1]);
    expect(() => alignInBand('AC', 'AC', short)).toThrow(corner);
    expect(() => scoreInBand('AC', 'AC', short)).toThrow(corner);
    // A local alignment need not end at a corner: it takes the A and cannot reach the C.
    expect(alignInBand('AC', 'AC', short, { mode: 'local' }).alignment.alignedA).toBe('A');
  });

  it('says so when the path it traces runs out of the band', () => {
    // Every row holds column 2 alone, so no path starts at the corner and the
    // trace leaves the band at once.
    expect(() => alignInBand('NC', 'NT', band([2, 2, 2], [2, 2, 2]))).toThrow(
      'Alignment path left its band',
    );
  });
});

describe('what an alignment says of itself (#399)', () => {
  it('is global unless told otherwise', () => {
    expect(alignPairwise('ACGT', 'ACGT').mode).toBe('global');
    expect(alignPairwise('ACGT', 'ACGT', { mode: 'local' }).mode).toBe('local');
    expect(alignInBand('ACGT', 'ACGT', wholeBand(4, 4)).alignment.mode).toBe('global');
  });

  it('counts a gap in either sequence as a gap and marks it with a space', () => {
    // A base the second sequence has and the first lacks, then the other way round.
    for (const [a, b] of [
      ['ACGTACGT', 'ACGTTACGT'],
      ['ACGTTACGT', 'ACGTACGT'],
    ] as const) {
      const r = alignPairwise(a, b);
      expect(r.gaps).toBe(1);
      expect(r.identities).toBe(8);
      expect(r.columns).toBe(9);
      expect(r.matchLine.split(' ')).toHaveLength(2);
      const gap = Math.max(r.alignedA.indexOf('-'), r.alignedB.indexOf('-'));
      expect(r.matchLine.charAt(gap)).toBe(' ');
      expect(r.identity).toBe(8 / 9);
    }
  });

  it('has no identity to speak of when nothing aligned', () => {
    const r = alignPairwise('ACCA', 'GG', { mode: 'local', match: 1, mismatch: -3 });
    expect(r.columns).toBe(0);
    expect(r.alignedA).toBe('');
    expect(r.identity).toBe(0);
    expect(Number.isNaN(r.identity)).toBe(false);
  });
});
