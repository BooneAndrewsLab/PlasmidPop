/**
 * Shortest edit script between two sequences (Myers 1986, greedy variant).
 *
 * Used to show what an editing session changed, so the two inputs are two
 * versions of the same document and nearly always differ in a few short
 * runs. The common prefix and suffix are stripped first, which reduces the
 * usual case to a handful of bases; only what is left goes through the
 * O(ND) fill, whose cost is bounded by `maxEdits`. Past that bound the diff
 * splits on a long run the two versions share and does each side on its own,
 * and only where there is no such run does it settle for "this whole stretch
 * was replaced" rather than spend seconds on a script nobody can read.
 */

import { refineDiff } from './refine';

export type DiffOpKind = 'equal' | 'insert' | 'delete';

/**
 * One run of the edit script. `equal` spans both inputs, `delete` only the
 * first (bases that are gone) and `insert` only the second (bases that are
 * new); the empty side is a zero-width span marking where the run sits.
 */
export interface DiffOp {
  readonly kind: DiffOpKind;
  /** Half-open span in the first input. Empty for `insert`. */
  readonly aStart: number;
  readonly aEnd: number;
  /** Half-open span in the second input. Empty for `delete`. */
  readonly bStart: number;
  readonly bEnd: number;
}

export interface SequenceDiff {
  /** Runs in order, together covering both inputs exactly once. */
  readonly ops: readonly DiffOp[];
  /**
   * True when some stretch was too different to follow base by base and is
   * reported as one delete plus one insert covering all of it.
   */
  readonly coarse: boolean;
}

export interface SequenceDiffOptions {
  /**
   * Largest edit distance to search for. The fill costs about
   * `maxEdits × (n + m)` in the worst case, so this is what keeps a diff
   * that runs on every keystroke from stalling the main thread.
   */
  readonly maxEdits?: number;
  /**
   * Whether to re-align neighbourhoods of changes with affine gap costs
   * afterwards, which is what keeps a handful of nearby edits from coming
   * out as a scatter of one-base specks (see `refine.ts`). Default true.
   */
  readonly refine?: boolean;
}

/**
 * 1,000 steps covers about 500 scattered substitutions in a plasmid-sized
 * sequence, which is a long editing session, and costs ~20 ms in the worst
 * case (see docs/perf-notes.md). Past it the diff splits and tries again.
 */
const DEFAULT_MAX_EDITS = 1000;

/** Mutable accumulator that merges a run into the previous one where it can. */
class OpList {
  readonly ops: DiffOp[] = [];

  push(kind: DiffOpKind, aStart: number, aEnd: number, bStart: number, bEnd: number): void {
    if (aStart === aEnd && bStart === bEnd) return;
    const last = this.ops[this.ops.length - 1];
    if (last?.kind === kind && last.aEnd === aStart && last.bEnd === bStart) {
      this.ops[this.ops.length - 1] = {
        kind,
        aStart: last.aStart,
        aEnd,
        bStart: last.bStart,
        bEnd,
      };
      return;
    }
    this.ops.push({ kind, aStart, aEnd, bStart, bEnd });
  }
}

/** Length of the shared run the diff splits on when the fill runs out of steps. */
const ANCHOR_LENGTH = 32;
/** How many times the diff may split before it settles for a coarse answer. */
const MAX_SPLIT_DEPTH = 8;
/**
 * How much more work than one whole-input fill the splits may add up to.
 * Splitting turns one hard problem into two, either of which can be hard
 * again, so without this the worst case is exponential in the depth.
 */
const WORK_BUDGET_FACTOR = 3;

/** Roughly how many cells a fill of these two pieces would visit. */
function fillCost(a: string, b: string, maxEdits: number): number {
  return Math.min(maxEdits, a.length + b.length) * (a.length + b.length);
}

/**
 * Edit script turning `a` into `b`. Both are compared literally: a circular
 * sequence whose origin moved reads as a wholesale change, which is what it
 * is in the coordinates the views draw.
 */
