import { CODES, encode, pairMark, scoreTable } from './scoring';

/**
 * Pairwise alignment with affine gap penalties (Gotoh 1982): global
 * (Needleman–Wunsch) or local (Smith–Waterman). Plain TypeScript. The fill
 * keeps three Int32 score rows and one traceback byte per cell holding all
 * three states' moves, so memory is about n·m bytes; `maxCells` guards the
 * browser against accidental genome-scale inputs. IUPAC ambiguity codes
 * score by EDNAFULL (`scoring.ts`).
 */

export type AlignmentMode = 'global' | 'local';

export interface AlignmentOptions {
  readonly mode?: AlignmentMode;
  readonly match?: number; // default 5 (EMBOSS DNAfull)
  readonly mismatch?: number; // default -4
  readonly gapOpen?: number; // default -10 (score of the first base of a gap)
  readonly gapExtend?: number; // default -0.5
  /** Refuse inputs whose (n+1)(m+1) exceeds this (default `DEFAULT_MAX_CELLS`). */
  readonly maxCells?: number;
  /**
   * Score ambiguity codes by the bases they stand for (default true). False
   * makes only identical codes match, for callers that compare text.
   */
  readonly iupac?: boolean;
}

export interface Alignment {
  readonly mode: AlignmentMode;
  readonly score: number;
  /** Aligned query with '-' for gaps. */
  readonly alignedA: string;
  /** Aligned target with '-' for gaps. */
  readonly alignedB: string;
  /** '|' identical, ':' compatible through an ambiguity code, '.' mismatch, ' ' gap, per column. */
  readonly matchLine: string;
  /** 0-based half-open span of each input covered by the alignment. */
  readonly startA: number;
  readonly endA: number;
  readonly startB: number;
  readonly endB: number;
  /** Columns of the same definite base; ambiguous matches are not counted. */
  readonly identities: number;
  /** Columns matched only through an ambiguity code (A against N, say). */
  readonly ambiguous: number;
  readonly gaps: number;
  readonly columns: number;
  readonly identity: number;
}

export class AlignmentTooLargeError extends Error {
  /**
   * `memory`: the browser refused the allocation. `unanchored`: too large to
   * align in full, and too little in common to align in a band (banded.ts).
   */
  constructor(cells: number, max: number, reason: 'limit' | 'memory' | 'unanchored' = 'limit') {
    super(
      reason === 'memory'
        ? `These sequences need ${cells.toLocaleString()} alignment cells, more memory than this browser would give.`
        : reason === 'unanchored'
          ? `These sequences share too little to align in a band around their matches, and in full they would need ${cells.toLocaleString()} alignment cells; the in-browser limit is ${max.toLocaleString()}.`
          : `These sequences would need ${cells.toLocaleString()} alignment cells; the in-browser limit is ${max.toLocaleString()}.`,
    );
    this.name = 'AlignmentTooLargeError';
  }
}

/**
 * About 150 MB of traceback, one byte a cell: a 12 kb read against a
 * 12 kb plasmid, in a few seconds in the worker (docs/perf-notes.md).
 */
export const DEFAULT_MAX_CELLS = 150_000_000;

// Traceback moves, two bits each, packed per cell as M | X << 2 | Y << 4:
// where the cell's best score in each state came from.
const M = 0; // diagonal
const X = 1; // gap in B (consumes A)
const Y = 2; // gap in A (consumes B)
const STOP = 3; // local mode: this M cell was clamped to zero, alignment starts after it

const NEG = -1_000_000_000;
/** Scores are doubled internally so a -0.5 extension stays an integer. */
const SCALE = 2;

/** Told the fraction of the fill done, from 0 to 1, a few dozen times over a long alignment. */
export type AlignmentProgress = (fraction: number) => void;

/** Cells filled between two progress reports. */
const PROGRESS_EVERY = 2_000_000;

/**
 * The cells of the fill: for each row i of the first sequence (0 to its
 * length), the columns `lo[i]` to `hi[i]` of the second, inclusive. Both
 * bounds must be non-decreasing, so a row's cells can only move right of the
 * row above's, and a global alignment's band must hold both corners.
 * `alignPairwise` fills every cell; `alignBanded` (banded.ts) only a band
 * around where the two sequences match.
 */
export interface Band {
  readonly lo: Int32Array;
  readonly hi: Int32Array;
}

/** An alignment in a band, and whether its path ran along the band's edge. */
export interface BandedResult {
  readonly alignment: Alignment;
  /**
   * The path touched a band edge that was not the matrix's own, so a better
   * path may lie outside: the caller widens the band and tries again.
   */
  readonly touchedEdge: boolean;
}

/** The number of cells a band holds. */
export function bandCells(band: Band): number {
  let cells = 0;
  for (let i = 0; i < band.lo.length; i++) cells += (band.hi[i] ?? 0) - (band.lo[i] ?? 0) + 1;
  return cells;
}

