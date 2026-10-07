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
 * inside was removed still comes back as a range. A run that was replaced
 * (deletes and inserts with no equal bases between) maps its bases one to
 * one onto the new ones from the run's start while both last, as an editor
 * does that overwrites in place, and the rest onto the boundary after the
 * run. The refined diff may draw a replace as bases inserted, the old base
 * deleted and more inserted; the deleted base is still overwritten first
 * (#192).
 */
export function positionMapper(
  diff: SequenceDiff,
  aLength: number,
  bLength: number,
): (position: number) => number {
  // Only `equal` and `delete` runs cover the first input, and they do so in
  // order, so their starts are a sorted key for binary search.
  const spans = diff.ops.filter((op) => op.aEnd > op.aStart);
  // Where in the second input a delete run's first base is overwritten, and
  // where the replaced run it is part of ends, when that run inserted any.
  const replacement = new Map<DiffOp, { readonly bStart: number; readonly bEnd: number }>();
  for (let from = 0; from < diff.ops.length;) {
    let to = from;
    while (to < diff.ops.length && diff.ops[to]?.kind !== 'equal') to++;
    const run = diff.ops.slice(from, to);
    const first = run[0];
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined && run.some((op) => op.kind === 'insert')) {
      let bStart = first.bStart;
      for (const op of run) {
        if (op.kind !== 'delete') continue;
        replacement.set(op, { bStart, bEnd: last.bEnd });
        bStart += op.aEnd - op.aStart;
      }
    }
    from = to + 1;
  }
  return (position: number): number => {
    if (position >= aLength) return bLength;
    if (position < 0) return 0;
    let lo = 0;
    let hi = spans.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const span = spans[mid];
      if (span === undefined) break;
      if (position < span.aStart) hi = mid - 1;
      else if (position >= span.aEnd) lo = mid + 1;
      else {
        if (span.kind === 'equal') return span.bStart + (position - span.aStart);
        const by = replacement.get(span);
        if (by === undefined) return span.bStart;
        return Math.min(by.bStart + (position - span.aStart), by.bEnd);
      }
    }
    return bLength;
  };
}

/** How far a run of `length` bases at `at` in `text` can slide left and right and read the same. */
function slideRange(text: string, at: number, length: number): { left: number; right: number } {
  let left = 0;
  while (at - left > 0 && text[at - left - 1] === text[at + length - left - 1]) left++;
  let right = 0;
  while (at + length + right < text.length && text[at + right] === text[at + length + right]) {
    right++;
  }
  return { left, right };
}

/**
 * The most equal bases between two edits that still read as one replaced
 * stretch, and the most an overwrite can reach past them.
 */
const MERGE_GAP = 8;

/** A range's first base (`end` false) or its exclusive end (`end` true). */
export interface Edge {
  readonly position: number;
  readonly end: boolean;
}

/** The most combined readings tried for one feature before trying them one at a time. */
const MAX_READINGS = 4096;

/**
 * Where the edges of one feature can land in the second input, one array per
 * reading of the diff (the diff as drawn first), each giving every edge's
 * place in the order asked. An insertion or deletion inside a run of
 * repeated bases can be drawn at any point along it, and a stretch of edits
 * may be an editor's overwrite (#185); which the editor did is not in the
 * sequences, so every reading counts — but a feature's edges, all its
 * segments' included, move together under one reading: a start slid one way
 * and an end the other is a feature no editor kept (#189). `a` and `b` are
 * the first and second input. On a `circular` pair, edits either side of
 * the origin are one stretch, and an end past the sequence (a segment over
 * the origin) is the same edge a turn on. Edges come a range at a time, its
 * start then its end, so a reading that moves the origin can keep each
 * range in one piece.
 */