export function diffSequences(
  a: string,
  b: string,
  options: SequenceDiffOptions = {},
): SequenceDiff {
  const maxEdits = Math.max(0, options.maxEdits ?? DEFAULT_MAX_EDITS);
  const list = new OpList();
  const budget = { work: fillCost(a, b, maxEdits) * WORK_BUDGET_FACTOR };
  const exact = diffInto(list, a, b, 0, 0, maxEdits, budget, 0);
  const ops = options.refine === false ? list.ops : refineDiff(list.ops, a, b);
  return { ops, coarse: !exact };
}

/**
 * Appends the script for `a` against `b`, whose first characters sit at
 * `aOffset` and `bOffset` of the whole inputs. Returns false when some part
 * of it had to be described as one wholesale replacement.
 */
function diffInto(
  list: OpList,
  a: string,
  b: string,
  aOffset: number,
  bOffset: number,
  maxEdits: number,
  budget: { work: number },
  depth: number,
): boolean {
  const shortest = Math.min(a.length, b.length);
  let prefix = 0;
  while (prefix < shortest && a.charCodeAt(prefix) === b.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    a.charCodeAt(a.length - 1 - suffix) === b.charCodeAt(b.length - 1 - suffix)
  ) {
    suffix++;
  }
  list.push('equal', aOffset, aOffset + prefix, bOffset, bOffset + prefix);

  const aMid = a.slice(prefix, a.length - suffix);
  const bMid = b.slice(prefix, b.length - suffix);
  const aBase = aOffset + prefix;
  const bBase = bOffset + prefix;
  const replace = (): void => {
    list.push('delete', aBase, aBase + aMid.length, bBase, bBase);
    list.push('insert', aBase + aMid.length, aBase + aMid.length, bBase, bBase + bMid.length);
  };

  let exact = true;
  if (aMid.length === 0 || bMid.length === 0) {
    // One side is empty: a plain insertion or deletion of any size, no search.
    replace();
  } else if (fillCost(aMid, bMid, maxEdits) > budget.work) {
    // The splits have already cost as much as this whole diff is worth.
    exact = false;
    replace();
  } else {
    budget.work -= fillCost(aMid, bMid, maxEdits);
    const script = shortestEditScript(aMid, bMid, maxEdits);
    const anchor = script === null && depth < MAX_SPLIT_DEPTH ? findAnchor(aMid, bMid) : null;
    if (script !== null) {
      for (const op of script) {
        list.push(op.kind, op.aStart + aBase, op.aEnd + aBase, op.bStart + bBase, op.bEnd + bBase);
      }
    } else if (anchor !== null) {
      // Too many steps to follow in one go, but a run this long occurring
      // once in each version is almost certainly the same DNA: diff the two
      // sides of it separately, which is what makes edits far apart in a long
      // session stay legible instead of collapsing into one big mark.
      const aSplit = aBase + anchor.aAt;
      const bSplit = bBase + anchor.bAt;
      const left = diffInto(
        list,
        aMid.slice(0, anchor.aAt),
        bMid.slice(0, anchor.bAt),
        aBase,
        bBase,
        maxEdits,
        budget,
        depth + 1,
      );
      list.push('equal', aSplit, aSplit + anchor.length, bSplit, bSplit + anchor.length);
      const right = diffInto(
        list,
        aMid.slice(anchor.aAt + anchor.length),
        bMid.slice(anchor.bAt + anchor.length),
        aSplit + anchor.length,
        bSplit + anchor.length,
        maxEdits,
        budget,
        depth + 1,
      );
      exact = left && right;
    } else {
      exact = false;
      replace();
    }
  }

  list.push(
    'equal',
    aOffset + a.length - suffix,
    aOffset + a.length,
    bOffset + b.length - suffix,
    bOffset + b.length,
  );
  return exact;
}

/**
 * A run of `ANCHOR_LENGTH` bases that occurs exactly once in each input, as
 * near the middle of `b` as one can be found. Uniqueness is what makes it
 * safe to split there: a 32-mer that repeats is no evidence of anything.
 */
