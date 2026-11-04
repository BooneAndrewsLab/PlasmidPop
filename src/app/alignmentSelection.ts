import { codonSpan, residueOf, type ResidueFrame } from './alignmentResidues';
import type { Stack } from './alignmentStack';
import type { ColumnRange } from './alignmentText';

/**
 * A selection in the large view (#366): a run of columns on one row, either
 * its bases or its amino-acid strip. The canvas has no text to select, so
 * the view keeps this and turns it into text on Ctrl+C. Pure, so the
 * selection and what it copies are tested without a window.
 *
 * Columns are the stack's own, 0-based. `anchor` is where the drag or click
 * began and `head` where it is now; either may be the lesser.
 */

/** The `row` of a selection on the reference row, which is not one of `stack.rows`. */
export const REFERENCE_ROW = -1;

export type SelectionTrack = 'bases' | 'aa';

export interface AlignmentSelection {
  /** An index into `stack.rows`, or `REFERENCE_ROW`. */
  readonly row: number;
  readonly track: SelectionTrack;
  readonly anchor: number;
  readonly head: number;
}

/** What a copy puts on the clipboard. */
export type CopyMode =
  /** The sample's own residues: gaps and the columns it does not cover are left out. */
  | 'residues'
  /** The row as drawn, gaps kept, so the text stays in register with the others. */
  | 'aligned';

/** A selection of one column on `row`'s `track`. */
export function startSelection(
  row: number,
  track: SelectionTrack,
  column: number,
): AlignmentSelection {
  return { row, track, anchor: column, head: column };
}

/** The selection with its head moved to `column` (shift-click, or a drag). */
export function extendSelection(sel: AlignmentSelection, column: number): AlignmentSelection {
  return { ...sel, head: column };
}

/** The columns a selection covers, half-open and inside the stack; null when none. */
export function selectionColumns(stack: Stack, sel: AlignmentSelection): ColumnRange | null {
  const start = Math.max(0, Math.min(sel.anchor, sel.head));
  const end = Math.min(stack.columns, Math.max(sel.anchor, sel.head) + 1);
  return end > start ? { start, end } : null;
}

/** Whether the selection still names a row and columns of this stack (a new stack drops it). */
export function selectionValid(stack: Stack, sel: AlignmentSelection): boolean {
  const rowOk = sel.row === REFERENCE_ROW || (sel.row >= 0 && sel.row < stack.rows.length);
  return rowOk && selectionColumns(stack, sel) !== null;
}

/** The name of `row` (`REFERENCE_ROW` is the reference's) as the view shows it. */
export function rowName(stack: Stack, referenceName: string, row: number): string {
  return row === REFERENCE_ROW ? referenceName : (stack.rows[row]?.name ?? '');
}

/**
 * The bases of columns `r` of the reference or a sample (`row` as in a
 * selection). `aligned` keeps gaps and writes the columns a sample does not
 * cover as `-`, in register with the other rows; `residues` leaves both out.
 */
export function rowBases(stack: Stack, row: number, r: ColumnRange, mode: CopyMode): string {
  const sample = row === REFERENCE_ROW ? null : stack.rows[row];
  const text = (sample === null || sample === undefined ? stack.reference : sample.bases).slice(
    r.start,
    r.end,
  );
  if (mode === 'aligned') return text.replace(/ /g, '-');
  return text.replace(/[- ]/g, '');
}

/** One CDS's amino acids of a row, from `rowResidues`. */
export interface ResidueLine {
  /** The CDS's name, from its frame. */
  readonly frame: string;
  readonly letters: string;
}

/**
 * The amino acids of the codons that columns `r` touch, in reading order
 * (so a reverse-strand CDS reads as its protein, not left to right). A codon
 * counts when any of its columns is in `r`. A sample's residue is what its
 * bases make of the reference's codon; a codon with a base missing or added
 * is `-`, and one the sample does not cover is `-` too in `aligned` (so the
 * lines of several rows stay in register) and left out, with the indels,
 * in `residues`. Each CDS is a line of its own; a CDS with no letter left
 * is not a line.
 */
export function rowResidues(
  stack: Stack,
  frames: readonly ResidueFrame[],
  row: number,
  r: ColumnRange,
  mode: CopyMode,
): ResidueLine[] {
  const sample = row === REFERENCE_ROW ? null : stack.rows[row];
  const lines: ResidueLine[] = [];
  for (const frame of frames) {
    if (frame.end <= r.start || frame.start >= r.end) continue;
    let letters = '';
    for (const codon of frame.codons) {
      const span = codonSpan(codon);
      if (span.end <= r.start || span.start >= r.end) continue;
      const letter =
        sample === null || sample === undefined
          ? codon.reference
          : residueOf(frame, codon, sample).letter;
      if (mode === 'residues') {
        if (letter === ' ' || letter === '-') continue;
        letters += letter;
      } else {
        letters += letter === ' ' ? '-' : letter;
      }
    }
    if (letters !== '') lines.push({ frame: frame.name, letters });
  }
  return lines;
}

/**
 * The text a copy of `sel` puts on the clipboard: bases for a bases
 * selection, amino acids for an amino-acid one. Empty when the selection no
 * longer fits the stack, or the strip has no residues (`frames` null).
 */
export function selectionText(
  stack: Stack,
  frames: readonly ResidueFrame[] | null,
  sel: AlignmentSelection,
  mode: CopyMode,
): string {
  if (!selectionValid(stack, sel)) return '';
  const r = selectionColumns(stack, sel);
  if (r === null) return '';
  if (sel.track === 'bases') return rowBases(stack, sel.row, r, mode);
  if (frames === null) return '';
  return rowResidues(stack, frames, sel.row, r, mode)
    .map((l) => l.letters)
    .join('\n');
}

/** A short line for the status after a copy: "Copied 12 bases of s1" and the like. */
export function copiedNote(
  name: string,
  track: SelectionTrack,
  text: string,
  mode: CopyMode,
): string {
  const letters = text.replace(/\n/g, '').length;
  const unit = track === 'aa' ? 'amino acid' : 'base';
  const what = `${letters.toLocaleString()} ${unit}${letters === 1 ? '' : 's'}`;
  return `Copied ${what} of ${name}${mode === 'aligned' ? ', gaps kept' : ''}`;
}
