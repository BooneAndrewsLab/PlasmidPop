import { type Strand } from '../features';
import { type Range, type Topology, rangePieces } from '../range';
import { type FeatureLibrary } from './library';

/**
 * Finding the library's parts in a sequence (item 59): on both strands,
 * exactly or with a few substitutions, through the origin of a circle.
 *
 * The parts are indexed once by every 12-mer they contain, on both strands.
 * The sequence is read 12-mer by 12-mer; each word it shares with a part
 * names a diagonal — where the part would start if the word is where it
 * belongs — and each diagonal is checked once, base by base, stopping as soon
 * as it has more mismatches than the part is allowed. A chance word is
 * therefore dismissed after a handful of bases, and a 1 Mb sequence against
 * the whole library takes a fraction of a second (docs/perf-notes.md).
 *
 * The seeding is sure: a part of L bases matched with m mismatches has
 * L + 1 − 12(m + 1) words in common with the sequence (the q-gram lemma), at
 * least one when m < L / 12, so the budget is capped there and a match within
 * it is never missed for want of a seed. Parts shorter than 24 bases must
 * match exactly. Mismatches are substitutions only; a part with an insertion
 * or deletion is not found.
 *
 * Align's banded seeding (items 45, 46) answers a different question — one
 * long read against one reference, anchors chained along a diagonal — and
 * its index is of the reference; here there are hundreds of short queries and
 * one long target, so the index is of the queries and a diagonal is checked
 * directly rather than chained.
 */

export const SEED = 12;
const SEED_MASK = (1 << (2 * SEED)) - 1;

/** Default least share of a part's bases that must match, 0–1. */
export const DEFAULT_MIN_IDENTITY = 0.95;

/** The identities the Features tab offers to insist on: exact, 98%, 95%, 90%. */
export const MIN_IDENTITY_CHOICES: readonly number[] = [1, 0.98, 0.95, 0.9];

export function isMinIdentityChoice(value: unknown): value is number {
  return typeof value === 'number' && MIN_IDENTITY_CHOICES.includes(value);
}

export interface DetectOptions {
  /** Least share of a part's bases that must match, 0–1; `DEFAULT_MIN_IDENTITY` by default. */
  readonly minIdentity?: number;
  readonly onProgress?: (fraction: number) => void;
}

export interface FeatureHit {
  /** Index of the part in the library. */
  readonly part: number;
  /** Where it lies, unrolled: `end` passes the length when it runs over the origin. */
  readonly range: Range;
  readonly strand: Strand;
  /** Bases of the sequence that differ from the part's. */
  readonly mismatches: number;
  /** Ambiguity codes in the sequence (N, R, …) that allow the part's base. */
  readonly ambiguous: number;
  /** Share of the part's bases matched exactly, 0–1. */
  readonly identity: number;
}

/** A–T as bits of a mask, IUPAC codes as the bases they stand for; 0 is not a base. */
const MASKS = (() => {
  const m = new Uint8Array(128);
  const set = (letters: string, mask: number): void => {
    for (const c of letters) {
      m[c.charCodeAt(0)] = mask;
      m[c.toLowerCase().charCodeAt(0)] = mask;
    }
  };
  set('A', 1);
  set('C', 2);
  set('G', 4);
  set('TU', 8);
  set('R', 5);
  set('Y', 10);
  set('S', 6);
  set('W', 9);
  set('K', 12);
  set('M', 3);
  set('B', 14);
  set('D', 13);
  set('H', 11);
  set('V', 7);
  set('N', 15);
  return m;
})();

/** Two bits per definite base; -1 for anything else. */
const BITS = (() => {
  const b = new Int8Array(16).fill(-1);
  b[1] = 0;
  b[2] = 1;
  b[4] = 2;
  b[8] = 3;
  return b;
})();

function masksOf(seq: string): Uint8Array {
  const out = new Uint8Array(seq.length);
  for (let i = 0; i < seq.length; i++) out[i] = MASKS[seq.charCodeAt(i)] ?? 0;
  return out;
}

