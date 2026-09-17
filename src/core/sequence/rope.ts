import { type SequenceText } from './sequenceText';

/**
 * Persistent rope. Leaves hold up to `MAX_LEAF` characters; branches cache
 * their length and depth. Structural sharing keeps `insert`/`remove` at
 * O(log n) allocations, and the tree is rebuilt whenever it grows too deep.
 */

const MAX_LEAF = 1024;
const MIN_LEAF = MAX_LEAF / 2;

interface Leaf {
  readonly kind: 'leaf';
  readonly text: string;
}

interface Branch {
  readonly kind: 'branch';
  readonly left: RopeNode;
  readonly right: RopeNode;
  readonly length: number;
  readonly depth: number;
}

type RopeNode = Leaf | Branch;

const EMPTY_LEAF: Leaf = { kind: 'leaf', text: '' };

function nodeLength(n: RopeNode): number {
  return n.kind === 'leaf' ? n.text.length : n.length;
}

function nodeDepth(n: RopeNode): number {
  return n.kind === 'leaf' ? 0 : n.depth;
}

function leaf(text: string): Leaf {
  return { kind: 'leaf', text };
}

function branch(left: RopeNode, right: RopeNode): Branch {
  return {
    kind: 'branch',
    left,
    right,
    length: nodeLength(left) + nodeLength(right),
    depth: Math.max(nodeDepth(left), nodeDepth(right)) + 1,
  };
}

function collectLeaves(n: RopeNode, out: string[]): void {
  if (n.kind === 'leaf') {
    if (n.text.length > 0) out.push(n.text);
    return;
  }
  collectLeaves(n.left, out);
  collectLeaves(n.right, out);
}

/** Balanced tree over the given leaf strings. Small neighbours are merged. */
function buildBalanced(leaves: readonly string[]): RopeNode {
  const merged: string[] = [];
  let pending = '';
  for (const text of leaves) {
    if (pending.length + text.length <= MAX_LEAF) {
      pending += text;
    } else {
      if (pending.length > 0) merged.push(pending);
      pending = text;
    }
  }
  if (pending.length > 0) merged.push(pending);

  const build = (lo: number, hi: number): RopeNode => {
    if (hi - lo === 1) return leaf(merged[lo] ?? '');
    const mid = lo + Math.floor((hi - lo) / 2);
    return branch(build(lo, mid), build(mid, hi));
  };
  return merged.length === 0 ? EMPTY_LEAF : build(0, merged.length);
}

function fromString(text: string): RopeNode {
  if (text.length <= MAX_LEAF) return leaf(text);
  const leaves: string[] = [];
  for (let i = 0; i < text.length; i += MAX_LEAF) leaves.push(text.slice(i, i + MAX_LEAF));
  return buildBalanced(leaves);
}

function maxAllowedDepth(length: number): number {
  const leafCount = Math.max(1, Math.ceil(length / MIN_LEAF));
  return 2 * Math.ceil(Math.log2(leafCount + 1)) + 8;
}

function rebalanceIfNeeded(n: RopeNode): RopeNode {
  if (nodeDepth(n) <= maxAllowedDepth(nodeLength(n))) return n;
  const leaves: string[] = [];
  collectLeaves(n, leaves);
  return buildBalanced(leaves);
}

function concat(a: RopeNode, b: RopeNode): RopeNode {
  const la = nodeLength(a);
  const lb = nodeLength(b);
  if (la === 0) return b;
  if (lb === 0) return a;
  if (a.kind === 'leaf' && b.kind === 'leaf' && la + lb <= MAX_LEAF) return leaf(a.text + b.text);
  // Fold a short right leaf into the rightmost leaf of `a` (common for
  // typing at the end) to keep leaves from fragmenting.
  if (a.kind === 'branch' && b.kind === 'leaf' && a.right.kind === 'leaf') {
    if (a.right.text.length + lb <= MAX_LEAF) {
      return branch(a.left, leaf(a.right.text + b.text));
    }
  }
  if (b.kind === 'branch' && a.kind === 'leaf' && b.left.kind === 'leaf') {
    if (b.left.text.length + la <= MAX_LEAF) {
      return branch(leaf(a.text + b.left.text), b.right);
    }
  }
  return rebalanceIfNeeded(branch(a, b));
}

/** Sub-rope `[start, end)`; arguments must already be in range. */
function subRope(n: RopeNode, start: number, end: number): RopeNode {
  const len = nodeLength(n);
  if (start <= 0 && end >= len) return n;
  if (end <= start) return EMPTY_LEAF;
  if (n.kind === 'leaf') return leaf(n.text.slice(start, end));
  const leftLen = nodeLength(n.left);
  if (end <= leftLen) return subRope(n.left, start, end);
  if (start >= leftLen) return subRope(n.right, start - leftLen, end - leftLen);
  return concat(subRope(n.left, start, leftLen), subRope(n.right, 0, end - leftLen));
}

function sliceText(n: RopeNode, start: number, end: number, out: string[]): void {
  const len = nodeLength(n);
  if (end <= start) return;
  if (n.kind === 'leaf') {
    out.push(start <= 0 && end >= len ? n.text : n.text.slice(start, end));
    return;
  }
  const leftLen = nodeLength(n.left);
  if (start < leftLen) sliceText(n.left, start, Math.min(end, leftLen), out);
  if (end > leftLen) sliceText(n.right, Math.max(0, start - leftLen), end - leftLen, out);
}

function charAt(n: RopeNode, index: number): string {
  let node = n;
  let i = index;
  for (;;) {
    if (node.kind === 'leaf') return node.text.charAt(i);
    const leftLen = nodeLength(node.left);
    if (i < leftLen) {
      node = node.left;
    } else {
      i -= leftLen;
      node = node.right;
    }
  }
}

export class Rope implements SequenceText {
  static readonly EMPTY = new Rope(EMPTY_LEAF);

  static from(text: string): Rope {
    return text.length === 0 ? Rope.EMPTY : new Rope(fromString(text));
  }

  private constructor(private readonly root: RopeNode) {}

  get length(): number {
    return nodeLength(this.root);
  }

  /** Tree depth; exposed for tests and profiling only. */
  get depth(): number {
    return nodeDepth(this.root);
  }

  charAt(index: number): string {
    if (index < 0 || index >= this.length) return '';
    return charAt(this.root, index);
  }

  slice(start: number, end: number = this.length): string {
    const s = Math.max(0, Math.min(start, this.length));
    const e = Math.max(s, Math.min(end, this.length));
    if (s === 0 && e === this.length && this.root.kind === 'leaf') return this.root.text;
    const parts: string[] = [];
    sliceText(this.root, s, e, parts);
    return parts.join('');
  }

  insert(position: number, text: string): Rope {
    if (position < 0 || position > this.length) {
      throw new RangeError(`Insert position ${position} out of bounds (length ${this.length})`);
    }
    if (text.length === 0) return this;
    const inserted = fromString(text);
    const left = subRope(this.root, 0, position);
    const right = subRope(this.root, position, this.length);
    return new Rope(concat(concat(left, inserted), right));
  }

  remove(start: number, end: number): Rope {
    if (start < 0 || end > this.length || end < start) {
      throw new RangeError(`Remove range [${start}, ${end}) out of bounds (length ${this.length})`);
    }
    if (start === end) return this;
    const left = subRope(this.root, 0, start);
    const right = subRope(this.root, end, this.length);
    return new Rope(concat(left, right));
  }

  toString(): string {
    return this.slice(0, this.length);
  }
}
