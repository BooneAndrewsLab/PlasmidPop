import { type SeqDocument } from '../document';
import { reverseComplement } from '../sequence';

import { sha1Base64Url } from './sha1';

/**
 * SEGUID v2 checksums: a name for a molecule that two people can compare
 * without sending each other the sequence.
 *
 * The problem it solves is the one a plasmid map cannot: two files that
 * look alike are not necessarily the same construct, and the same construct
 * written by two programs is not the same text. A circular molecule has no
 * natural first base, and a double-stranded one has no natural top strand,
 * so a checksum of the sequence as written says only that two files agree
 * letter for letter — which they rarely do even when nothing has changed.
 *
 * SEGUID v2 fixes both: a circular checksum is taken over the
 * lexicographically smallest rotation, and a double-stranded one over
 * whichever strand sorts first, so it is invariant to where the file starts
 * the circle and to which strand it calls the top one.
 *
 *     Pereira et al., "SEGUID v2: Extending SEGUID checksums for circular,
 *     linear, single- and double-stranded biological sequences", PLOS ONE.
 *     Reference implementations and the test vectors this module is checked
 *     against: https://www.seguid.org/
 *
 * The four variants are named for what they describe: `l`inear or
 * `c`ircular, `s`ingle- or `d`ouble-stranded. Every one of them is a SHA-1
 * over a canonical string, base64url, with the single padding character cut
 * off, so a checksum is 27 characters behind a prefix that says which
 * variant it is.
 */

export type SeguidKind = 'lsseguid' | 'csseguid' | 'ldseguid' | 'cdseguid';

export interface Seguid {
  readonly kind: SeguidKind;
  /** The 27 characters, without the prefix. */
  readonly value: string;
  /** `cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A`: the form to write down or paste. */
  readonly text: string;
  /**
   * The first six characters, which is what the reference implementations
   * call the short form. Enough to tell two molecules apart at a glance in a
   * status bar; not enough to stand alone in a file.
   */
  readonly short: string;
}

function seguid(kind: SeguidKind, canonical: string): Seguid {
  const value = sha1Base64Url(canonical);
  return { kind, value, text: `${kind}=${value}`, short: value.slice(0, 6) };
}

/**
 * The rotation of `s` that sorts first, and how far round it starts.
 *
 * Booth's algorithm, in the form the reference implementations use: linear
 * in the length, where sorting the rotations would be quadratic in it before
 * the comparisons are even counted. A plasmid is only a few thousand bases,
 * but a checksum is taken on every keystroke's worth of redraw and this is
 * the only part of it that is not already linear.
 */
export function minimalRotation(s: string): { readonly rotated: string; readonly index: number } {
  const n = s.length;
  if (n === 0) return { rotated: '', index: 0 };
  const doubled = s + s;
  let a = 0;
  let b = 0;
  while (b < n) {
    for (let i = 0; i < n - a; i++) {
      // Code units rather than characters: every symbol here is ASCII, and
      // their order is the same one, `-` included (45, below every base).
      const sa = doubled.charCodeAt(a + i);
      const sb = doubled.charCodeAt(b + i);
      if (sa < sb || a + i === b) {
        if (i > 0) b += i - 1;
        break;
      }
      if (sa > sb) {
        a = b;
        break;
      }
    }
    b += 1;
  }
  return { rotated: doubled.slice(a, a + n), index: a };
}

/** `s` turned so that it starts `k` bases *earlier* than it did. */
function rotateRight(s: string, k: number): string {
  return k === 0 ? s : s.slice(s.length - k) + s.slice(0, s.length - k);
}

/** Linear single-stranded: the sequence itself. */
export function lsseguid(sequence: string): Seguid {
  return seguid('lsseguid', sequence);
}

/** Circular single-stranded: the rotation that sorts first. */
export function csseguid(sequence: string): Seguid {
  return seguid('csseguid', minimalRotation(sequence).rotated);
}

