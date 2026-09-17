/**
 * Static centered interval tree over half-open, non-empty intervals.
 * Built once per FeatureSet version (they are immutable) and queried in
 * O(log n + k).
 */

export interface Interval<T> {
  readonly start: number;
  readonly end: number;
  readonly value: T;
}

interface TreeNode<T> {
  readonly center: number;
  /** Intervals containing `center`, sorted by ascending start. */
  readonly byStart: readonly Interval<T>[];
  /** The same intervals, sorted by descending end. */
  readonly byEnd: readonly Interval<T>[];
  readonly left: TreeNode<T> | null;
  readonly right: TreeNode<T> | null;
}

function build<T>(intervals: readonly Interval<T>[]): TreeNode<T> | null {
  if (intervals.length === 0) return null;
  const midpoints = intervals.map((iv) => (iv.start + iv.end) / 2).sort((a, b) => a - b);
  const center = midpoints[Math.floor(midpoints.length / 2)] ?? 0;

  const leftItems: Interval<T>[] = [];
  const rightItems: Interval<T>[] = [];
  const middle: Interval<T>[] = [];
  for (const iv of intervals) {
    if (iv.end <= center) leftItems.push(iv);
    else if (iv.start > center) rightItems.push(iv);
    else middle.push(iv);
  }
  // Every interval either contains the center or is strictly to one side, and
  // the median midpoint guarantees both sides are non-empty only when the
  // middle is, so recursion terminates.
  return {
    center,
    byStart: [...middle].sort((a, b) => a.start - b.start),
    byEnd: [...middle].sort((a, b) => b.end - a.end),
    left: build(leftItems),
    right: build(rightItems),
  };
}

function query<T>(node: TreeNode<T> | null, qStart: number, qEnd: number, out: T[]): void {
  if (node === null) return;
  if (qEnd <= node.center) {
    for (const iv of node.byStart) {
      if (iv.start >= qEnd) break;
      out.push(iv.value);
    }
    query(node.left, qStart, qEnd, out);
  } else if (qStart > node.center) {
    for (const iv of node.byEnd) {
      if (iv.end <= qStart) break;
      out.push(iv.value);
    }
    query(node.right, qStart, qEnd, out);
  } else {
    for (const iv of node.byStart) out.push(iv.value);
    query(node.left, qStart, qEnd, out);
    query(node.right, qStart, qEnd, out);
  }
}

export class IntervalTree<T> {
  private readonly root: TreeNode<T> | null;

  constructor(intervals: readonly Interval<T>[]) {
    for (const iv of intervals) {
      if (!(iv.end > iv.start)) {
        throw new RangeError(
          `IntervalTree requires non-empty intervals, got [${iv.start}, ${iv.end})`,
        );
      }
    }
    this.root = build(intervals);
  }

  /** Values of all intervals that share at least one point with `[start, end)`. */
  overlapping(start: number, end: number): T[] {
    const out: T[] = [];
    if (end > start) query(this.root, start, end, out);
    return out;
  }
}
