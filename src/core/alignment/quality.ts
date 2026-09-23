import { type Alignment } from './pairwise';

/**
 * Base qualities brought into an alignment (#50): trimming a read's
 * unreliable ends before it is aligned, and saying of each difference from
 * the reference whether the read was sure of the base there.
 */

/** Phred quality from which a base counts as confident: one error in a hundred. */
export const CONFIDENT_QUALITY = 20;

/**
 * The error probability per base below which a base is worth keeping when
 * trimming: 0.05, the value phred's `-trim_alt` and Biopython's `abi-trim`
 * use. It is about Q13.
 */
export const TRIM_CUTOFF = 0.05;

/**
 * The stretch of a read worth aligning, by Mott's trimming algorithm: each
 * base scores `cutoff` minus its error probability (10^(−q/10)), so a good
 * base adds a little and a poor one takes away, and the stretch kept is the
 * one of highest total score. Sanger reads lose their first 20–50 bases and
 * their tail this way; a consensus read of uniform quality loses nothing.
 *
 * Returns a 0-based half-open range; empty when no base is better than the
 * cutoff. (Biopython's `abi-trim` implements the same idea but never scores
 * the first base and leaves out the last base of the stretch; this is the
 * algorithm as published.)
 */
export function trimByQuality(
  qualities: ArrayLike<number>,
  cutoff: number = TRIM_CUTOFF,
): { readonly start: number; readonly end: number } {
  let best = 0;
  let bestStart = 0;
  let bestEnd = 0;
  let sum = 0;
  let start = 0;
  for (let i = 0; i < qualities.length; i++) {
    sum += cutoff - 10 ** (-(qualities[i] ?? 0) / 10);
    if (sum <= 0) {
      sum = 0;
      start = i + 1;
    } else if (sum > best) {
      best = sum;
      bestStart = start;
      bestEnd = i + 1;
    }
  }
  return { start: bestStart, end: bestEnd };
}

export type DifferenceKind = 'mismatch' | 'insertion' | 'deletion';

/** Where the read differs from the reference, and how sure it was there. */
export interface ReadDifference {
  /** Column in the alignment. */
  readonly column: number;
  /**
   * `mismatch`: another base; `insertion`: a base the read has and the
   * reference does not; `deletion`: a reference base missing from the read.
   */
  readonly kind: DifferenceKind;
  /** 0-based position in the first sequence (the reference) the column is at or after. */
  readonly positionA: number;
  /**
   * Quality of the read's base; for a deletion, the lower of the read bases
   * either side of it, since a base the read does not have has no quality.
   */
  readonly quality: number;
  readonly confident: boolean;
}

/**
 * The quality of the read (the alignment's second sequence) under each
 * column: its base's quality, or for a gap in the read the lower of its
 * neighbours'. `qualities` are the read's, in the orientation it was
 * aligned in and from the base `alignment.startB` counts from.
 */
export function columnQualities(alignment: Alignment, qualities: ArrayLike<number>): number[] {
  const out: number[] = [];
  let b = alignment.startB;
  const q = (i: number): number => qualities[i] ?? 0;
  for (let c = 0; c < alignment.columns; c++) {
    if (alignment.alignedB.charAt(c) === '-') {
      // Between read bases b − 1 and b.
      const before = b > 0 ? q(b - 1) : q(b);
      const after = b < qualities.length ? q(b) : before;
      out.push(Math.min(before, after));
    } else {
      out.push(q(b));
      b++;
    }
  }
  return out;
}

/** Every column where the read and the reference differ, with the read's quality there. */
export function readDifferences(
  alignment: Alignment,
  qualities: readonly number[],
  confidentFrom: number = CONFIDENT_QUALITY,
): ReadDifference[] {
  const out: ReadDifference[] = [];
  let a = alignment.startA;
  for (let c = 0; c < alignment.columns; c++) {
    const x = alignment.alignedA.charAt(c);
    const y = alignment.alignedB.charAt(c);
    const mark = alignment.matchLine.charAt(c);
    const quality = qualities[c] ?? 0;
    let kind: DifferenceKind | null = null;
    if (x === '-') kind = 'insertion';
    else if (y === '-') kind = 'deletion';
    else if (mark === '.') kind = 'mismatch';
    if (kind !== null) {
      out.push({ column: c, kind, positionA: a, quality, confident: quality >= confidentFrom });
    }
    if (x !== '-') a++;
  }
  return out;
}