const COMPLEMENT_MASK = (() => {
  const c = new Uint8Array(16);
  for (let m = 0; m < 16; m++) {
    c[m] = ((m & 1) << 3) | ((m & 2) << 1) | ((m & 4) >> 1) | ((m & 8) >> 3);
  }
  return c;
})();

interface Entry {
  readonly part: number;
  readonly strand: Strand;
  /** The part as it lies on the forward strand of a hit. */
  readonly masks: Uint8Array;
}

interface FeatureIndex {
  readonly entries: readonly Entry[];
  /** 12-mer → (entry, offset) pairs, flattened. */
  readonly seeds: ReadonlyMap<number, readonly number[]>;
  /**
   * One bit per possible 12-mer (2 MB), set for those in `seeds`: nearly
   * every word of a sequence is in no part, and a bit says so faster than
   * the map can.
   */
  readonly present: Uint8Array;
  readonly longest: number;
}

/**
 * The most mismatches a part of `length` bases may have: what the identity
 * allows, capped where a seed is still certain.
 */
export function mismatchBudget(length: number, minIdentity: number): number {
  const byIdentity = Math.floor(length * (1 - minIdentity) + 1e-9);
  const bySeed = Math.floor(length / SEED) - 1;
  return Math.max(0, Math.min(byIdentity, bySeed));
}

const indexes = new WeakMap<FeatureLibrary, FeatureIndex>();

function indexFor(library: FeatureLibrary): FeatureIndex {
  const known = indexes.get(library);
  if (known !== undefined) return known;
  const entries: Entry[] = [];
  const seeds = new Map<number, number[]>();
  const present = new Uint8Array((SEED_MASK + 1) >>> 3);
  let longest = 0;
  library.parts.forEach((part, index) => {
    if (part.sequence.length < SEED) return;
    longest = Math.max(longest, part.sequence.length);
    const forward = masksOf(part.sequence);
    const reverse = new Uint8Array(forward.length);
    for (let i = 0; i < forward.length; i++) {
      reverse[forward.length - 1 - i] = COMPLEMENT_MASK[forward[i] ?? 0] ?? 0;
    }
    for (const [strand, masks] of [
      ['forward', forward],
      ['reverse', reverse],
    ] as const) {
      const e = entries.length;
      entries.push({ part: index, strand, masks });
      forEachSeed(masks, masks.length, (word, at) => {
        present[word >>> 3] = (present[word >>> 3] ?? 0) | (1 << (word & 7));
        const list = seeds.get(word);
        if (list === undefined) seeds.set(word, [e, at]);
        else list.push(e, at);
      });
    }
  });
  const built = { entries, seeds, present, longest };
  indexes.set(library, built);
  return built;
}

/** Calls `visit(word, start)` for each 12-mer of definite bases in `masks[0, end)`. */
function forEachSeed(
  masks: Uint8Array,
  end: number,
  visit: (word: number, start: number) => void,
  onStride?: (at: number) => void,
): void {
  let word = 0;
  let run = 0;
  for (let p = 0; p < end; p++) {
    if (onStride !== undefined && (p & 0xffff) === 0) onStride(p);
    const bits = BITS[masks[p] ?? 0] ?? -1;
    if (bits < 0) {
      run = 0;
      continue;
    }
    word = ((word << 2) | bits) & SEED_MASK;
    if (++run >= SEED) visit(word, p - SEED + 1);
  }
}

/**
 * Every part of the library found in `sequence`, overlapping hits of one kind
 * reduced to the best (see `keepBest`), in order along the sequence.
 */
