import { alignPairwise } from '../alignment';
import { type DiffOp, type DiffOpKind } from './sequenceDiff';

/**
 * Tidies up an edit script so it describes what someone did rather than the
 * cheapest way to explain it.
 *
 * On a four-letter alphabet a shortest edit script is often a smeared one:
 * inserting 7 bases and deleting 6 a dozen bases away can be "explained" in
 * fewer steps by matching a stray base here and there, which comes out as a
 * scatter of one-base specks. Affine gap costs are the standard cure — one
 * long gap beats six short ones — but they cost O(nm), so they are only
 * affordable on the stretches the cheap diff has already narrowed down.
 * Each run of changes that sit close together is therefore re-aligned as a
 * whole, and everything else is left as it is.
 */

/** Unchanged bases between two changes that still count as one neighbourhood. */
const CLUSTER_GAP = 24;
/** Largest neighbourhood worth re-aligning (about 200 × 200 bases). */
const MAX_CLUSTER_CELLS = 40_000;
/** Total re-alignment per diff, so a sequence full of changes stays quick. */
const CELL_BUDGET = 250_000;

interface Cluster {
  /** Index of the first and last op of the neighbourhood. */
  readonly from: number;
  readonly to: number;
  readonly hunks: number;
}

/** The neighbourhood of changes starting at `ops[start]`, which must not be equal. */
function clusterAt(ops: readonly DiffOp[], start: number): Cluster {
  let to = start;
  let hunks = 1;
  let i = start;
  while (i < ops.length) {
    const op = ops[i];
    if (op === undefined) break;
    if (op.kind !== 'equal') {
      to = i;
      i++;
      continue;
    }
    // An equal run only holds the neighbourhood together if more changes
    // follow it closely enough.
    const next = ops[i + 1];
    if (op.aEnd - op.aStart > CLUSTER_GAP || next === undefined || next.kind === 'equal') break;
    hunks++;
    i++;
  }
  return { from: start, to, hunks };
}

export function refineDiff(ops: readonly DiffOp[], a: string, b: string): readonly DiffOp[] {
  let budget = CELL_BUDGET;
  const out: DiffOp[] = [];
  const push = (op: DiffOp): void => {
    const last = out[out.length - 1];
    if (last?.kind === op.kind && last.aEnd === op.aStart && last.bEnd === op.bStart) {
      out[out.length - 1] = { ...last, aEnd: op.aEnd, bEnd: op.bEnd };
      return;
    }
    if (op.aEnd > op.aStart || op.bEnd > op.bStart) out.push(op);
  };

  let i = 0;
  while (i < ops.length) {
    const op = ops[i];
    if (op === undefined) break;
    if (op.kind === 'equal') {
      push(op);
      i++;
      continue;
    }
    const cluster = clusterAt(ops, i);
    const first = ops[cluster.from];
    const last = ops[cluster.to];
    const cells =
      first === undefined || last === undefined
        ? Infinity
        : (last.aEnd - first.aStart + 1) * (last.bEnd - first.bStart + 1);
    const realigned =
      cluster.hunks > 1 &&
      cells <= Math.min(MAX_CLUSTER_CELLS, budget) &&
      first !== undefined &&
      last !== undefined
        ? realign(a, b, first.aStart, last.aEnd, first.bStart, last.bEnd)
        : null;
    if (realigned === null) {
      for (let k = cluster.from; k <= cluster.to; k++) {
        const kept = ops[k];
        if (kept !== undefined) push(kept);
      }
    } else {
      budget -= cells;
      for (const refined of realigned) push(refined);
    }
    i = cluster.to + 1;
  }
  return out;
}

/**
 * Replaces one neighbourhood with the affine-gap alignment of the two
 * stretches it covers. Returns null if the alignment does not account for
 * both of them in full, in which case the caller keeps what it had.
 */
function realign(
  a: string,
  b: string,
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): DiffOp[] | null {
  const aSeg = a.slice(aStart, aEnd);
  const bSeg = b.slice(bStart, bEnd);
  let alignment;
  try {
    alignment = alignPairwise(aSeg, bSeg, { mode: 'global' });
  } catch {
    return null; // too large for the aligner; the cheap script stands
  }
  if (alignment.startA !== 0 || alignment.endA !== aSeg.length) return null;
  if (alignment.startB !== 0 || alignment.endB !== bSeg.length) return null;

  const ops: DiffOp[] = [];
  let ai = aStart;
  let bi = bStart;
  const emit = (kind: DiffOpKind, aFrom: number, aTo: number, bFrom: number, bTo: number): void => {
    const last = ops[ops.length - 1];
    if (last?.kind === kind && last.aEnd === aFrom && last.bEnd === bFrom) {
      ops[ops.length - 1] = { ...last, aEnd: aTo, bEnd: bTo };
      return;
    }
    ops.push({ kind, aStart: aFrom, aEnd: aTo, bStart: bFrom, bEnd: bTo });
  };

  for (let k = 0; k < alignment.alignedA.length; k++) {
    const x = alignment.alignedA.charAt(k);
    const y = alignment.alignedB.charAt(k);
    if (x === '-') {
      emit('insert', ai, ai, bi, bi + 1);
      bi++;
    } else if (y === '-') {
      emit('delete', ai, ai + 1, bi, bi);
      ai++;
    } else {
      // The aligner works in upper case; the documents keep the case they
      // were written in, so compare the originals — changing a to A is an edit.
      if (a.charAt(ai) === b.charAt(bi)) {
        emit('equal', ai, ai + 1, bi, bi + 1);
      } else {
        emit('delete', ai, ai + 1, bi, bi);
        emit('insert', ai + 1, ai + 1, bi, bi + 1);
      }
      ai++;
      bi++;
    }
  }
  return ai === aEnd && bi === bEnd ? ops : null;
}
