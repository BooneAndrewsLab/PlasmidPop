/**
 * The pointer gesture that makes a selection in an alignment window (#370),
 * the same in the large view and the multiple alignment so the two cannot
 * drift apart. The window says what cell a press landed on and where the
 * pointer moved; this decides what is selected. Pure, so the rules of a
 * click, a drag, a Shift-click and a click away are tested without a canvas.
 *
 * The rules, as a spreadsheet's: a press on a letter selects that one cell,
 * which is the anchor a Shift-click extends from; dragging extends it with
 * the pointer; a press on blank space (no row, or a cell with no letter)
 * selects nothing and clears what was selected, though a drag that begins
 * there still selects once the pointer reaches another column, since a range
 * may run over the columns a row does not reach.
 */

/** The cell under a press, as the window hit-tests it. */
export interface GestureCell<K> {
  /** The row (and in the large view the strip) the cell is on. */
  readonly key: K;
  /** The column, kept inside the alignment. */
  readonly column: number;
  /** Whether the row shows a letter there (a base, residue or gap), not blank space. */
  readonly letter: boolean;
}

export interface GestureOps<K, S> {
  /** A selection of one column on `key`. */
  start(key: K, column: number): S;
  /** The selection with its head moved to `column`. */
  extend(sel: S, column: number): S;
}

export interface Gesture<K, S extends { readonly head: number }> {
  readonly selection: S | null;
  /** A press on a blank cell: where a drag from it starts selecting; null when not pressed there. */
  readonly pending: { readonly key: K; readonly column: number } | null;
  /** The button is down on the canvas: moves extend, and the bar stays off. */
  readonly dragging: boolean;
}

/** Nothing selected, nothing pressed. */
export function idleGesture<K, S extends { readonly head: number }>(): Gesture<K, S> {
  return { selection: null, pending: null, dragging: false };
}

/**
 * The button goes down on `cell` (null off every row). With Shift and a
 * selection, its head moves there, blank cell or not; a letter starts a
 * new one-column selection; a blank cell clears and waits for a drag.
 */
export function gesturePress<K, S extends { readonly head: number }>(
  g: Gesture<K, S>,
  cell: GestureCell<K> | null,
  shift: boolean,
  ops: GestureOps<K, S>,
): Gesture<K, S> {
  if (cell === null) return idleGesture();
  if (shift && g.selection !== null) {
    return { selection: ops.extend(g.selection, cell.column), pending: null, dragging: true };
  }
  if (cell.letter) {
    return { selection: ops.start(cell.key, cell.column), pending: null, dragging: true };
  }
  return { selection: null, pending: { key: cell.key, column: cell.column }, dragging: true };
}

/** The pointer moves to `column` with the button down; the same object back when nothing changes. */
export function gestureMove<K, S extends { readonly head: number }>(
  g: Gesture<K, S>,
  column: number,
  ops: GestureOps<K, S>,
): Gesture<K, S> {
  if (!g.dragging) return g;
  if (g.pending !== null) {
    if (column === g.pending.column) return g;
    const from = ops.start(g.pending.key, g.pending.column);
    return { selection: ops.extend(from, column), pending: null, dragging: true };
  }
  if (g.selection === null || g.selection.head === column) return g;
  return { ...g, selection: ops.extend(g.selection, column) };
}

/** The button comes up (or the pointer is cancelled): a press on blank space that did not drag selected nothing. */
export function gestureRelease<K, S extends { readonly head: number }>(
  g: Gesture<K, S>,
): Gesture<K, S> {
  return g.dragging || g.pending !== null ? { ...g, pending: null, dragging: false } : g;
}

/** The fewest columns the bar floats beside: one clicked cell is an anchor, not a range. */
export const BAR_FROM_COLUMNS = 2;

/** Whether the bar is shown: a range of `BAR_FROM_COLUMNS` or more, with the button up. */
export function barWanted<K, S extends { readonly head: number }>(
  g: Gesture<K, S>,
  columns: { readonly start: number; readonly end: number } | null,
): boolean {
  return !g.dragging && columns !== null && columns.end - columns.start >= BAR_FROM_COLUMNS;
}
