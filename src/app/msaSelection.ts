import type { ColumnRange } from './alignmentText';
import {
  MSA_CONSENSUS_ROW,
  MSA_CHAR_WIDTH,
  MSA_HEADER_HEIGHT,
  MSA_NAME_WIDTH,
  MSA_RULER_HEIGHT,
  MSA_ROW_HEIGHT,
} from './components/msaDraw';

/**
 * A selection in the multiple alignment's window (#368): a run of columns
 * on one row, the consensus row included. The grid is a canvas, so the
 * window keeps this and turns it into text on Ctrl+C. Pure, so the
 * selection, where it is hit and what it copies are tested without a window.
 * Columns are the alignment's own, 0-based; `anchor` is where the drag began
 * and `head` where it is now, either may be the lesser.
 */

export { MSA_CONSENSUS_ROW };

export interface MsaSelection {
  /** An index into the alignment's rows, or `MSA_CONSENSUS_ROW`. */
  readonly row: number;
  readonly anchor: number;
  readonly head: number;
}

/** What a copy puts on the clipboard: the row's own letters, or the row as drawn with its gaps. */
export type MsaCopyMode = 'residues' | 'aligned';

export function startMsaSelection(row: number, column: number): MsaSelection {
  return { row, anchor: column, head: column };
}

export function extendMsaSelection(sel: MsaSelection, column: number): MsaSelection {
  return { ...sel, head: column };
}

/** The columns a selection covers, half-open and inside the alignment; null when none. */
export function msaSelectionColumns(columns: number, sel: MsaSelection): ColumnRange | null {
  const start = Math.max(0, Math.min(sel.anchor, sel.head));
  const end = Math.min(columns, Math.max(sel.anchor, sel.head) + 1);
  return end > start ? { start, end } : null;
}

/** Whether the selection still names a row and columns of this alignment. */
export function msaSelectionValid(rows: number, columns: number, sel: MsaSelection): boolean {
  const rowOk = sel.row === MSA_CONSENSUS_ROW || (sel.row >= 0 && sel.row < rows);
  return rowOk && msaSelectionColumns(columns, sel) !== null;
}

/** The row the pointer is on at `y` in the canvas (`scrollTop` is how far the rows are scrolled): a sequence, the consensus, or null (ruler, conservation bar, below the last row). */
export function msaRowAt(y: number, scrollTop: number, rows: number): number | null {
  if (y >= MSA_RULER_HEIGHT && y < MSA_RULER_HEIGHT + MSA_ROW_HEIGHT) return MSA_CONSENSUS_ROW;
  if (y < MSA_HEADER_HEIGHT) return null;
  const row = Math.floor((y - MSA_HEADER_HEIGHT + scrollTop) / MSA_ROW_HEIGHT);
  return row >= 0 && row < rows ? row : null;
}

/** The column under `x` in the canvas, kept inside the alignment. */
export function msaColumnAt(x: number, scrollLeft: number, columns: number): number {
  const at = Math.floor((x - MSA_NAME_WIDTH + scrollLeft) / MSA_CHAR_WIDTH);
  return Math.min(columns - 1, Math.max(0, at));
}

/** The selected row's text in `r`: its own letters, or the aligned row, gaps as `-`. */
export function msaRowText(
  rows: readonly string[],
  consensus: string,
  row: number,
  r: ColumnRange,
  mode: MsaCopyMode,
): string {
  const text = (row === MSA_CONSENSUS_ROW ? consensus : (rows[row] ?? '')).slice(r.start, r.end);
  return mode === 'aligned' ? text : text.replace(/[- ]/g, '');
}

/** The text a copy of `sel` puts on the clipboard; empty when the selection no longer fits. */
export function msaSelectionText(
  rows: readonly string[],
  consensus: string,
  columns: number,
  sel: MsaSelection,
  mode: MsaCopyMode,
): string {
  if (!msaSelectionValid(rows.length, columns, sel)) return '';
  const r = msaSelectionColumns(columns, sel);
  return r === null ? '' : msaRowText(rows, consensus, sel.row, r, mode);
}

/** "Copied 12 bases of s1" and the like, for the line under the alignment after a copy. */
export function msaCopiedNote(
  name: string,
  unit: 'base' | 'residue',
  text: string,
  mode: MsaCopyMode,
): string {
  const letters = text.length;
  return `Copied ${letters.toLocaleString()} ${unit}${letters === 1 ? '' : 's'} of ${name}${mode === 'aligned' ? ', gaps kept' : ''}`;
}

/** The selection bar's size, for keeping it inside the view: two small buttons and a count. */
export const MSA_BAR_HEIGHT = 30;
export const MSA_BAR_WIDTH = 280;
const BAR_GAP = 4;

export interface MsaScroll {
  readonly left: number;
  readonly top: number;
}

/**
 * Where the bar beside the selection goes, in the scroller's content space:
 * above the row where there is room under the pinned header, else below
 * it; for the consensus (pinned) always just under the header. Kept inside
 * the view sideways. Null when the row has scrolled out of view.
 */
export function msaBarAt(
  sel: MsaSelection,
  columns: number,
  scroll: MsaScroll,
  view: { readonly width: number; readonly height: number },
): { left: number; top: number; columns: number } | null {
  const r = msaSelectionColumns(columns, sel);
  if (r === null) return null;
  const consensus = sel.row === MSA_CONSENSUS_ROW;
  const rowTop = consensus
    ? MSA_RULER_HEIGHT
    : MSA_HEADER_HEIGHT + sel.row * MSA_ROW_HEIGHT - scroll.top;
  const above = rowTop - MSA_BAR_HEIGHT - BAR_GAP;
  const below = (consensus ? MSA_HEADER_HEIGHT : rowTop + MSA_ROW_HEIGHT) + BAR_GAP;
  const y = !consensus && above >= MSA_HEADER_HEIGHT ? above : below;
  if (
    y + MSA_BAR_HEIGHT > view.height ||
    (!consensus && rowTop + MSA_ROW_HEIGHT < MSA_HEADER_HEIGHT)
  ) {
    return null;
  }
  const x = Math.max(
    MSA_NAME_WIDTH + BAR_GAP,
    Math.min(MSA_NAME_WIDTH + r.start * MSA_CHAR_WIDTH - scroll.left, view.width - MSA_BAR_WIDTH),
  );
  return { left: scroll.left + x, top: scroll.top + y, columns: r.end - r.start };
}