export function detectFeatures(
  sequence: string,
  topology: Topology,
  library: FeatureLibrary,
  options: DetectOptions = {},
): FeatureHit[] {
  const minIdentity = options.minIdentity ?? DEFAULT_MIN_IDENTITY;
  const index = indexFor(library);
  const budgets = index.entries.map((e) => mismatchBudget(e.masks.length, minIdentity));
  const n = sequence.length;
  if (n === 0 || index.entries.length === 0) return [];
  const circular = topology === 'circular';
  // A circle is read on past its origin far enough for the longest part
  // (and never so far that a part could cover a base twice).
  const extra = circular ? Math.min(index.longest - 1, n - 1) : 0;
  const target = new Uint8Array(n + extra);
  target.set(masksOf(sequence));
  for (let i = 0; i < extra; i++) target[n + i] = target[i % n] ?? 0;
  const total = target.length;

  const tried = new Set<number>();
  const entryCount = index.entries.length;
  const raw: FeatureHit[] = [];
  const check = (e: number, start: number): void => {
    const entry = index.entries[e];
    if (entry === undefined) return;
    const len = entry.masks.length;
    if (start < 0 || start >= n || len > n || start + len > total) return;
    const key = start * entryCount + e;
    if (tried.has(key)) return;
    tried.add(key);
    let mismatches = 0;
    let ambiguous = 0;
    const budget = budgets[e] ?? 0;
    for (let i = 0; i < len; i++) {
      const t = target[start + i] ?? 0;
      const q = entry.masks[i] ?? 0;
      if (t === q) continue;
      if ((t & q) === 0) mismatches++;
      else ambiguous++;
      if (mismatches + ambiguous > budget) return;
    }
    raw.push({
      part: entry.part,
      range: { start, end: start + len },
      strand: entry.strand,
      mismatches,
      ambiguous,
      identity: (len - mismatches - ambiguous) / len,
    });
  };

  const onProgress = options.onProgress;
  forEachSeed(
    target,
    total,
    (word, at) => {
      if (((index.present[word >>> 3] ?? 0) & (1 << (word & 7))) === 0) return;
      const list = index.seeds.get(word);
      if (list === undefined) return;
      for (let k = 0; k + 1 < list.length; k += 2) check(list[k] ?? 0, at - (list[k + 1] ?? 0));
    },
    onProgress === undefined
      ? undefined
      : (at) => {
          onProgress(at / total);
        },
  );
  return keepBest(raw, library, n, topology);
}

/** Bases two ranges share, either of which may run over the origin of a circle. */
export function overlapLength(a: Range, b: Range, length: number, topology: Topology): number {
  if (topology === 'linear')
    return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  let shared = 0;
  for (const p of rangePieces(a, length)) {
    for (const q of rangePieces(b, length)) {
      shared += Math.max(0, Math.min(p.end, q.end) - Math.max(p.start, q.start));
    }
  }
  return shared;
}

/**
 * Hits reduced to the ones worth offering. A part found twice over the same
 * bases — a palindrome on both strands, a repetitive part a few bases along —
 * is kept once, where it fits best. And a hit is dropped when another of
 * the same feature type covers at least 90% of it, is at least as long, and
 * matches at least as well — which takes out, in turn:
 *
 * - a close variant of the part that fits better (the pUC origin where
 *   pBR322's matches exactly);
 * - a part inside a longer one (lacZα inside lacZ).
 *
 * Hits of different types never displace each other: a primer site inside a
 * promoter is two features.
 */
function keepBest(
  hits: readonly FeatureHit[],
  library: FeatureLibrary,
  length: number,
  topology: Topology,
): FeatureHit[] {
  const size = (h: FeatureHit): number => h.range.end - h.range.start;
  const matched = (h: FeatureHit): number => size(h) - h.mismatches - h.ambiguous;
  // Best first: longer, then more bases matched, then forward, then library order.
  const ranked = [...hits].sort(
    (x, y) =>
      size(y) - size(x) ||
      matched(y) - matched(x) ||
      (x.strand === y.strand ? 0 : x.strand === 'forward' ? -1 : 1) ||
      x.part - y.part ||
      x.range.start - y.range.start,
  );
  const kept: FeatureHit[] = [];
  for (const h of ranked) {
    const type = library.parts[h.part]?.type;
    const displaced = kept.some((k) => {
      const shared = overlapLength(k.range, h.range, length, topology);
      if (k.part === h.part) return shared > 0;
      return (
        library.parts[k.part]?.type === type && k.identity >= h.identity && shared >= 0.9 * size(h)
      );
    });
    if (!displaced) kept.push(h);
  }
  return kept.sort((x, y) => x.range.start - y.range.start || size(y) - size(x));
}
