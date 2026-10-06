import {
  STOP,
  complement,
  type Feature,
  isStartCodon,
  translateCds,
  translateCodon,
  type SeqDocument,
  type TranslationTable,
} from '@/core';

import { Cell, type Stack, type StackRow } from './alignmentStack';
import { columnsOfIndex } from './alignmentTrack';

/**
 * The amino acids a stacked alignment's CDS features code for, laid on its
 * columns: the reference's own residues and, under each sample, what the
 * sample's bases make of the same codons. Codons are the reference's, read
 * with the feature's own code, so a sample's residue is what its bases would
 * be in the reference's frame; an insertion or deletion inside a codon is
 * marked as such rather than guessed at.
 */

/** One codon of the reference, as three columns in reading order. */
export interface CodonColumns {
  /** The columns of the three bases, in reading order (descending on the reverse strand). */
  readonly columns: readonly [number, number, number];
  /** The reference's residue, `*` for a stop. */
  readonly reference: string;
  /** The codon's number in the feature's reading order, from 0 (so residue `index + 1`). */
  readonly index: number;
  /** Whether it is the feature's first codon, which a start codon makes `M`. */
  readonly first: boolean;
}

export interface ResidueFrame {
  readonly name: string;
  readonly strand: 'forward' | 'reverse';
  readonly table: TranslationTable;
  readonly codons: readonly CodonColumns[];
  /** First and last column any codon touches, for skipping a frame out of view. */
  readonly start: number;
  readonly end: number;
}

/** What a sample's codon is against the reference's. */
export const Change = {
  /** The same bases. */
  Same: 0,
  /** Other bases, the same residue. */
  Synonymous: 1,
  /** Another residue. */
  Missense: 2,
  /** A stop where the reference has a residue. */
  Nonsense: 3,
  /** A residue where the reference has a stop. */
  StopLost: 4,
  /** A base is missing or another is inserted inside the codon. */
  Indel: 5,
  /** The sample does not cover the codon. */
  Blank: 6,
} as const;
export type ChangeValue = (typeof Change)[keyof typeof Change];

export interface Residue {
  /** One letter, `*`, `X`, or `-` for an indel and ' ' for none. */
  readonly letter: string;
  readonly change: ChangeValue;
}

/**
 * A codon's positions in reading order with a step across a circle's origin
 * carried on rather than wrapped: [1498, 1499, 0] on a 1500 bp circle is
 * [1498, 1499, 1500], the three adjacent columns a read that wraps puts the
 * codon in (a reverse codon's descending [1, 0, 1499] is [1, 0, -1]).
 */
function unrolled(
  positions: readonly number[],
  period: number,
  strand: 'forward' | 'reverse',
): number[] {
  if (period <= 0) return [...positions];
  const out: number[] = [];
  let shift = 0;
  positions.forEach((p, i) => {
    const before = positions[i - 1];
    if (before !== undefined) {
      if (strand === 'forward' && p < before) shift += period;
      else if (strand === 'reverse' && p > before) shift -= period;
    }
    out.push(p + shift);
  });
  return out;
}

/**
 * The frames of `features`' CDSs that fall in the alignment. `period` is the
 * document's length when it is circular, else 0, as for `buildTrack`.
 */
export function buildFrames(
  stack: Stack,
  doc: SeqDocument,
  features: Iterable<Feature>,
  period: number,
): ResidueFrame[] {
  const columns = columnsOfIndex(stack);
  const shifts = period > 0 ? [-period, 0, period] : [0];
  const frames: ResidueFrame[] = [];
  for (const feature of features) {
    if (feature.type !== 'CDS') continue;
    const translation = translateCds(doc, feature);
    for (const shift of shifts) {
      const codons: CodonColumns[] = [];
      for (const codon of translation.codons) {
        const cols = unrolled(codon.positions, period, translation.strand).map(
          (p) => columns[p - stack.offset + shift] ?? -1,
        );
        const [a, b, c] = cols;
        if (a === undefined || b === undefined || c === undefined) continue;
        if (a < 0 || b < 0 || c < 0) continue;
        codons.push({
          columns: [a, b, c],
          index: codon.index,
          reference: codon.aminoAcid,
          first: codon.index === 0,
        });
      }
      const first = codons[0];
      if (first === undefined) continue;
      const all = codons.flatMap((c) => c.columns);
      frames.push({
        name: feature.name === '' ? feature.type : feature.name,
        strand: translation.strand,
        table: translation.table,
        codons,
        start: Math.min(...all),
        end: Math.max(...all) + 1,
      });
    }
  }
  return frames;
}

/** The columns a codon spans, first to last inclusive. */
export function codonSpan(codon: CodonColumns): { start: number; end: number } {
  const [a, b, c] = codon.columns;
  return { start: Math.min(a, b, c), end: Math.max(a, b, c) + 1 };
}

/** What a sample's bases make of `codon`. */
export function residueOf(frame: ResidueFrame, codon: CodonColumns, row: StackRow): Residue {
  const [a, b, c] = codon.columns;
  const { start, end } = codonSpan(codon);
  if (end <= row.firstColumn || start >= row.endColumn)
    return { letter: ' ', change: Change.Blank };
  let bases = '';
  for (const column of [a, b, c]) {
    const ch = row.bases.charAt(column);
    if (ch === '-' || ch === ' ' || ch === '') return { letter: '-', change: Change.Indel };
    bases += frame.strand === 'reverse' ? complement(ch) : ch;
  }
  for (let column = start; column < end; column++) {
    if (row.cells[column] === Cell.Insertion) return { letter: '-', change: Change.Indel };
  }
  let letter = translateCodon(bases, frame.table);
  if (codon.first && codon.reference === 'M' && isStartCodon(bases, frame.table)) letter = 'M';
  const same = letter === codon.reference;
  let change: ChangeValue;
  if (same) {
    const matching = [a, b, c].every((column) => {
      const cell = row.cells[column];
      return cell === Cell.Match || cell === Cell.Ambiguous;
    });
    change = matching ? Change.Same : Change.Synonymous;
  } else if (letter === STOP) change = Change.Nonsense;
  else if (codon.reference === STOP) change = Change.StopLost;
  else change = Change.Missense;
  return { letter, change };
}