export function equivalentMappings(
  diff: SequenceDiff,
  a: string,
  b: string,
  map: (position: number) => number,
  circular = false,
): { readonly readings: (edges: readonly Edge[]) => Iterable<readonly number[]> } {
  interface Indel {
    readonly insert: boolean;
    /** Where in `a` it sits, and how many bases. */
    readonly at: number;
    readonly length: number;
    readonly left: number;
    readonly right: number;
  }
  const indels: Indel[] = [];
  diff.ops.forEach((op, i) => {
    // A delete beside an insert is a replaced run, whose bases map one to one.
    if (op.kind === 'equal') return;
    const pair = op.kind === 'insert' ? 'delete' : 'insert';
    if (diff.ops[i - 1]?.kind === pair || diff.ops[i + 1]?.kind === pair) return;
    if (op.kind === 'delete') {
      const length = op.aEnd - op.aStart;
      indels.push({ insert: false, at: op.aStart, length, ...slideRange(a, op.aStart, length) });
    } else {
      const length = op.bEnd - op.bStart;
      indels.push({ insert: true, at: op.aStart, length, ...slideRange(b, op.bStart, length) });
    }
  });
  /** Where `position` lands when the indel is drawn at `d`; `end` is an exclusive end. */
  const where = (indel: Indel, d: number, position: number, end: boolean): number => {
    const n = indel.length;
    if (indel.insert) return (end ? position <= d : position < d) ? position : position + n;
    return position < d ? position : position < d + n ? d : position - n;
  };
  // Runs of edits a few equal bases apart read as one replaced stretch, which
  // an editor that overwrites in place maps one to one and not as the diff
  // drew it. A replace by longer text overwrites the selection and inserts
  // the rest after it, so a stretch that only added bases (T replaced by CT,
  // drawn as C inserted before T) may have overwritten up to MERGE_GAP of the
  // equal bases after it too: which, the sequences do not say (#185). One
  // that only lost bases likewise (GAA replaced by A, drawn as GA deleted,
  // moves a feature on the G to the new A), and is one stretch with the edits
  // either side of the origin like any other (#190).
  interface Stretch {
    aStart: number;
    aEnd: number;
    bStart: number;
    bEnd: number;
  }
  const stretches: Stretch[] = [];
  let open: Stretch | undefined;
  const close = (): void => {
    if (open !== undefined) stretches.push(open);
    open = undefined;
  };
  for (const op of diff.ops) {
    if (op.kind === 'equal') {
      if (op.aEnd - op.aStart > MERGE_GAP) close();
      continue;
    }
    open ??= { aStart: op.aStart, aEnd: op.aStart, bStart: op.bStart, bEnd: op.bStart };
    open.aEnd = Math.max(open.aEnd, op.aEnd);
    open.bEnd = Math.max(open.bEnd, op.bEnd);
  }
  close();
  // On a circle the linear diff cuts a stretch over the origin in two: the
  // last one runs on, a turn later, into the first.
  const equalRun = (op: DiffOp | undefined): number =>
    op?.kind === 'equal' ? op.aEnd - op.aStart : 0;
  const lead = equalRun(diff.ops[0]);
  const trail = equalRun(diff.ops[diff.ops.length - 1]);
  const head = stretches[0];
  const tail = stretches[stretches.length - 1];
  if (
    circular &&
    head !== undefined &&
    tail !== undefined &&
    head !== tail &&
    head.aStart === lead &&
    tail.aEnd === a.length - trail &&
    lead + trail <= MERGE_GAP
  ) {
    tail.aEnd = head.aEnd + a.length;
    tail.bEnd = head.bEnd + b.length;
    stretches.shift();
  }
  /** Where an exclusive end lands as the diff drew it: an insertion right at it lies outside. */
  const drawnEnd = (position: number): number =>
    position > 0 ? Math.min(map(position - 1) + 1, map(position)) : map(position);
  const drawnAt = (position: number, end: boolean): number =>
    end ? drawnEnd(position) : map(position);

  // Each ambiguous edit is one group, and a reading picks one choice per
  // group: the diff as drawn, an indel slid to another point of its repeat,
  // or a stretch read as an editor's overwrite reaching `x` bases past it.
  // An indel inside an overwritten stretch is the same edit, so it is a
  // choice of that stretch's group and the two are never combined. A choice
  // says how far it moves a position from where the diff drew it.
  type Choice = (position: number, end: boolean) => number;
  interface Group {
    readonly near: (position: number) => boolean;
    readonly choices: (positions: readonly number[]) => readonly Choice[];
  }
  const inStretch = (at: number, run: Stretch): boolean =>
    (at >= run.aStart && at <= run.aEnd) ||
    (circular && at + a.length >= run.aStart && at + a.length <= run.aEnd);
  const slideNear = (indel: Indel) => (position: number) =>
    position >= indel.at - indel.left &&
    position <= indel.at + indel.right + (indel.insert ? 0 : indel.length);
  /**
   * The slides of `indel` that place the edges at `positions` differently.
   * Away from an edge a slide moves it the same as its neighbours do, so a
   * slide is tried only near an edge (and at the run's start), not at every
   * point of a run that may be thousands of bases long.
   */
  const slides = (indel: Indel, positions: readonly number[]): Choice[] => {
    const near = slideNear(indel);
    const lo = indel.at - indel.left;
    const hi = indel.at + indel.right;
    const tried = new Set<number>([lo]);
    for (const p of positions) {
      if (!near(p)) continue;
      const from = Math.max(lo, p - (indel.insert ? 1 : indel.length + 1));
      for (let d = from; d <= Math.min(hi, p + 2); d++) tried.add(d);
    }
    tried.delete(indel.at);
    return [...tried].map(
      (d) => (position, end) =>
        near(position) ? where(indel, d, position, end) - where(indel, indel.at, position, end) : 0,
    );
  };
  /**
   * Where the base `into` bases into `run` lands when an editor replaced the
   * stretch and `x` equal bases after it: it overwrites the common length in
   * place, then inserts or deletes the difference right after that.
   */
  const overwrite = (run: Stretch, x: number, into: number, end: boolean): number => {
    const from = run.aEnd - run.aStart + x;
    const to = run.bEnd - run.bStart + x;
    const common = Math.min(from, to);
    if (into < common) return run.bStart + into;
    if (into > common) return run.bStart + to;
    // An insertion at an end lies outside it; at a start, before it.
    return run.bStart + into + (to > from && !end ? to - from : 0);
  };
  /**
   * Whether an overwrite of `run` may reach `x` bases past it. One that added
   * bases may reach over the origin, the way a small rotation reads (#185),
   * but the editor inserts what it added right after the overwritten bases
   * counted a turn on: one that ends at the origin adds them at 0, and one
   * over it adds them before the stretch's place in the second input, so the
   * diff must have drawn every base gained before that place (#191).
   * One that lost bases deletes them right after what it overwrote, and that
   * deletion may not start at the origin or run over it, since it would have
   * moved the origin (a reading of its own, below). It may lie wholly past
   * the origin of a stretch the diff drew over it, where the editor leaves
   * the overwritten bases after the origin in place and what follows the
   * deletion shifted by all the bases lost, as the diff drew them (#190).
   */
  const reaches = (run: Stretch, x: number): boolean => {
    if (!circular || x === 0) return true;
    const shifted = run.bStart - run.aStart === b.length - a.length;
    if (run.bEnd - run.bStart > run.aEnd - run.aStart) {
      return run.aEnd + x < a.length || (run.aEnd + x > a.length && shifted);
    }
    if (run.aEnd + x <= a.length) return true;
    return run.aEnd > a.length && run.aStart + (run.bEnd - run.bStart) + x > a.length && shifted;
  };
  const overwrites = (run: Stretch): Choice[] => {
    const choices: Choice[] = [];
    for (let x = 0; x <= MERGE_GAP; x++) {
      if (!reaches(run, x)) continue;
      choices.push((position, end) => {
        // A stretch over the origin holds the positions after it a turn on.
        for (const at of circular ? [position, position + a.length] : [position]) {
          if (at < run.aStart || at > run.aEnd + x) continue;
          const landed = overwrite(run, x, at - run.aStart, end);
          // Past the end of `b` is a turn on; the end itself also ends a range.
          return landed - (circular && landed > b.length ? b.length : 0) - drawnAt(position, end);
        }
        return 0;
      });
    }
    return choices;
  };
  const groups: Group[] = stretches.map((run) => {
    const members = indels.filter((indel) => inStretch(indel.at, run));
    const last = run.aEnd + MERGE_GAP;
    return {
      near: (position) =>
        members.some((indel) => slideNear(indel)(position)) ||
        (position >= run.aStart && position <= last) ||
        (circular && position + a.length >= run.aStart && position + a.length <= last),
      choices: (positions) => [
        ...members.flatMap((indel) => slides(indel, positions)),
        ...overwrites(run),
      ],
    };
  });
  for (const indel of indels) {
    if (stretches.some((run) => inStretch(indel.at, run))) continue;
    groups.push({ near: slideNear(indel), choices: (positions) => slides(indel, positions) });
  }

  // A replace by shorter text across the origin of a circle deletes over it
  // and so moves the origin: the bases that start the second input are those
  // right after the selection. In a repeat the diff may draw that edit as
  // some other one of the same cost, with no stretch at either end to merge
  // (#190). Read in the first input turned to start `turn` bases on, it is
  // one stretch at the end, kept bases first. Every turn is a reading of its
  // own whose stretch costs no more than the diff as drawn plus an overwrite
  // of MERGE_GAP bases, as far as an overwrite may reach past a stretch.
  const cost =
    diff.ops.reduce(
      (sum, op) => sum + (op.kind === 'equal' ? 0 : op.aEnd - op.aStart + op.bEnd - op.bStart),
      0,
    ) +
    2 * MERGE_GAP;
  const turns: { readonly turn: number; readonly run: Stretch }[] = [];
  // The deletion must start at or before the origin (`turn + b.length <=
  // a.length`), and the stretch costs at least the bases deleted after it.
  for (let turn = 1; circular && turn <= Math.min(cost - 1, a.length - b.length); turn++) {
    // Kept bases: the longest run from `turn` on that starts `b`, short of a
    // whole turn so the selection still starts before the origin.
    const most = Math.min(b.length, a.length - turn - 1);
    let kept = 0;
    while (kept < most && a[turn + kept] === b[kept]) kept++;
    if (a.length - kept + (b.length - kept) > cost) continue;
    turns.push({ turn, run: { aStart: kept, aEnd: a.length, bStart: kept, bEnd: b.length } });
  }
  /** Where an edge lands when the edit was a replace over the origin turned by `turn`. */
  const rotated = (turn: number, run: Stretch, position: number, end: boolean): number => {
    // The base at `turn` is the new origin; an end there closes a whole turn.
    const at = position - turn + (position > turn || (!end && position === turn) ? 0 : a.length);
    return at < run.aStart ? at : overwrite(run, 0, at - run.aStart, end);
  };

  function* readings(edges: readonly Edge[]): Generator<readonly number[]> {
    yield* drawings(edges);
    for (const { turn, run } of turns) {
      const placed = edges.map(({ position, end }) => {
        const fixed = position < 0 || (end ? position <= 0 : position >= a.length);
        return fixed
          ? map(position)
          : rotated(turn, run, position > a.length ? position - a.length : position, end);
      });
      // A range that held the base the new origin is at now ends a turn on.
      for (let i = 1; i < edges.length; i++) {
        const start = edges[i - 1];
        const end = edges[i];
        const from = placed[i - 1];
        const to = placed[i];
        if (start?.end !== false || end?.end !== true || from === undefined || to === undefined)
          continue;
        if (to < from || (to === from && end.position - start.position >= a.length))
          placed[i] = to + b.length;
      }
      yield placed;
    }
  }

  function* drawings(edges: readonly Edge[]): Generator<readonly number[]> {
    // An end past the sequence wraps the origin: it reads as the same edge a
    // turn on. A start there, or anything before 0, is only mapped.
    const local = edges.map(({ position, end }) => {
      const turned = end && position > a.length;
      const fixed = position < 0 || (end ? position <= 0 : position >= a.length);
      const at = turned ? position - a.length : position;
      const limit = turned ? 2 * b.length : b.length;
      const drawn = fixed ? map(position) : drawnAt(at, end) + (turned ? b.length : 0);
      return { at, end, fixed, limit, drawn };
    });
    // Per group, each distinct way its readings move these edges.
    const effects: (readonly number[])[][] = [];
    for (const group of groups) {
      if (!local.some((edge) => !edge.fixed && group.near(edge.at))) continue;
      const still = local.map(() => 0);
      const seen = new Set<string>([still.join()]);
      const ways: (readonly number[])[] = [still];
      for (const choice of group.choices(local.map((edge) => edge.at))) {
        const way = local.map((edge) => (edge.fixed ? 0 : choice(edge.at, edge.end)));
        const key = way.join();
        if (seen.has(key)) continue;
        seen.add(key);
        ways.push(way);
      }
      if (ways.length > 1) effects.push(ways);
    }
    const place = (picked: readonly (readonly number[])[]): readonly number[] =>
      local.map((edge, i) =>
        Math.max(
          0,
          Math.min(
            edge.limit,
            picked.reduce((sum, way) => sum + (way[i] ?? 0), edge.drawn),
          ),
        ),
      );
    const combinations = effects.reduce((n, ways) => n * ways.length, 1);
    if (combinations > MAX_READINGS) {
      // Too many to try together: read one group at a time, the others as drawn.
      yield place([]);
      for (const ways of effects) for (const way of ways.slice(1)) yield place([way]);
      return;
    }
    // Readings of different edits combine, but one edge is moved by at most
    // one of them: two readings of nearby edits moving the same edge would
    // each be measured from where the diff drew the other.
    const picked: (readonly number[])[] = [];
    const moved = local.map(() => false);
    function* every(group: number): Generator<readonly number[]> {
      const ways = effects[group];
      if (ways === undefined) {
        yield place(picked);
        return;
      }
      for (const way of ways) {
        if (way.some((delta, i) => delta !== 0 && moved[i])) continue;
        const now = way.map((delta, i) => delta !== 0 && !moved[i]);
        now.forEach((set, i) => {
          if (set) moved[i] = true;
        });
        picked.push(way);
        yield* every(group + 1);
        picked.pop();
        now.forEach((set, i) => {
          if (set) moved[i] = false;
        });
      }
    }
    yield* every(0);
  }
  return { readings };
}