/**
 * Linear double-stranded, from the two strands each written 5'→3'. Whichever
 * sorts first is written first, separated by a semicolon, so the checksum
 * does not depend on which strand the file called the top one.
 *
 * Strands of unequal reach — a sticky end — are written to the same length
 * with `-` where a strand is absent, which sorts before every base.
 */
export function ldseguid(watson: string, crick: string): Seguid {
  const canonical = watson <= crick ? `${watson};${crick}` : `${crick};${watson}`;
  return seguid('ldseguid', canonical);
}

/**
 * Circular double-stranded: a plasmid's name. Invariant to both the origin
 * the file starts at and the strand it calls the top one.
 *
 * Each strand is rotated to the form that sorts first and the smaller of the
 * two wins; the other strand follows it round, which is exactly its reverse
 * complement.
 */
export function cdseguid(watson: string, crick: string): Seguid {
  const w = minimalRotation(watson);
  const c = minimalRotation(crick);
  // The second strand follows the first round the circle, which is two slices
  // rather than another reverse complement of the whole molecule.
  const canonical =
    w.rotated <= c.rotated
      ? `${w.rotated};${rotateRight(crick, w.index)}`
      : `${c.rotated};${rotateRight(watson, c.index)}`;
  return seguid('cdseguid', canonical);
}

/**
 * The two strands of a document, written to the same length and both 5'→3',
 * ready for `ldseguid`.
 *
 * A linear molecule may have strands that stop at different places
 * (`core/document/ends.ts`), and that is part of what the molecule *is* — a
 * fragment with EcoRI ends is not the blunt fragment of the same bases, and
 * a checksum that said it was would be answering the wrong question. The
 * missing stretches are written as `-`, which is how SEGUID v2 describes a
 * staggered end.
 */
export function documentStrands(doc: SeqDocument): { watson: string; crick: string } {
  const sequence = canonicalSequence(doc);
  const ends = doc.ends;
  if (ends === null) return { watson: sequence, crick: reverseComplement(sequence) };

  // A 5' overhang on the left and a 3' overhang on the right are bases of our
  // own sequence with no partner below them; the other two kinds are bases
  // the bottom strand has and the sequence does not, so they lengthen both
  // strings. `overhang` is top-strand bases either way (`ends.ts`).
  const leftTop = ends.left.kind === "5'" ? ends.left.overhang.length : 0;
  const rightTop = ends.right.kind === "3'" ? ends.right.overhang.length : 0;
  const leftBottom = ends.left.kind === "3'" ? ends.left.overhang.toUpperCase() : '';
  const rightBottom = ends.right.kind === "5'" ? ends.right.overhang.toUpperCase() : '';

  const watson = `${'-'.repeat(leftBottom.length)}${sequence}${'-'.repeat(rightBottom.length)}`;
  const bottomTop = `${leftBottom}${sequence.slice(leftTop, sequence.length - rightTop)}${rightBottom}`;
  const crick = `${'-'.repeat(rightTop)}${reverseComplement(bottomTop)}${'-'.repeat(leftTop)}`;
  return { watson, crick };
}

/**
 * The sequence as a checksum should see it: upper case.
 *
 * Case in a sequence is a highlight, not a base — GenBank files are written
 * lower case and SnapGene's upper — so two documents that differ only in it
 * are the same molecule and have to check out the same.
 */
function canonicalSequence(doc: SeqDocument): string {
  return doc.sequence.toString().toUpperCase();
}

/**
 * The checksum of a document: `cdseguid` for a plasmid, `ldseguid` for a
 * linear molecule. Both are the double-stranded variants, because a DNA
 * document in this app is double-stranded whether or not the complement is
 * being drawn.
 *
 * Null for an empty document: SEGUID is not defined for one, and a checksum
 * shared by every empty sequence would say nothing anyway.
 */
export function documentChecksum(doc: SeqDocument): Seguid | null {
  if (doc.length === 0) return null;
  // A protein is one chain: SEGUID's original, single-stranded form (#66).
  if (doc.isProtein) return lsseguid(canonicalSequence(doc));
  const { watson, crick } = documentStrands(doc);
  return doc.topology === 'circular' ? cdseguid(watson, crick) : ldseguid(watson, crick);
}
