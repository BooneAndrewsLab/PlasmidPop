import { type Strand } from '../features/feature';
import { reverseComplement } from '../sequence/alphabet';

import { alignBanded } from './banded';
import {
  type Alignment,
  type AlignmentOptions,
  type AlignmentProgress,
  AlignmentTooLargeError,
  DEFAULT_MAX_CELLS,
  alignPairwise,
} from './pairwise';

export interface StrandedAlignment {
  readonly alignment: Alignment;
  /** Which of `b`'s strands aligned: 'reverse' means its reverse complement. */
  readonly strand: Strand;
}

const K = 11;
/**
 * Below this many cells both strands are simply aligned, the exact answer
 * in well under a second; above it the k-mer count picks one when it can.
 */
const BOTH_STRANDS_BELOW = 4_000_000;

/**
 * Up to this many cells a pair is aligned in full, the exact answer in
 * well under a second; past it, in a band around the words the two share
 * (#51), which is what makes a 10 kb read against its plasmid cheap.
 */
const FULL_UP_TO = 25_000_000;

/**
 * One alignment: in full when that is small, else in a band. The band is
 * dropped for the full alignment when its path ran along the band's edge
 * even at its widest and the full one fits, and when the two share too
 * little to band around; a pair too large for either is refused saying
 * which.
 */
export function alignLong(
  a: string,
  b: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): Alignment {
  const cells = (a.length + 1) * (b.length + 1);
  const maxCells = options.maxCells ?? DEFAULT_MAX_CELLS;
  if (cells <= FULL_UP_TO && options.fast !== true) return alignPairwise(a, b, options, onProgress);
  const banded = alignBanded(a, b, options, onProgress);
  if (banded !== null && (!banded.touchedEdge || cells > maxCells)) return banded.alignment;
  if (banded === null && cells > maxCells) {
    throw new AlignmentTooLargeError(cells, maxCells, 'unanchored');
  }
  return alignPairwise(a, b, options, onProgress);
}

/**
 * Aligns `b` and its reverse complement to `a` and keeps the higher score.
 * For large inputs the strand is chosen first by counting `b`'s 11-mers
 * found in `a` on each strand, so only one alignment runs; it takes both
 * when the counts do not clearly favour one (#48).
 */
export function alignEitherStrand(
  a: string,
  b: string,
  options: AlignmentOptions = {},
  onProgress?: AlignmentProgress,
): StrandedAlignment {
  const rc = reverseComplement(b);
  const cells = (a.length + 1) * (b.length + 1);
  if (cells >= BOTH_STRANDS_BELOW || options.fast === true) {
    const strand = likelyStrand(a, b, rc);
    if (strand !== null) {
      const alignment = alignLong(a, strand === 'forward' ? b : rc, options, onProgress);
      return { alignment, strand };
    }
  }
  // Two fills: each reports half of the way.
  const half = (from: number): AlignmentProgress | undefined =>
    onProgress === undefined
      ? undefined
      : (f) => {
          onProgress(from + f / 2);
        };
  const fwd = alignLong(a, b, options, half(0));
  const rev = alignLong(a, rc, options, half(0.5));
  return rev.score > fwd.score
    ? { alignment: rev, strand: 'reverse' }
    : { alignment: fwd, strand: 'forward' };
}

/**
 * The strand of `b` that shares clearly more 11-mers with `a`, or null when
 * neither does: at least 20 shared and three times the other strand's count.
 * A read with 5% errors keeps about 57% of its 11-mers intact, thousands
 * for a 10 kb read; two unrelated 10 kb sequences share a few dozen by
 * chance on either strand, so it is the ratio that decides.
 */
export function likelyStrand(a: string, b: string, rcB = reverseComplement(b)): Strand | null {
  const seen = kmerBitmap(a);
  const forward = sharedKmers(b, seen);
  const reverse = sharedKmers(rcB, seen);
  const best = Math.max(forward, reverse);
  const other = Math.min(forward, reverse);
  if (best < 20 || best < 3 * other) return null;
  return forward >= reverse ? 'forward' : 'reverse';
}

const MASK = (1 << (2 * K)) - 1;

function baseBits(c: number): number {
  switch (c) {
    case 65: // A
    case 97:
      return 0;
    case 67: // C
    case 99:
      return 1;
    case 71: // G
    case 103:
      return 2;
    case 84: // T
    case 116:
    case 85: // U
    case 117:
      return 3;
    default:
      return -1;
  }
}

/** Calls `visit` with each k-mer of definite bases, two bits a base. */
function forEachKmer(seq: string, visit: (kmer: number) => void): void {
  let kmer = 0;
  let run = 0;
  for (let i = 0; i < seq.length; i++) {
    const bits = baseBits(seq.charCodeAt(i));
    if (bits < 0) {
      run = 0; // an ambiguity code breaks the k-mer
      continue;
    }
    kmer = ((kmer << 2) | bits) & MASK;
    if (++run >= K) visit(kmer);
  }
}

/** One bit per possible 11-mer (4^11 bits, 512 KB), set for those in `seq`. */
function kmerBitmap(seq: string): Uint8Array {
  const bits = new Uint8Array((MASK + 1) >> 3);
  forEachKmer(seq, (k) => {
    bits[k >> 3] = (bits[k >> 3] ?? 0) | (1 << (k & 7));
  });
  return bits;
}

function sharedKmers(seq: string, seen: Uint8Array): number {
  let count = 0;
  forEachKmer(seq, (k) => {
    if (((seen[k >> 3] ?? 0) & (1 << (k & 7))) !== 0) count++;
  });
  return count;
}