export function alignPairwise(
  a: string,
  b: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): Alignment {
  const n = a.length;
  const m = b.length;
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  const cells = (n + 1) * (m + 1);
  if (cells > maxCells) throw new AlignmentTooLargeError(cells, maxCells);
  const band = { lo: new Int32Array(n + 1), hi: new Int32Array(n + 1).fill(m) };
  return alignInBand(a, b, band, options, onProgress).alignment;
}

/**
 * The fill and traceback over the cells of `band`. With the full band this
 * is the whole Gotoh matrix and gives what it always gave; the order cells
 * are visited in, and so how ties are broken, is the same either way.
 */
export function alignInBand(
  a: string,
  b: string,
  band: Band,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): BandedResult {
  const mode = options.mode ?? 'global';
  const local = mode === 'local';
  const mismatch = Math.round((options.mismatch ?? -4) * SCALE);
  const gapOpen = Math.round((options.gapOpen ?? -10) * SCALE);
  const gapExtend = Math.round((options.gapExtend ?? -0.5) * SCALE);
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  const scores = scoreTable(
    options.match ?? 5,
    options.mismatch ?? -4,
    options.iupac ?? true,
    SCALE,
  );

  const A = a.toUpperCase();
  const B = b.toUpperCase();
  const codesA = encode(A);
  const codesB = encode(B);
  const n = A.length;
  const m = B.length;
  const { lo, hi } = band;
  if (lo.length !== n + 1 || hi.length !== n + 1)
    throw new Error('Band does not fit the sequences');

  // Where each row's cells start in the traceback.
  const rowStart = new Float64Array(n + 2);
  for (let i = 0; i <= n; i++)
    rowStart[i + 1] = (rowStart[i] ?? 0) + (hi[i] ?? 0) - (lo[i] ?? 0) + 1;
  const cells = rowStart[n + 1] ?? 0;
  if (cells > maxCells) throw new AlignmentTooLargeError(cells, maxCells);

  let tb: Uint8Array;
  try {
    tb = new Uint8Array(cells);
  } catch {
    throw new AlignmentTooLargeError(cells, maxCells, 'memory');
  }

  const width = m + 1;
  let prevM = new Int32Array(width);
  let prevX = new Int32Array(width);
  let prevY = new Int32Array(width);
  let curM = new Int32Array(width);
  let curX = new Int32Array(width);
  let curY = new Int32Array(width);

  // Row 0.
  const lo0 = lo[0] ?? 0;
  const hi0 = hi[0] ?? 0;
  for (let j = lo0; j <= hi0; j++) {
    const at = j - lo0;
    if (j === 0) {
      prevM[0] = 0;
      prevX[0] = NEG;
      prevY[0] = NEG;
      tb[at] = local ? STOP : M;
    } else {
      prevM[j] = local ? 0 : NEG;
      prevX[j] = NEG;
      prevY[j] = local ? NEG : gapOpen + (j - 1) * gapExtend;
      tb[at] = (local ? STOP : M) | ((j === 1 ? M : Y) << 4);
    }
  }
  if (lo0 > 0) {
    prevM[lo0 - 1] = NEG;
    prevX[lo0 - 1] = NEG;
    prevY[lo0 - 1] = NEG;
  }

  let best = local ? 0 : NEG;
  let bestI = 0;
  let bestJ = 0;
  let bestState = M;

  const rowsPerReport = Math.max(1, Math.floor(PROGRESS_EVERY / Math.max(1, cells / (n + 1))));
  for (let i = 1; i <= n; i++) {
    if (onProgress !== undefined && i % rowsPerReport === 0) onProgress(i / n);
    const scoreRow = (codesA[i - 1] ?? 0) * CODES;
    const rowLo = lo[i] ?? 0;
    const rowHi = hi[i] ?? 0;
    const rowBase = (rowStart[i] ?? 0) - rowLo;
    // Cells the row above did not fill, but this one reads, are out of band.
    const aboveLo = lo[i - 1] ?? 0;
    const aboveHi = hi[i - 1] ?? 0;
    if (rowLo > 0 && rowLo - 1 < aboveLo) {
      prevM[rowLo - 1] = NEG;
      prevX[rowLo - 1] = NEG;
      prevY[rowLo - 1] = NEG;
    }
    for (let k = aboveHi + 1; k <= rowHi; k++) {
      prevM[k] = NEG;
      prevX[k] = NEG;
      prevY[k] = NEG;
    }
    if (rowLo > 0) {
      curM[rowLo - 1] = NEG;
      curX[rowLo - 1] = NEG;
      curY[rowLo - 1] = NEG;
    }
    let first = rowLo;
    if (rowLo === 0) {
      curM[0] = local ? 0 : NEG;
      curX[0] = local ? NEG : gapOpen + (i - 1) * gapExtend;
      curY[0] = NEG;
      tb[rowBase] = (local ? STOP : M) | ((i === 1 ? M : X) << 2);
      first = 1;
    }

    for (let j = first; j <= rowHi; j++) {
      const s = scores[scoreRow + (codesB[j - 1] ?? 0)] ?? mismatch;

      const pm = prevM[j - 1] ?? NEG;
      const px = prevX[j - 1] ?? NEG;
      const py = prevY[j - 1] ?? NEG;
      let from = M;
      let prevBest = pm;
      if (px > prevBest) {
        prevBest = px;
        from = X;
      }
      if (py > prevBest) {
        prevBest = py;
        from = Y;
      }
      let mScore = prevBest + s;
      if (local && mScore <= 0) {
        mScore = 0;
        from = STOP;
      }
      curM[j] = mScore;
      let moves = from;

      const openX = (prevM[j] ?? NEG) + gapOpen;
      const extX = (prevX[j] ?? NEG) + gapExtend;
      const yToX = (prevY[j] ?? NEG) + gapOpen;
      if (openX >= extX && openX >= yToX) {
        curX[j] = openX;
      } else if (extX >= yToX) {
        curX[j] = extX;
        moves |= X << 2;
      } else {
        curX[j] = yToX;
        moves |= Y << 2;
      }

      const openY = (curM[j - 1] ?? NEG) + gapOpen;
      const extY = (curY[j - 1] ?? NEG) + gapExtend;
      const xToY = (curX[j - 1] ?? NEG) + gapOpen;
      if (openY >= extY && openY >= xToY) {
        curY[j] = openY;
      } else if (extY >= xToY) {
        curY[j] = extY;
        moves |= Y << 4;
      } else {
        curY[j] = xToY;
        moves |= X << 4;
      }
      tb[rowBase + j] = moves;

      if (local && mScore > best) {
        best = mScore;
        bestI = i;
        bestJ = j;
      }
    }
    [prevM, curM] = [curM, prevM];
    [prevX, curX] = [curX, prevX];
    [prevY, curY] = [curY, prevY];
  }

  if (!local) {
    if ((hi[n] ?? 0) !== m) throw new Error('A global alignment needs the last corner in its band');
    bestI = n;
    bestJ = m;
    best = prevM[m] ?? NEG;
    bestState = M;
    if ((prevX[m] ?? NEG) > best) {
      best = prevX[m] ?? NEG;
      bestState = X;
    }
    if ((prevY[m] ?? NEG) > best) {
      best = prevY[m] ?? NEG;
      bestState = Y;
    }
  }

  const outA: string[] = [];
  const outB: string[] = [];
  let i = bestI;
  let j = bestJ;
  let state = bestState;
  let touchedEdge = false;
  while (i > 0 || j > 0) {
    const rowLo = lo[i] ?? 0;
    const rowHi = hi[i] ?? 0;
    if (j < rowLo || j > rowHi) throw new Error('Alignment path left its band');
    if ((j === rowLo && rowLo > 0) || (j === rowHi && rowHi < m)) touchedEdge = true;
    const moves = tb[(rowStart[i] ?? 0) + j - rowLo] ?? 0;
    if (state === M) {
      const from = moves & 3;
      if (from === STOP || i === 0 || j === 0) break;
      outA.push(A.charAt(i - 1));
      outB.push(B.charAt(j - 1));
      state = from;
      i--;
      j--;
    } else if (state === X) {
      if (i === 0) break;
      outA.push(A.charAt(i - 1));
      outB.push('-');
      state = (moves >> 2) & 3;
      i--;
    } else {
      if (j === 0) break;
      outA.push('-');
      outB.push(B.charAt(j - 1));
      state = (moves >> 4) & 3;
      j--;
    }
  }

  const alignedA = outA.reverse().join('');
  const alignedB = outB.reverse().join('');
  let identities = 0;
  let ambiguous = 0;
  let gaps = 0;
  const marks: string[] = [];
  for (let k = 0; k < alignedA.length; k++) {
    const x = alignedA.charAt(k);
    const y = alignedB.charAt(k);
    if (x === '-' || y === '-') {
      gaps++;
      marks.push(' ');
      continue;
    }
    const mark = pairMark(x, y);
    if (mark === '|') identities++;
    else if (mark === ':') ambiguous++;
    marks.push(mark);
  }
  const matchLine = marks.join('');
  const alignment: Alignment = {
    mode,
    score: best / SCALE,
    alignedA,
    alignedB,
    matchLine,
    startA: i,
    endA: bestI,
    startB: j,
    endB: bestJ,
    identities,
    ambiguous,
    gaps,
    columns: alignedA.length,
    identity: alignedA.length === 0 ? 0 : identities / alignedA.length,
  };
  return { alignment, touchedEdge };
}
