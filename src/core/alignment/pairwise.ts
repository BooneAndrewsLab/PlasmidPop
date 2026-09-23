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
  constructor(cells: number, max: number, outOfMemory = false) {
    super(
      outOfMemory
        ? `These sequences need ${cells.toLocaleString()} alignment cells, more memory than this browser would give.`
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

export function alignPairwise(
  a: string,
  b: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): Alignment {
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
  const width = m + 1;
  const cells = (n + 1) * width;
  if (cells > maxCells) throw new AlignmentTooLargeError(cells, maxCells);

  let tb: Uint8Array;
  try {
    tb = new Uint8Array(cells);
  } catch {
    throw new AlignmentTooLargeError(cells, maxCells, true);
  }

  let prevM = new Int32Array(width);
  let prevX = new Int32Array(width);
  let prevY = new Int32Array(width);
  let curM = new Int32Array(width);
  let curX = new Int32Array(width);
  let curY = new Int32Array(width);

  prevM[0] = 0;
  prevX[0] = NEG;
  prevY[0] = NEG;
  for (let j = 1; j <= m; j++) {
    prevM[j] = local ? 0 : NEG;
    prevX[j] = NEG;
    prevY[j] = local ? NEG : gapOpen + (j - 1) * gapExtend;
    tb[j] = (local ? STOP : M) | ((j === 1 ? M : Y) << 4);
  }
  tb[0] = local ? STOP : M;

  let best = local ? 0 : NEG;
  let bestI = 0;
  let bestJ = 0;
  let bestState = M;

  const rowsPerReport = Math.max(1, Math.floor(PROGRESS_EVERY / width));
  for (let i = 1; i <= n; i++) {
    if (onProgress !== undefined && i % rowsPerReport === 0) onProgress(i / n);
    const scoreRow = (codesA[i - 1] ?? 0) * CODES;
    const rowBase = i * width;
    curM[0] = local ? 0 : NEG;
    curX[0] = local ? NEG : gapOpen + (i - 1) * gapExtend;
    curY[0] = NEG;
    tb[rowBase] = (local ? STOP : M) | ((i === 1 ? M : X) << 2);

    for (let j = 1; j <= m; j++) {
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
  while (i > 0 || j > 0) {
    const moves = tb[i * width + j] ?? 0;
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
  return {
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
}
