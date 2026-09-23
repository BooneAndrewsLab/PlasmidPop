import {
  type AlignmentMode,
  type AlignmentOptions,
  type AlignmentProgress,
  type Band,
  type BandedResult,
  alignInBand,
} from './pairwise';

/**
 * Banded alignment for a long read against the sequence it came from (#51).
 * A 10 kb read against a 12 kb plasmid is 120 million cells in full, but
 * the path keeps close to one diagonal: this fills only a band around it,
 * found from the words the two share, so the work grows with the read's
 * length rather than with the product of the two.
 *
 * 1. Anchors: every 15-mer of the read found in the reference (skipping
 *    words that occur more than a few times there, which are repeats and
 *    only mislead).
 * 2. A chain: the longest run of anchors increasing in both sequences, the
 *    longest increasing subsequence over them; an anchor whose diagonal is
 *    far from both its neighbours' is dropped as a chance match.
 * 3. The band: the optimal path between two anchors that lie on it cannot
 *    leave the rectangle they span, so the band is the union of the
 *    rectangles between consecutive anchors, widened by a margin for the
 *    anchors that are slightly off it. Past the ends of the chain it follows
 *    the diagonal. A global alignment has the matrix's corners as anchors.
 *
 * If the path found touches the band's edge, a better one may lie outside,
 * and `alignLong` widens the margin and tries again.
 */

const K = 15;
const MASK = 2 ** (2 * K);
/** A word found more often than this in the reference is a repeat, not an anchor. */
const MAX_OCCURRENCES = 4;
/** The fewest anchors that make a chain worth banding around. */
const MIN_CHAIN = 10;

interface Anchor {
  /** Start of the shared word in the reference and in the read. */
  readonly i: number;
  readonly j: number;
}

function baseBits(c: number): number {
  switch (c | 0x20) {
    case 0x61: // a
      return 0;
    case 0x63: // c
      return 1;
    case 0x67: // g
      return 2;
    case 0x74: // t
    case 0x75: // u
      return 3;
    default:
      return -1;
  }
}

/** Calls `visit(kmer, start)` for each 15-mer of definite bases. */
function forEachKmer(seq: string, visit: (kmer: number, start: number) => void): void {
  let kmer = 0;
  let run = 0;
  for (let p = 0; p < seq.length; p++) {
    const bits = baseBits(seq.charCodeAt(p));
    if (bits < 0) {
      run = 0;
      continue;
    }
    // 30 bits: past 2^31 bitwise operators would wrap, so arithmetic it is.
    kmer = (kmer * 4 + bits) % MASK;
    if (++run >= K) visit(kmer, p - K + 1);
  }
}

/** Where the read's words are found in the reference. */
function anchors(reference: string, read: string): Anchor[] {
  const at = new Map<number, number[]>();
  forEachKmer(reference, (kmer, start) => {
    const list = at.get(kmer);
    if (list === undefined) at.set(kmer, [start]);
    else if (list.length <= MAX_OCCURRENCES) list.push(start);
  });
  const out: Anchor[] = [];
  forEachKmer(read, (kmer, j) => {
    const list = at.get(kmer);
    if (list === undefined || list.length > MAX_OCCURRENCES) return;
    for (const i of list) out.push({ i, j });
  });
  return out;
}

/**
 * The longest chain of anchors rising in both sequences: anchors in read
 * order (and, at one read position, reference order backwards, so only one
 * of them can be taken), then the longest subsequence rising in the
 * reference, by patience sorting.
 */
function chain(found: Anchor[]): Anchor[] {
  const sorted = [...found].sort((x, y) => x.j - y.j || y.i - x.i);
  const tails: number[] = []; // index into sorted of the smallest tail of each length
  const previous = new Int32Array(sorted.length).fill(-1);
  for (let k = 0; k < sorted.length; k++) {
    const i = sorted[k]?.i ?? 0;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((sorted[tails[mid] ?? 0]?.i ?? 0) < i) low = mid + 1;
      else high = mid;
    }
    if (low > 0) previous[k] = tails[low - 1] ?? -1;
    tails[low] = k;
  }
  const out: Anchor[] = [];
  for (let k = tails[tails.length - 1] ?? -1; k >= 0; k = previous[k] ?? -1) {
    const a = sorted[k];
    if (a !== undefined) out.push(a);
  }
  return out.reverse();
}

