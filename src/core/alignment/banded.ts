import {
  type AlignmentMode,
  type AlignmentOptions,
  type AlignmentProgress,
  type Band,
  type BandedResult,
  DEFAULT_MAX_CELLS,
  alignInBand,
  bandCells,
  scoreInBand,
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
 * 4. The check (#167): the band can miss the optimum when the chain sits
 *    off the best path (a tandem repeat, a long insertion near a read end),
 *    and the path found then never touches the band's edge. Its score bounds
 *    how many gap bases a better path could have, and so which diagonals it
 *    could reach; that region is filled too, and the better answer kept.
 *    Global: exact. Local: exact among paths that meet a diagonal of the
 *    chain (one wholly elsewhere is not the chain's alignment), or, against
 *    a repeated circle (`wrap`), the chain one turn on or back (#175).
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

/** The reference's words and where they occur, repeats cut short at the limit. */
function indexWords(reference: string): Map<number, number[]> {
  const at = new Map<number, number[]>();
  forEachKmer(reference, (kmer, start) => {
    const list = at.get(kmer);
    if (list === undefined) at.set(kmer, [start]);
    else if (list.length <= MAX_OCCURRENCES) list.push(start);
  });
  return at;
}

/**
 * The index of the last reference given, so that the reads of a batch, each
 * its own call against the same reference, build it once (#170). Compared
 * by value: the worker gets a fresh copy of the string with every request.
 */
let indexed: { readonly reference: string; readonly at: Map<number, number[]> } | null = null;

function wordIndex(reference: string): Map<number, number[]> {
  if (indexed?.reference !== reference) indexed = { reference, at: indexWords(reference) };
  return indexed.at;
}

/** Where the read's words are found in the reference. */
function anchors(reference: string, read: string): Anchor[] {
  const at = wordIndex(reference);
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

/** What a local path can earn and must pay, as positive magnitudes. */
export interface FlankScoring {
  /** The most one aligned pair can score. */
  readonly gain: number;
  /** The cost of the first base of a gap. */
  readonly gapOpen: number;
  /** The cost of each further base of a gap; 0 means gaps cost no more once open. */
  readonly gapExtend: number;
}

/** EMBOSS DNAfull defaults, as `alignPairwise` has them. */
const DNA_SCORING: FlankScoring = { gain: 5, gapOpen: 10, gapExtend: 0.5 };

/** The scoring `options` imply, for the widest a flank can be. */
export function flankScoring(options: AlignmentOptions): FlankScoring {
  const protein = options.alphabet === 'protein';
  return {
    // Ambiguity codes never score above 5 (EDNAFULL); BLOSUM62 tops out at 11.
    gain: Math.max(options.match ?? 0, protein ? 11 : DNA_SCORING.gain),
    gapOpen: Math.abs(options.gapOpen ?? (protein ? -11 : -10)),
    gapExtend: Math.abs(options.gapExtend ?? (protein ? -1 : -0.5)),
  };
}

/**
 * How far from the chain's end diagonal a local path through a flank of
 * `span` aligned pairs can wander and still score above zero: with G gap
 * bases it earns at most span*gain and pays at least open + (G-1)*extend.
 * Infinity when gaps are free to extend, so no bound holds.
 */
function flankDrift(span: number, scoring: FlankScoring): number {
  if (scoring.gapExtend <= 0) return Infinity;
  return Math.max(0, Math.ceil((span * scoring.gain - scoring.gapOpen) / scoring.gapExtend) + 1);
}

/**
 * The band around a chain: the rectangles between consecutive anchors, the
 * diagonal past its ends, `margin` either side, made monotone. Past the
 * ends of a local chain it is a parallelogram about the end diagonal, as
 * wide as the scoring lets a path drift (see the design note, #159).
 */
export function bandAround(
  links: readonly Anchor[],
  n: number,
  m: number,
  mode: AlignmentMode,
  margin: number,
  scoring: FlankScoring = DNA_SCORING,
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
  // Past the chain's ends (only a local alignment has any): a local path
  // need not stop where the shared words do; it runs on through whatever
  // flank still scores, indels and all, and a band along the diagonal
  // clipped it (#159). It can drift from the end diagonal by at most
  // `drift` + margin, since each pair earns at most `gain` and the pairs
  // before the anchor number at most min(rows, columns) of the flank.
  if (mode === 'local') {
    const leadDrift = flankDrift(Math.min(first.i, first.j + margin), scoring);
    const leadShift = first.j - first.i;
    for (let i = 0; i < first.i; i++) {
      const to = Math.min(first.j + margin, i + leadShift + leadDrift + margin);
      const from = i + leadShift - leadDrift - margin;
      if (to >= 0 && from <= m) cover(i, from, to);
    }
    const tailDrift = flankDrift(Math.min(n - last.i, m - last.j + margin), scoring);
    const tailShift = last.j - last.i;
    for (let i = last.i + 1; i <= n; i++) {
      const from = Math.max(last.j - margin, i + tailShift - tailDrift - margin);
      const to = i + tailShift + tailDrift + margin;
      if (to >= 0 && from <= m) cover(i, from, to);
    }
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

/**
 * The most gap bases a path can hold and still score at least `score`.
 * Each aligned pair earns at most `gain` and G gap bases cost at least
 * open + (G-1)*extend' with extend' = min(open, extend), however they are
 * split into runs. A global path has (n+m-G)/2 pairs, so a gap base costs
 * it gain/2 in pairs it can no longer have on top; a local path has at most
 * min(n, m). Infinity when nothing bounds it (gaps free to extend, local).
 */
export function gapBound(
  n: number,
  m: number,
  mode: AlignmentMode,
  score: number,
  scoring: FlankScoring,
): number {
  const { gain, gapOpen } = scoring;
  const extend = Math.min(gapOpen, scoring.gapExtend);
  if (mode === 'global') {
    return Math.max(
      Math.abs(n - m),
      Math.floor((gain * ((n + m) / 2) - gapOpen + extend - score) / (gain / 2 + extend)),
    );
  }
  if (extend <= 0) return Infinity;
  return Math.max(0, Math.floor((gain * Math.min(n, m) - gapOpen - score) / extend) + 1);
}

/**
 * The cells a path scoring at least `score` can reach (#167), as a band of
 * diagonals d = i - j. A path's diagonal moves by one with each gap base,
 * so all of a path with at most G gap bases lies within G of any one of its
 * cells' diagonals. Global: the path runs from diagonal 0 to n - m, so a
 * diagonal d costs it |d| + |d - (n - m)| gap bases at least. Local: the
 * path meets a diagonal of the chain, [first, last] of its anchors', so it
 * lies within G of that span. Rows of the matrix with no cell in it keep
 * one, at its edge, which no path through the region uses.
 */
export function boundBand(
  links: readonly Anchor[],
  n: number,
  m: number,
  mode: AlignmentMode,
  score: number,
  scoring: FlankScoring = DNA_SCORING,
): Band {
  const gaps = gapBound(n, m, mode, score, scoring);
  let low: number;
  let high: number;
  if (mode === 'global') {
    low = Math.floor((n - m - gaps) / 2);
    high = Math.ceil((n - m + gaps) / 2);
  } else {
    low = Infinity;
    high = -Infinity;
    for (const a of links) {
      low = Math.min(low, a.i - a.j);
      high = Math.max(high, a.i - a.j);
    }
    low -= gaps;
    high += gaps;
  }
  low = Math.max(low, -m);
  high = Math.min(high, n);
  const lo = new Int32Array(n + 1);
  const hi = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) {
    lo[i] = Math.min(m, Math.max(0, i - high));
    hi[i] = Math.min(m, Math.max(0, i - low));
  }
  return { lo, hi };
}

/** An alignment in a band, and whether it is checked to be the best. */
export interface CheckedResult extends BandedResult {
  /**
   * The region `boundBand` gives was filled, so no path that could score
   * higher was left out. False when that region is larger than
   * `CHECK_UP_TO` (a long noisy read in local mode, typically): the band's
   * answer is then the best found, as before #167, and the caller may
   * still align in full.
   */
  readonly exact: boolean;
  /** The cells filled to get here, every band and region counted. */
  readonly filled: number;
}

/**
 * The most cells spent checking a band's answer: what a full alignment may
 * take before a band is used instead (`alignLong`), under a second. Past
 * it a check would cost as much as the full alignment it replaces.
 */
export const CHECK_UP_TO = 25_000_000;

/** The margins tried in turn while the path runs along the band's edge. */
const MARGINS = [64, 256, 1024] as const;

/**
 * The regions a better path could lie in: the one about the chain's
 * diagonals and, for a local alignment against a repeated circle (`wrap`),
 * the same about the chain one turn on and one back (#175). A read that
 * starts a few bases before the origin shares its words with both copies
 * of the start, the chain takes the first, and the read's own path, through
 * the end of the first copy into the second, lies a turn on from it.
 */
function checkRegions(
  links: readonly Anchor[],
  n: number,
  m: number,
  mode: AlignmentMode,
  score: number,
  scoring: FlankScoring,
  wrap: number | undefined,
): Band[] {
  const regions = [boundBand(links, n, m, mode, score, scoring)];
  if (mode !== 'local' || wrap === undefined || wrap <= 0 || wrap >= n) return regions;
  const gaps = gapBound(n, m, mode, score, scoring);
  let low = Infinity;
  let high = -Infinity;
  for (const a of links) {
    low = Math.min(low, a.i - a.j);
    high = Math.max(high, a.i - a.j);
  }
  for (const turn of [wrap, -wrap]) {
    // Diagonals d = i - j run from -m to n; a turn that leaves them all has
    // no path in the matrix.
    if (high + turn + gaps < -m || low + turn - gaps > n) continue;
    const shifted = links.map((a) => ({ i: a.i + turn, j: a.j }));
    regions.push(boundBand(shifted, n, m, mode, score, scoring));
  }
  return regions;
}

/**
 * A banded alignment of a long read, or null when the two share too few
 * words to band around (the caller then aligns them in full, if it can).
 * The band's answer is checked against the region a better path could
 * reach, which is filled when it is at most `CHECK_UP_TO` cells; when it
 * is larger, the band is widened while its path runs along the edge.
 */
export function alignBanded(
  reference: string,
  read: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): CheckedResult | null {
  const links = anchorChain(reference, read);
  if (links === null) return null;
  const mode = options.mode ?? 'global';
  const scoring = flankScoring(options);
  const n = reference.length;
  const m = read.length;
  const budget = Math.min(CHECK_UP_TO, options.maxCells ?? DEFAULT_MAX_CELLS);
  const firstBand = bandAround(links, n, m, mode, MARGINS[0], scoring);
  const first = alignInBand(reference, read, firstBand, options);
  let filled = bandCells(firstBand);
  const regions = checkRegions(links, n, m, mode, first.alignment.score, scoring, options.wrap);
  if (regions.reduce((sum, r) => sum + bandCells(r), 0) <= budget) {
    let best = first.alignment.score;
    let better: Band | null = null;
    for (const [k, region] of regions.entries()) {
      // Each region reports its share of the way.
      const share: AlignmentProgress | undefined =
        onProgress === undefined
          ? undefined
          : (f) => {
              onProgress((k + f) / regions.length);
            };
      const checked = regionScore(reference, read, region, options, share);
      filled += checked.cells;
      if (checked.score > best) {
        best = checked.score;
        better = region;
      }
    }
    if (better === null) return { ...first, exact: true, filled };
    // Found better: the path, once more. No progress: the bar would run
    // back to the start for what takes at most about half a second.
    filled += bandCells(better);
    return { ...alignInBand(reference, read, better, options), exact: true, filled };
  }
  let result = first;
  for (const margin of MARGINS.slice(1)) {
    if (!result.touchedEdge) break;
    const band = bandAround(links, n, m, mode, margin, scoring);
    filled += bandCells(band);
    result = alignInBand(reference, read, band, options, onProgress);
  }
  return { ...result, exact: false, filled };
}

/**
 * The best score in `region`, without traceback, and the cells filled for
 * it. A local region is filled over only the rows it has cells in: a path
 * cannot start above them or end below, so the reference outside them is
 * never read.
 */
function regionScore(
  reference: string,
  read: string,
  region: Band,
  options: AlignmentOptions,
  onProgress?: AlignmentProgress,
): { readonly score: number; readonly cells: number } {
  if ((options.mode ?? 'global') === 'global') {
    return {
      score: scoreInBand(reference, read, region, options, onProgress),
      cells: bandCells(region),
    };
  }
  const m = read.length;
  let top = 0;
  while (top < reference.length && (region.hi[top + 1] ?? 0) === 0) top++;
  let bottom = reference.length;
  while (bottom > top && (region.lo[bottom - 1] ?? 0) === m) bottom--;
  const rows = { lo: region.lo.subarray(top, bottom + 1), hi: region.hi.subarray(top, bottom + 1) };
  return {
    score: scoreInBand(reference.slice(top, bottom), read, rows, options, onProgress),
    cells: bandCells(rows),
  };
}
