import { BLOSUM62, BLOSUM62_ORDER } from './blosum62';
import {
  type AlignmentOptions,
  type Band,
  alignInBand,
  alignPairwise,
  scoreInBand,
} from './pairwise';

/**
 * The fill and traceback of `pairwise.ts` against a plain reference (#399):
 * the same three-state affine recurrence written the obvious way, with a
 * matrix of `-Infinity` where a cell lies outside the band. The reference
 * gives the best score; the alignment the code returns must then be a path
 * that stays in the band and scores exactly that, however ties were broken.
 */

interface Scoring {
  readonly sub: (x: string, y: string) => number;
  readonly open: number;
  readonly ext: number;
}

const dna = (match: number, mismatch: number) => (x: string, y: string) =>
  x === y ? match : mismatch;
const blosum = (x: string, y: string): number =>
  BLOSUM62[BLOSUM62_ORDER.indexOf(x)]?.[BLOSUM62_ORDER.indexOf(y)] ?? Number.NaN;

function rowOf(grid: number[][], i: number): number[] {
  const row = grid[i];
  if (row === undefined) throw new Error(`no row ${i}`);
  return row;
}

/**
 * Best score in a band. A row-0 cell past column 0 starts with a gap that
 * costs `open + (j - 1) * ext` and a first-column cell below row 0 likewise,
 * whether or not the cells before it are in the band (the code's boundary).
 */
function reference(
  a: string,
  b: string,
  band: Band,
  mode: 'global' | 'local',
  sc: Scoring,
): number {
  const n = a.length;
  const m = b.length;
  const local = mode === 'local';
  const NEG = -Infinity;
  const grid = (): number[][] =>
    Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(NEG));
  const M = grid();
  const X = grid(); // gap in b: consumes a
  const Y = grid(); // gap in a: consumes b
  const inBand = (i: number, j: number): boolean =>
    j >= (band.lo[i] ?? 0) && j <= (band.hi[i] ?? 0);
  const at = (g: number[][], i: number, j: number): number =>
    i >= 0 && j >= 0 && inBand(i, j) ? (g[i]?.[j] ?? NEG) : NEG;
  let best = local ? 0 : NEG;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (!inBand(i, j)) continue;
      const [mi, xi, yi] = [rowOf(M, i), rowOf(X, i), rowOf(Y, i)];
      if (i === 0 && j === 0) {
        mi[0] = 0;
      } else if (i === 0) {
        mi[j] = local ? 0 : NEG;
        yi[j] = local ? NEG : sc.open + (j - 1) * sc.ext;
      } else if (j === 0) {
        mi[0] = local ? 0 : NEG;
        xi[0] = local ? NEG : sc.open + (i - 1) * sc.ext;
      } else {
        const s = sc.sub(a[i - 1] ?? '', b[j - 1] ?? '');
        const diag = Math.max(at(M, i - 1, j - 1), at(X, i - 1, j - 1), at(Y, i - 1, j - 1)) + s;
        const cell = local ? Math.max(0, diag) : diag;
        mi[j] = cell;
        xi[j] = Math.max(
          at(M, i - 1, j) + sc.open,
          at(X, i - 1, j) + sc.ext,
          at(Y, i - 1, j) + sc.open,
        );
        yi[j] = Math.max(
          at(M, i, j - 1) + sc.open,
          at(Y, i, j - 1) + sc.ext,
          at(X, i, j - 1) + sc.open,
        );
        if (local && cell > best) best = cell;
      }
    }
  }
  if (local) return best;
  return Math.max(at(M, n, m), at(X, n, m), at(Y, n, m));
}

/** The score of aligned strings, a run of gap columns paying `open` once and `ext` after. */
function rescored(alignedA: string, alignedB: string, sc: Scoring): number {
  let score = 0;
  let prev: 'm' | 'x' | 'y' = 'm';
  for (let k = 0; k < alignedA.length; k++) {
    const x = alignedA.charAt(k);
    const y = alignedB.charAt(k);
    if (x === '-') {
      score += prev === 'y' ? sc.ext : sc.open;
      prev = 'y';
    } else if (y === '-') {
      score += prev === 'x' ? sc.ext : sc.open;
      prev = 'x';
    } else {
      score += sc.sub(x, y);
      prev = 'm';
    }
  }
  return score;
}

let seed = 4242;
const rnd = (): number => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return (seed >> 8) / 0x800000;
};
const ri = (k: number): number => Math.floor(rnd() * k);
const pick = <T>(xs: readonly T[]): T => xs[ri(xs.length)] as T;

