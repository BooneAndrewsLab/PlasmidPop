import { type SeqDocument, isRnaDocument, toRnaLetters } from '../document';
import { type Strand } from '../features';
import { complement } from '../sequence';
import { AMINO_ACID_NAMES } from './codons';
import { type CdsTranslation, type Codon } from './cdsTranslation';

/**
 * Codons the sequence view marks out (#318, item 116): one whose bases are in
 * more than one piece of the coding sequence, which a reader must be able to
 * tell from a glitch, and one that never finishes.
 *
 * A codon of three bases in reading order is *split* when they are not
 * neighbours on the sequence: an exon junction in a `join(...)`, with or
 * without an intron between. Bases either side of the origin of a circular
 * sequence are neighbours; a row break is not a split, it only cuts the
 * drawing, and `codonRuns` is what tells the two apart on screen.
 */

/**
 * The pieces of `positions`, in reading order, each a run of bases that are
 * neighbours on the sequence. `positions` ascend for a forward-strand feature
 * and descend for a reverse one; a circular sequence joins its last base to
 * its first.
 */
export function codonPieces(
  positions: readonly number[],
  strand: Strand,
  seqLength: number,
  circular: boolean,
): number[][] {
  const step = strand === 'reverse' ? -1 : 1;
  const pieces: number[][] = [];
  for (const p of positions) {
    const piece = pieces[pieces.length - 1];
    const prev = piece?.[piece.length - 1];
    let next = prev === undefined ? p : prev + step;
    if (circular) next = (next + seqLength) % seqLength;
    if (piece !== undefined && prev !== undefined && next === p) piece.push(p);
    else pieces.push([p]);
  }
  return pieces;
}

/** Whether the codon's bases are in more than one piece of the sequence. */
export function isSplitCodon(
  codon: Codon,
  strand: Strand,
  seqLength: number,
  circular: boolean,
): boolean {
  return codonPieces(codon.positions, strand, seqLength, circular).length > 1;
}

/** A stretch of a codon's bases inside one row of the view, and how it ends. */
export interface CodonRun {
  /** Forward-strand `[start, end)` of the stretch, ascending. */
  readonly start: number;
  readonly end: number;
  /** Whether the stretch holds the codon's middle base, which its letter is drawn over. */
  readonly holdsMiddle: boolean;
  /** Whether more of the codon lies beyond the stretch's left edge: where it opens. */
  readonly openLeft: boolean;
  /** Whether more of the codon lies beyond the stretch's right edge. */
  readonly openRight: boolean;
}

/**
 * The stretches of a codon's bases inside `[start, end)`, ascending: what a
 * row draws of it. A codon split by a join, by the origin or by the row's
 * edge gives a stretch that is not all of it, and that one is open on the
 * side the rest of the codon is on: the later bases in reading order lie to
 * the right of a forward-strand codon and to the left of a reverse-strand
 * one. A codon drawn whole gives one stretch, open on neither side.
 */
export function codonRuns(
  positions: readonly number[],
  strand: Strand,
  start: number,
  end: number,
): CodonRun[] {
  const middle = positions[1];
  const inRow: { readonly at: number; readonly order: number }[] = [];
  positions.forEach((at, order) => {
    if (at >= start && at < end) inRow.push({ at, order });
  });
  inRow.sort((a, b) => a.at - b.at);
  const reverse = strand === 'reverse';
  const last = positions.length - 1;
  const runs: CodonRun[] = [];
  let from = 0;
  for (let i = 0; i < inRow.length; i++) {
    const here = inRow[i];
    const next = inRow[i + 1];
    if (here === undefined || next?.at === here.at + 1) continue;
    const members = inRow.slice(from, i + 1);
    const orders = members.map((m) => m.order);
    // Reading order grows rightwards on the forward strand, leftwards on the reverse one.
    const before = Math.min(...orders) > 0;
    const after = Math.max(...orders) < last;
    runs.push({
      start: members[0]?.at ?? here.at,
      end: here.at + 1,
      holdsMiddle: members.some((m) => m.at === middle),
      openLeft: reverse ? after : before,
      openRight: reverse ? before : after,
    });
    from = i + 1;
  }
  return runs;
}

/** The codon's bases as read, drawn the way the document's alphabet writes them. */
function basesAt(doc: SeqDocument, positions: readonly number[], strand: Strand): string {
  let text = '';
  for (const p of positions) text += doc.sequence.charAt(p).toUpperCase();
  if (strand === 'reverse') text = complement(text);
  return isRnaDocument(doc) ? toRnaLetters(text) : text;
}

/** A piece's place as the app writes one: 1-based, first base to last on the forward strand. */
function placeOf(piece: readonly number[], strand: Strand): string {
  const forward = strand === 'reverse' ? [...piece].reverse() : piece;
  const a = (forward[0] ?? 0) + 1;
  const b = (forward[forward.length - 1] ?? 0) + 1;
  return a === b ? String(a) : `${a}-${b}`;
}

/** The residue as the tooltip names it: three letters, or the one letter when no name is known. */
function residueName(aminoAcid: string): string {
  return AMINO_ACID_NAMES[aminoAcid]?.three ?? aminoAcid;
}

/**
 * What the sequence view's tooltip says over the translation of forward-strand
 * position `position`, or null when the codon there is an ordinary one (or
 * none is). Over a split codon:
 * `Codon 63: G (435) + TG (1223-1224) = GTG, Val. The codon continues in the
 * next exon.`; over the bases of a CDS that ends open on a codon it does not
 * finish: `Incomplete codon: the CDS ends open at 435.`
 */
export function codonNoteAt(
  doc: SeqDocument,
  translation: CdsTranslation,
  position: number,
): string | null {
  const { strand } = translation;
  const circular = doc.topology === 'circular';
  const open = (positions: readonly number[]): string =>
    `Incomplete codon: the CDS ends open at ${String((positions[positions.length - 1] ?? 0) + 1)}.`;
  if (translation.leftover.includes(position)) return open(translation.leftover);
  const codon = translation.codons.find((c) => c.positions.includes(position));
  if (codon === undefined) return null;
  if (codon.positions.length < 3) return open(codon.positions);
  const pieces = codonPieces(codon.positions, strand, doc.length, circular);
  if (pieces.length < 2) return null;
  const parts = pieces
    .map((piece) => `${basesAt(doc, piece, strand)} (${placeOf(piece, strand)})`)
    .join(' + ');
  const whole = basesAt(doc, codon.positions, strand);
  const number = String(codon.index + 1);
  return `Codon ${number}: ${parts} = ${whole}, ${residueName(codon.aminoAcid)}. The codon continues in the next exon.`;
}