/**
 * The chain without anchors that sit off both their neighbours' diagonals:
 * a word met by chance, which a chain may take in passing. Two anchors
 * agree when their diagonals differ by no more than the indels a read
 * could have between them.
 */
function dropStrays(links: Anchor[]): Anchor[] {
  if (links.length < 3) return links;
  const agree = (x: Anchor, y: Anchor): boolean => {
    const drift = Math.abs(x.i - x.j - (y.i - y.j));
    return drift <= Math.max(30, 0.15 * Math.abs(y.j - x.j));
  };
  return links.filter((a, k) => {
    const before = links[k - 1];
    const after = links[k + 1];
    return (before !== undefined && agree(before, a)) || (after !== undefined && agree(a, after));
  });
}

/** The anchors to band around, or null when the two do not share enough. */
export function anchorChain(reference: string, read: string): readonly Anchor[] | null {
  const links = dropStrays(chain(anchors(reference, read)));
  return links.length >= MIN_CHAIN ? links : null;
}

/**
 * The band around a chain: the rectangles between consecutive anchors, the
 * diagonal past its ends, `margin` either side, made monotone.
 */
export function bandAround(
  links: readonly Anchor[],
  n: number,
  m: number,
  mode: AlignmentMode,
  margin: number,
): Band {
  const lo = new Int32Array(n + 1).fill(m + 1);
  const hi = new Int32Array(n + 1).fill(-1);
  const cover = (i: number, from: number, to: number): void => {
    if (i < 0 || i > n) return;
    lo[i] = Math.min(lo[i] ?? m, Math.max(0, from));
    hi[i] = Math.max(hi[i] ?? 0, Math.min(m, to));
  };
  // A global alignment runs corner to corner; its corners are anchors too.
  const points: Anchor[] =
    mode === 'global' ? [{ i: 0, j: 0 }, ...links, { i: n, j: m }] : [...links];
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) throw new Error('No anchors to band around');
  // Each anchor's own word: its diagonal for K bases.
  for (const p of points) {
    for (let t = 0; t <= K; t++) cover(p.i + t, p.j + t - margin, p.j + t + margin);
  }
  // Between anchors, the rectangle they span.
  for (let k = 1; k < points.length; k++) {
    const p = points[k - 1];
    const q = points[k];
    if (p === undefined || q === undefined) continue;
    for (let i = p.i; i <= q.i; i++) cover(i, p.j - margin, q.j + margin);
  }
  // Past the chain's ends, along the diagonal (only a local alignment has any).
  for (let i = 0; i < first.i; i++) {
    const j = first.j - (first.i - i);
    cover(i, j - margin, j + margin);
  }
  for (let i = last.i + 1; i <= n; i++) {
    const j = last.j + (i - last.i);
    cover(i, j - margin, j + margin);
  }
  // Monotone, never narrower: the lower edge from below, the upper from above.
  for (let i = n - 1; i >= 0; i--) lo[i] = Math.min(lo[i] ?? 0, lo[i + 1] ?? 0);
  for (let i = 1; i <= n; i++) hi[i] = Math.max(hi[i] ?? 0, hi[i - 1] ?? 0);
  for (let i = 0; i <= n; i++) {
    // A row the diagonal left of the matrix still has a cell to hold the path.
    if ((lo[i] ?? 0) > m) lo[i] = m;
    if ((hi[i] ?? 0) < (lo[i] ?? 0)) hi[i] = lo[i] ?? 0;
  }
  // Consecutive rows meet, so every diagonal step has somewhere to land.
  for (let i = 1; i <= n; i++) {
    if ((lo[i] ?? 0) > (hi[i - 1] ?? 0) + 1) lo[i] = (hi[i - 1] ?? 0) + 1;
  }
  if (mode === 'global') {
    lo[0] = 0;
    hi[n] = m;
  }
  return { lo, hi };
}

/** The margins tried in turn while the path runs along the band's edge. */
const MARGINS = [64, 256, 1024];

/**
 * A banded alignment of a long read, or null when the two share too few
 * words to band around (the caller then aligns them in full, if it can).
 */
export function alignBanded(
  reference: string,
  read: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): BandedResult | null {
  const links = anchorChain(reference, read);
  if (links === null) return null;
  const mode = options.mode ?? 'global';
  let result: BandedResult | null = null;
  for (const margin of MARGINS) {
    const band = bandAround(links, reference.length, read.length, mode, margin);
    result = alignInBand(reference, read, band, options, onProgress);
    if (!result.touchedEdge) return result;
  }
  return result;
}