/** A band round a random monotone path from corner to corner, `w` columns wider each side. */
function bandAround(n: number, m: number, w: number): Band {
  const lo = new Int32Array(n + 1);
  const hi = new Int32Array(n + 1);
  let i = 0;
  let j = 0;
  lo[0] = 0;
  hi[0] = 0;
  while (i < n || j < m) {
    const moves: string[] = [];
    if (i < n && j < m) moves.push('D');
    if (i < n) moves.push('V');
    if (j < m) moves.push('H');
    const step = pick(moves);
    if (step !== 'H') i++;
    if (step !== 'V') j++;
    if (step === 'H') hi[i] = j;
    else {
      lo[i] = j;
      hi[i] = j;
    }
  }
  for (let r = 0; r <= n; r++) {
    lo[r] = Math.max(0, (lo[r] ?? 0) - w);
    hi[r] = Math.min(m, (hi[r] ?? 0) + w);
  }
  return { lo, hi };
}

function sequence(len: number, alphabet: string): string {
  return Array.from({ length: len }, () => alphabet.charAt(ri(alphabet.length))).join('');
}

describe('a band fill against a plain reference (#399)', () => {
  const gapSets: readonly (readonly [number, number])[] = [
    [-10, -0.5],
    [-5, -1],
    [-2, -2],
    [-1, -1],
    [0, -1.5],
    [-3, 0],
    [-4, -0.5],
  ];

  it('scores and traces back as the reference does, in both modes', () => {
    let checked = 0;
    for (let round = 0; round < 700; round++) {
      const alphabet = pick(['AC', 'ACG', 'ACGT']);
      const a = sequence(1 + ri(10), alphabet);
      const b = sequence(1 + ri(10), alphabet);
      const mode = pick(['global', 'local'] as const);
      const [gapOpen, gapExtend] = pick(gapSets);
      const match = pick([5, 1, 3]);
      const mismatch = pick([-4, -1, 0, -3]);
      const sc: Scoring = { sub: dna(match, mismatch), open: gapOpen, ext: gapExtend };
      const band = bandAround(a.length, b.length, ri(3));
      const options = { mode, gapOpen, gapExtend, match, mismatch };
      const want = reference(a, b, band, mode, sc);
      const where = JSON.stringify({ a, b, lo: [...band.lo], hi: [...band.hi], options });

      expect(scoreInBand(a, b, band, options), where).toBe(want);
      const { alignment: r } = alignInBand(a, b, band, options);
      expect(r.score, where).toBe(want);

      // The strings are the stretch of each sequence the alignment claims.
      expect(r.alignedA.replaceAll('-', ''), where).toBe(a.slice(r.startA, r.endA));
      expect(r.alignedB.replaceAll('-', ''), where).toBe(b.slice(r.startB, r.endB));
      expect(r.columns, where).toBe(r.alignedA.length);
      expect(rescored(r.alignedA, r.alignedB, sc), where).toBe(r.score);
      if (mode === 'global')
        expect([r.startA, r.endA, r.startB, r.endB]).toEqual([0, a.length, 0, b.length]);

      // Every cell the path visits lies in the band.
      let i = r.startA;
      let j = r.startB;
      const inside = (): boolean => j >= (band.lo[i] ?? 0) && j <= (band.hi[i] ?? 0);
      expect(inside(), where).toBe(true);
      for (let k = 0; k < r.columns; k++) {
        if (r.alignedA.charAt(k) !== '-') i++;
        if (r.alignedB.charAt(k) !== '-') j++;
        expect(inside(), where).toBe(true);
      }
      checked++;
    }
    expect(checked).toBe(700);
  });

  it('seeds the first row with a leading gap when the band starts right of column 0', () => {
    // The same reference, bands whose first row starts past column 0: only
    // the score is checked, as no path starts inside such a band.
    for (let round = 0; round < 300; round++) {
      const a = sequence(1 + ri(8), 'ACG');
      const b = sequence(2 + ri(8), 'ACG');
      const band = bandAround(a.length, b.length, ri(2));
      band.lo[0] = 1 + ri(Math.min(2, b.length - 1));
      band.hi[0] = Math.max(band.hi[0] ?? 0, band.lo[0]);
      for (let r = 1; r <= a.length; r++) {
        band.lo[r] = Math.max(band.lo[r] ?? 0, band.lo[r - 1] ?? 0);
        band.hi[r] = Math.max(band.hi[r] ?? 0, band.hi[r - 1] ?? 0, band.lo[r] ?? 0);
      }
      band.hi[a.length] = b.length;
      const mode = pick(['global', 'local'] as const);
      const [gapOpen, gapExtend] = pick(gapSets);
      const sc: Scoring = { sub: dna(5, -4), open: gapOpen, ext: gapExtend };
      const want = reference(a, b, band, mode, sc);
      const where = JSON.stringify({
        a,
        b,
        lo: [...band.lo],
        hi: [...band.hi],
        mode,
        gapOpen,
        gapExtend,
      });
      expect(scoreInBand(a, b, band, { mode, gapOpen, gapExtend }), where).toBe(want);
    }
  });

  it('is the full matrix when the band is the whole of it', () => {
    for (let round = 0; round < 60; round++) {
      const a = sequence(1 + ri(10), 'ACGT');
      const b = sequence(1 + ri(10), 'ACGT');
      const mode = pick(['global', 'local'] as const);
      const full = alignPairwise(a, b, { mode });
      const whole = {
        lo: new Int32Array(a.length + 1),
        hi: new Int32Array(a.length + 1).fill(b.length),
      };
      expect(alignInBand(a, b, whole, { mode }).alignment).toEqual(full);
      expect(scoreInBand(a, b, whole, { mode })).toBe(full.score);
    }
  });
});

