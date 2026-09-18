/**
 * Pairwise alignment with affine gap penalties (Gotoh 1982): global
 * (Needleman–Wunsch) or local (Smith–Waterman). Plain TypeScript. The fill
 * keeps three Int32 score rows and a byte-per-cell traceback for each of
 * the three states, so memory is about 3·n·m bytes; `maxCells` guards the
 * browser against accidental genome-scale inputs.
 */

export type AlignmentMode = 'global' | 'local';

export interface AlignmentOptions {
  readonly mode?: AlignmentMode;
  readonly match?: number; // default 5 (EMBOSS DNAfull)
  readonly mismatch?: number; // default -4
  readonly gapOpen?: number; // default -10 (score of the first base of a gap)
  readonly gapExtend?: number; // default -0.5
  /** Refuse inputs whose (n+1)(m+1) exceeds this (default 30 million). */
  readonly maxCells?: number;
}

export interface Alignment {
  readonly mode: AlignmentMode;
  readonly score: number;
  /** Aligned query with '-' for gaps. */
  readonly alignedA: string;
  /** Aligned target with '-' for gaps. */
  readonly alignedB: string;
  /** '|' identical, '.' mismatch, ' ' gap, per column. */
  readonly matchLine: string;
  /** 0-based half-open span of each input covered by the alignment. */
  readonly startA: number;
  readonly endA: number;
  readonly startB: number;
  readonly endB: number;
  readonly identities: number;
  readonly gaps: number;
  readonly columns: number;
  readonly identity: number;
}

export class AlignmentTooLargeError extends Error {
  constructor(cells: number, max: number) {
    super(
      `These sequences would need ${cells.toLocaleString()} alignment cells; the in-browser limit is ${max.toLocaleString()}.`,
    );
    this.name = 'AlignmentTooLargeError';
  }
}

const M = 0; // diagonal
const X = 1; // gap in B (consumes A)
const Y = 2; // gap in A (consumes B)
const STOP = 3; // local mode: this M cell was clamped to zero, alignment starts after it

const NEG = -1_000_000_000;
/** Scores are doubled internally so a -0.5 extension stays an integer. */
const SCALE = 2;

export function alignPairwise(a: string, b: string, options: AlignmentOptions = {}): Alignment {
  const mode = options.mode ?? 'global';
  const local = mode === 'local';
  const match = Math.round((options.match ?? 5) * SCALE);
  const mismatch = Math.round((options.mismatch ?? -4) * SCALE);
  const gapOpen = Math.round((options.gapOpen ?? -10) * SCALE);
  const gapExtend = Math.round((options.gapExtend ?? -0.5) * SCALE);
  const maxCells = options.maxCells ?? 30_000_000;

  const A = a.toUpperCase();
  const B = b.toUpperCase();
  const n = A.length;
  const m = B.length;
  const width = m + 1;
  const cells = (n + 1) * width;
  if (cells > maxCells) throw new AlignmentTooLargeError(cells, maxCells);

  const tbM = new Uint8Array(cells);
  const tbX = new Uint8Array(cells);
  const tbY = new Uint8Array(cells);

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
    tbY[j] = j === 1 ? M : Y;
    if (local) tbM[j] = STOP;
  }
  if (local) tbM[0] = STOP;

  let best = local ? 0 : NEG;
  let bestI = 0;
  let bestJ = 0;
  let bestState = M;

  for (let i = 1; i <= n; i++) {
    const ca = A.charCodeAt(i - 1);
    const rowBase = i * width;
    curM[0] = local ? 0 : NEG;
    curX[0] = local ? NEG : gapOpen + (i - 1) * gapExtend;
    curY[0] = NEG;
    tbX[rowBase] = i === 1 ? M : X;
    if (local) tbM[rowBase] = STOP;

    for (let j = 1; j <= m; j++) {
      const idx = rowBase + j;
      const s = ca === B.charCodeAt(j - 1) ? match : mismatch;

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
      tbM[idx] = from;

      const openX = (prevM[j] ?? NEG) + gapOpen;
      const extX = (prevX[j] ?? NEG) + gapExtend;
      const yToX = (prevY[j] ?? NEG) + gapOpen;
      if (openX >= extX && openX >= yToX) {
        curX[j] = openX;
        tbX[idx] = M;
      } else if (extX >= yToX) {
        curX[j] = extX;
        tbX[idx] = X;
      } else {
        curX[j] = yToX;
        tbX[idx] = Y;
      }

      const openY = (curM[j - 1] ?? NEG) + gapOpen;
      const extY = (curY[j - 1] ?? NEG) + gapExtend;
      const xToY = (curX[j - 1] ?? NEG) + gapOpen;
      if (openY >= extY && openY >= xToY) {
        curY[j] = openY;
        tbY[idx] = M;
      } else if (extY >= xToY) {
        curY[j] = extY;
        tbY[idx] = Y;
      } else {
        curY[j] = xToY;
        tbY[idx] = X;
      }

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
    const idx = i * width + j;
    if (state === M) {
      const from = tbM[idx] ?? M;
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
      state = tbX[idx] ?? M;
      i--;
    } else {
      if (j === 0) break;
      outA.push('-');
      outB.push(B.charAt(j - 1));
      state = tbY[idx] ?? M;
      j--;
    }
  }

  const alignedA = outA.reverse().join('');
  const alignedB = outB.reverse().join('');
  let identities = 0;
  let gaps = 0;
  let matchLine = '';
  for (let k = 0; k < alignedA.length; k++) {
    const x = alignedA.charAt(k);
    const y = alignedB.charAt(k);
    if (x === '-' || y === '-') {
      gaps++;
      matchLine += ' ';
    } else if (x === y) {
      identities++;
      matchLine += '|';
    } else matchLine += '.';
  }
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
    gaps,
    columns: alignedA.length,
    identity: alignedA.length === 0 ? 0 : identities / alignedA.length,
  };
}
