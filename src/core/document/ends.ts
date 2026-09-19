import { type Topology } from '../range';
import { reverseComplement } from '../sequence';

/**
 * The ends of a linear double-stranded molecule.
 *
 * A digest leaves a fragment whose strands stop at different places, and
 * that is a property of the molecule, not of the digest: it decides what the
 * piece can be ligated to. A document therefore carries the shape of its two
 * ends, described exactly as a digest fragment's ends are (`digest.ts`).
 *
 * `overhang` is the single-stranded stretch written as *top-strand* bases
 * 5'→3' over the overhang region, whichever strand actually carries them.
 * So for the two cases where the top strand is the longer one — a 5'
 * overhang on the left, a 3' overhang on the right — the overhang bases are
 * the first (or last) bases of the document's own sequence. In the other two
 * the bottom strand runs past the sequence, and `overhang` is what the top
 * strand would read there if it were present.
 */
export type OverhangKind = 'blunt' | "5'" | "3'";

export interface StrandEnd {
  readonly kind: OverhangKind;
  /** Empty for a blunt end. */
  readonly overhang: string;
  /** Enzyme that made the cut; null for a natural or unknown end. */
  readonly enzyme: string | null;
}

export interface DocumentEnds {
  readonly left: StrandEnd;
  readonly right: StrandEnd;
}

export const BLUNT_END: StrandEnd = { kind: 'blunt', overhang: '', enzyme: null };
export const BLUNT_ENDS: DocumentEnds = { left: BLUNT_END, right: BLUNT_END };

/** A plain flush end with nothing to say about it: the default for any linear molecule. */
function isPlainBlunt(end: StrandEnd): boolean {
  return end.kind === 'blunt' && end.enzyme === null;
}

/**
 * The ends as a document should store them: nothing at all for a circular
 * molecule, which has no ends, and nothing for two plain blunt ends, so that
 * an ordinary linear document is not carrying a description of its
 * ordinariness around.
 */
export function normalizeEnds(
  ends: DocumentEnds | null | undefined,
  topology: Topology,
): DocumentEnds | null {
  if (ends === null || ends === undefined || topology === 'circular') return null;
  return isPlainBlunt(ends.left) && isPlainBlunt(ends.right) ? null : ends;
}

export function endsEqual(a: DocumentEnds | null, b: DocumentEnds | null): boolean {
  if (a === null || b === null) return a === b;
  return endEqual(a.left, b.left) && endEqual(a.right, b.right);
}

function endEqual(a: StrandEnd, b: StrandEnd): boolean {
  return a.kind === b.kind && a.overhang === b.overhang && a.enzyme === b.enzyme;
}

/** The same end read from the other strand, for turning a molecule around. */
export function flipEnd(end: StrandEnd): StrandEnd {
  return { ...end, overhang: reverseComplement(end.overhang) };
}

/** Reverse-complementing a molecule swaps its ends and reads each from the other strand. */
export function flipEnds(ends: DocumentEnds | null): DocumentEnds | null {
  if (ends === null) return null;
  return { left: flipEnd(ends.right), right: flipEnd(ends.left) };
}

/**
 * How many bases of the document's own sequence are single-stranded at this
 * end: the overhang itself where the top strand is the longer one, and none
 * where the bottom strand is (those bases are past the sequence).
 */
export function topStrandOverhang(end: StrandEnd, side: 'left' | 'right'): number {
  const topIsLonger = side === 'left' ? end.kind === "5'" : end.kind === "3'";
  return topIsLonger ? end.overhang.length : 0;
}

/** Human-readable end, e.g. "EcoRI 5′ AATT", "SmaI blunt" or "blunt end". */
export function describeEnd(end: StrandEnd): string {
  const shape =
    end.kind === 'blunt'
      ? 'blunt'
      : `${end.kind === "5'" ? '5′' : '3′'} ${end.overhang.toUpperCase()}`;
  return end.enzyme === null ? `${shape} end` : `${end.enzyme} ${shape}`;
}

/** Both ends in one line, left first: "EcoRI 5′ AATT / blunt end". */
export function describeEnds(ends: DocumentEnds | null): string {
  if (ends === null) return 'blunt ends';
  return `${describeEnd(ends.left)} / ${describeEnd(ends.right)}`;
}

/** Whether either end is sticky, which is what the views have to draw. */
export function hasOverhang(ends: DocumentEnds | null): boolean {
  return ends !== null && (ends.left.kind !== 'blunt' || ends.right.kind !== 'blunt');
}