function findAnchor(a: string, b: string): { aAt: number; bAt: number; length: number } | null {
  if (Math.min(a.length, b.length) < ANCHOR_LENGTH * 2) return null;
  const middle = Math.floor((b.length - ANCHOR_LENGTH) / 2);
  for (let step = 0; step <= 8; step++) {
    for (const bAt of step === 0
      ? [middle]
      : [middle + step * ANCHOR_LENGTH, middle - step * ANCHOR_LENGTH]) {
      if (bAt < 0 || bAt + ANCHOR_LENGTH > b.length) continue;
      const probe = b.slice(bAt, bAt + ANCHOR_LENGTH);
      const aAt = a.indexOf(probe);
      if (aAt < 0 || a.includes(probe, aAt + 1)) continue;
      if (b.indexOf(probe) !== bAt || b.includes(probe, bAt + 1)) continue;
      return { aAt, bAt, length: ANCHOR_LENGTH };
    }
  }
  return null;
}

/** Greedy forward Myers fill; `null` when no script of at most `maxEdits` steps exists. */
function shortestEditScript(a: string, b: string, maxEdits: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(maxEdits, n + m);
  // Diagonal k = x - y is stored at k + offset, so k ranges over [-max, max].
  const offset = max;
  const v = new Int32Array(2 * max + 1);
  /** `trace[d]` is the furthest-reaching frontier after d - 1 steps. */
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      // Reaching diagonal k costs one step from k + 1 (an insert, y grows) or
      // from k - 1 (a delete, x grows); take whichever reaches further.
      const down = k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0));
      let x = down ? (v[k + 1 + offset] ?? 0) : (v[k - 1 + offset] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a.charCodeAt(x) === b.charCodeAt(y)) {
        x++;
        y++;
      }
      v[k + offset] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, d, n, m);
    }
  }
  return null;
}

/** Walks the recorded frontiers back from (n, m) to the origin, in runs. */
function backtrack(
  trace: readonly Int32Array[],
  offset: number,
  depth: number,
  n: number,
  m: number,
): DiffOp[] {
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = depth; d > 0; d--) {
    const v = trace[d];
    if (v === undefined) break;
    const k = x - y;
    const down = k === -d || (k !== d && (v[k - 1 + offset] ?? 0) < (v[k + 1 + offset] ?? 0));
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[prevK + offset] ?? 0;
    const prevY = prevX - prevK;
    // The snake: bases that matched on the way to (x, y).
    const snakeX = down ? prevX : prevX + 1;
    const snakeY = snakeX - k;
    if (x > snakeX) {
      reversed.push({ kind: 'equal', aStart: snakeX, aEnd: x, bStart: snakeY, bEnd: y });
    }
    if (down) {
      reversed.push({ kind: 'insert', aStart: prevX, aEnd: prevX, bStart: prevY, bEnd: prevY + 1 });
    } else {
      reversed.push({ kind: 'delete', aStart: prevX, aEnd: prevX + 1, bStart: prevY, bEnd: prevY });
    }
    x = prevX;
    y = prevY;
  }
  if (x > 0 || y > 0) reversed.push({ kind: 'equal', aStart: 0, aEnd: x, bStart: 0, bEnd: y });

  const list = new OpList();
  for (let i = reversed.length - 1; i >= 0; i--) {
    const op = reversed[i];
    if (op !== undefined) list.push(op.kind, op.aStart, op.aEnd, op.bStart, op.bEnd);
  }
  return list.ops;
}

/**
 * Where a position of the first input lands in the second. Bases that were
 * deleted map to the boundary the deletion left behind, so a range whose
 * inside was removed still comes back as a range.
 */
export function positionMapper(
  diff: SequenceDiff,
  aLength: number,
  bLength: number,
): (position: number) => number {
  // Only `equal` and `delete` runs cover the first input, and they do so in
  // order, so their starts are a sorted key for binary search.
  const spans = diff.ops.filter((op) => op.aEnd > op.aStart);
  return (position: number): number => {
    if (position >= aLength) return bLength;
    if (position <= 0) return 0;
    let lo = 0;
    let hi = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const span = spans[mid];
      if (span === undefined) break;
      if (position < span.aStart) hi = mid - 1;
      else if (position >= span.aEnd) lo = mid + 1;
      else {
        return span.kind === 'equal' ? span.bStart + (position - span.aStart) : span.bStart;
      }
    }
    return bLength;
  };
}