interface Pin {
  readonly why: string;
  readonly a: string;
  readonly b: string;
  /** The band's rows, or the whole matrix. */
  readonly lo?: readonly number[];
  readonly hi?: readonly number[];
  readonly options: AlignmentOptions;
  readonly alignedA: string;
  readonly alignedB: string;
  readonly score: number;
  readonly span?: readonly [number, number, number, number];
  readonly touchedEdge?: boolean;
}

/**
 * Cases where the best alignment is not the only one, so which of the equal
 * ones comes back is up to the order the fill compares in (a gap opened where
 * the same score was had by extending one, a match started where the same was
 * had by a gap, the first of equal cells in a local alignment). The strings
 * are what the code gave when these were written; the reference and the
 * rescoring check that each is optimal and consistent, so a pin that moved
 * because a tie went the other way is told apart from one that moved because
 * the alignment got worse.
 */
const PINS: readonly Pin[] = [
  {
    why: 'local, a mismatch scoring 0: where the stretch starts',
    a: 'ACACAAC',
    b: 'CCCCAAAC',
    options: { mode: 'local', gapOpen: -4, gapExtend: -2, match: 3, mismatch: 0 },
    alignedA: 'CACAA',
    alignedB: 'CCCAA',
    score: 12,
    span: [1, 6, 1, 6],
  },
  {
    why: 'local, two stretches of the same score: the first is kept',
    a: 'GGAGG',
    b: 'GGCGACAA',
    options: { mode: 'local', match: 1, mismatch: -3 },
    alignedA: 'GG',
    alignedB: 'GG',
    score: 2,
    span: [0, 2, 0, 2],
  },
  {
    why: 'global, a free gap open: which of equal gap placements',
    a: 'GAAACC',
    b: 'ACC',
    options: { mode: 'global', gapOpen: 0, gapExtend: -1.5 },
    alignedA: 'GAAACC',
    alignedB: '--A-CC',
    score: 13.5,
  },
  {
    why: 'global, a free gap open in a band, several equal gap placements',
    a: 'A',
    b: 'GGCC',
    lo: [0, 0],
    hi: [2, 4],
    options: { mode: 'global', gapOpen: 0, gapExtend: -2 },
    alignedA: '-A---',
    alignedB: 'G-GCC',
    score: -4,
  },
  {
    why: 'global, gaps that cost nothing: an opened and an extended gap tie',
    a: 'GTACCTA',
    b: 'AGG',
    options: { mode: 'global', gapOpen: 0, gapExtend: 0, match: 2, mismatch: -3 },
    alignedA: '--GTACCTA',
    alignedB: 'AGG------',
    score: 2,
  },
  {
    why: 'global, a free gap open and an extension that costs: gaps of both sequences tie',
    a: 'C',
    b: 'AGGA',
    options: { mode: 'global', gapOpen: 0, gapExtend: -2, match: 5, mismatch: -2 },
    alignedA: '--C-',
    alignedB: 'AGGA',
    score: -4,
  },
  {
    why: 'local, nothing aligns: an empty alignment in a band right of column 0',
    a: 'ACCA',
    b: 'GG',
    lo: [1, 1, 2, 2, 2],
    hi: [2, 2, 2, 2, 2],
    options: { mode: 'local', match: 1, mismatch: -3 },
    alignedA: '',
    alignedB: '',
    score: 0,
    span: [0, 0, 0, 0],
  },
  {
    why: 'local, a path along a band edge right of column 0 says so',
    a: 'CCGAAACC',
    b: 'GCGACGG',
    lo: [0, 1, 1, 1, 1, 3, 3, 3, 3],
    hi: [2, 3, 3, 3, 4, 5, 5, 6, 6],
    options: { mode: 'local' },
    alignedA: 'CGA',
    alignedB: 'CGA',
    score: 15,
    span: [1, 4, 1, 4],
    touchedEdge: true,
  },
  {
    why: 'global, a path along the left edge of a band that is not the matrix edge',
    a: 'CACAAA',
    b: 'AA',
    lo: [0, 1, 2, 2, 2, 2, 2],
    hi: [2, 2, 2, 2, 2, 2, 2],
    options: { mode: 'global' },
    alignedA: 'CACAAA',
    alignedB: 'AA----',
    score: -10.5,
    touchedEdge: true,
  },
  {
    why: 'protein, a path along the right edge of a band that stops short of the last column',
    a: 'AAADDRDR',
    b: 'ARNRRRN',
    lo: [0, 0, 0, 0, 0, 0, 0, 0, 2],
    hi: [2, 3, 3, 4, 4, 4, 5, 6, 7],
    options: { mode: 'global', alphabet: 'protein', gapOpen: -4, gapExtend: -3 },
    alignedA: 'AAADDRDR',
    alignedB: '-ARNRRRN',
    score: 1,
    touchedEdge: true,
  },
];

