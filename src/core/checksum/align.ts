import { type SeqDocument } from '../document';
import { reverseComplement } from '../sequence';

import { documentChecksum } from './seguid';

/**
 * Lining one writing of a molecule up with another.
 *
 * Two files can hold the same plasmid and share not one base of text,
 * because a circle has no first base: start it at the EcoRI site instead of
 * the replication origin and every position moves. Diffing them as text then
 * answers "everything is different", which is true of the writing and false
 * of the molecule — and it is the molecule the person is asking about.
 *
 * So before diffing, work out how the other file's copy has to be turned to
 * read the way this one does: rotated to another origin, read from the other
 * strand, or both.
 */
export interface MoleculeAlignment {
  /** Base of the other document that should become its first; 0 to leave it. */
  readonly origin: number;
  /** Whether it must be read from the other strand before being rotated. */
  readonly flipped: boolean;
  /**
   * Whether the two checksums agreed, which settles it: these are the same
   * molecule and the alignment is exact. Without that the alignment is a
   * guess from shared stretches — right for a plasmid with a few edits in
   * it, and the only way to line up the case anyone actually asks about.
   */
  readonly exact: boolean;
}

/** Bases of a shared stretch long enough to say where two sequences correspond. */
const ANCHOR = 32;

/** How many places along the sequence to look for one. */
const ANCHOR_COUNT = 8;

function upperSequence(doc: SeqDocument): string {
  return doc.sequence.toString().toUpperCase();
}

/** The document turned as an alignment says, ready to be diffed against. */
export function applyAlignment(doc: SeqDocument, alignment: MoleculeAlignment): SeqDocument {
  const flipped = alignment.flipped ? doc.reverseComplement() : doc;
  return alignment.origin === 0 ? flipped : flipped.setOrigin(alignment.origin);
}

/** Whether an alignment asks for anything at all. */
export function isIdentityAlignment(alignment: MoleculeAlignment): boolean {
  return alignment.origin === 0 && !alignment.flipped;
}

/**
 * How `other` has to be turned to read the way `doc` does, or null when
 * nothing suggests they are the same molecule at all.
 *
 * The exact answer comes from the checksums: a `cdseguid` is the same
 * whatever origin a file starts the circle at and whichever strand it calls
 * the top one, so two that agree are the same molecule and the rotation can
 * be found by looking for one sequence in the other doubled. The inexact
 * answer — the useful one, since a file worth comparing usually differs
 * somewhere — votes on where a handful of long shared stretches land.
 */
export function alignToDocument(doc: SeqDocument, other: SeqDocument): MoleculeAlignment | null {
  if (doc.length === 0 || other.length === 0) return null;
  if (doc.topology !== other.topology) return null;
  const circular = doc.topology === 'circular';

  const mine = upperSequence(doc);
  const theirs = upperSequence(other);
  const flippedTheirs = reverseComplement(theirs);

  const sameMolecule = documentChecksum(doc)?.text === documentChecksum(other)?.text;
  if (sameMolecule) {
    // Same molecule for certain, so one of these four readings is this one.
    if (theirs === mine) return { origin: 0, flipped: false, exact: true };
    if (flippedTheirs === mine) return { origin: 0, flipped: true, exact: true };
    if (circular) {
      const straight = rotationOf(theirs, mine);
      if (straight >= 0) return { origin: straight, flipped: false, exact: true };
      const turned = rotationOf(flippedTheirs, mine);
      if (turned >= 0) return { origin: turned, flipped: true, exact: true };
    }
    // A checksum can agree where the text cannot be lined up: two strands of
    // a palindrome, say. Nothing to turn, then.
    return { origin: 0, flipped: false, exact: true };
  }

  if (theirs === mine) return null;

  const straight = anchoredOffset(mine, theirs, circular);
  const turned = anchoredOffset(mine, flippedTheirs, circular);
  const best =
    turned !== null && (straight === null || turned.votes > straight.votes)
      ? { offset: turned.offset, flipped: true }
      : straight === null
        ? null
        : { offset: straight.offset, flipped: false };
  if (best === null) return null;
  // A linear molecule has no origin to move, so only the strand is in play.
  const origin = circular ? best.offset : 0;
  if (origin === 0 && !best.flipped) return null;
  return { origin, flipped: best.flipped, exact: false };
}

/** Where `text` starts within the circle `ring`, or -1 if it is not that circle. */
function rotationOf(ring: string, text: string): number {
  if (ring.length !== text.length || ring.length === 0) return -1;
  const at = (ring + ring).indexOf(text);
  return at < 0 || at >= ring.length ? -1 : at;
}

/**
 * The rotation of `theirs` that the most shared stretches agree on.
 *
 * Anchors are taken from evenly spaced places in `mine` and looked for in
 * `theirs`; each one that is found in exactly one place votes for the
 * rotation that would put it where it is here. A stretch that occurs twice
 * votes for nothing rather than for the wrong thing. It takes a majority of
 * the anchors that voted at all, and at least two, so a chance 32-mer shared
 * by two unrelated plasmids does not move anything.
 */
function anchoredOffset(
  mine: string,
  theirs: string,
  circular: boolean,
): { offset: number; votes: number } | null {
  if (mine.length < ANCHOR || theirs.length < ANCHOR) return null;
  const ring = circular ? theirs + theirs : theirs;
  const votes = new Map<number, number>();
  let cast = 0;
  for (let i = 0; i < ANCHOR_COUNT; i++) {
    const at = Math.floor((mine.length - ANCHOR) * (i / (ANCHOR_COUNT - 1)));
    const anchor = mine.slice(at, at + ANCHOR);
    // Only starts within one turn of the circle count: past that is the
    // same place again, which is the doubling and not a repeat.
    const found = ring.indexOf(anchor);
    if (found < 0 || found >= theirs.length) continue;
    const again = ring.indexOf(anchor, found + 1);
    if (again >= 0 && again < theirs.length) continue;
    const offset = (((found - at) % theirs.length) + theirs.length) % theirs.length;
    votes.set(offset, (votes.get(offset) ?? 0) + 1);
    cast += 1;
  }
  if (cast === 0) return null;
  let bestOffset = 0;
  let bestVotes = 0;
  for (const [offset, count] of votes) {
    if (count > bestVotes) {
      bestOffset = offset;
      bestVotes = count;
    }
  }
  if (bestVotes < 2 || bestVotes * 2 <= cast) return null;
  return { offset: bestOffset, votes: bestVotes };
}