describe('which of equal alignments comes back, and the band edge it ran along (#399)', () => {
  it.each(PINS.map((p) => [p.why, p] as const))('%s', (_why, p) => {
    const band: Band =
      p.lo && p.hi
        ? { lo: Int32Array.from(p.lo), hi: Int32Array.from(p.hi) }
        : {
            lo: new Int32Array(p.a.length + 1),
            hi: new Int32Array(p.a.length + 1).fill(p.b.length),
          };
    const protein = p.options.alphabet === 'protein';
    const sc: Scoring = {
      sub: protein ? blosum : dna(p.options.match ?? 5, p.options.mismatch ?? -4),
      open: p.options.gapOpen ?? (protein ? -11 : -10),
      ext: p.options.gapExtend ?? (protein ? -1 : -0.5),
    };
    const { alignment: r, touchedEdge } = alignInBand(p.a, p.b, band, p.options);
    expect(reference(p.a, p.b, band, p.options.mode ?? 'global', sc)).toBe(p.score);
    expect(rescored(r.alignedA, r.alignedB, sc)).toBe(p.score);
    expect(r.score).toBe(p.score);
    expect([r.alignedA, r.alignedB]).toEqual([p.alignedA, p.alignedB]);
    if (p.span) expect([r.startA, r.endA, r.startB, r.endB]).toEqual(p.span);
    if (p.touchedEdge !== undefined) expect(touchedEdge).toBe(p.touchedEdge);
    else expect(touchedEdge).toBe(false);
  });
});

describe('a band that does not hold the first corner (#399)', () => {
  it('cannot be traced back for a global alignment, which starts at that corner', () => {
    // Rows start at column 2 or 4: the path would have to begin outside.
    const lo = Int32Array.from([2, 2, 2, 4, 4, 4]);
    const hi = Int32Array.from([4, 4, 5, 6, 6, 6]);
    expect(() => alignInBand('ACCAA', 'CAAAAC', { lo, hi })).toThrow(
      'Alignment path left its band',
    );
  });
});

describe('progress through a band (#399)', () => {
  it('reports once every two rows when two rows hold the two million cells between reports', () => {
    // Two rows of 800,000 cells and the first: a report every 2,000,000 / 800,000 = 2 rows.
    const seen: number[] = [];
    const b = 'ACGT'.repeat(200_000).slice(1);
    scoreInBand('AC', b, { lo: new Int32Array(3), hi: new Int32Array(3).fill(b.length) }, {}, (f) =>
      seen.push(f),
    );
    expect(seen).toEqual([1]);
  });
});
