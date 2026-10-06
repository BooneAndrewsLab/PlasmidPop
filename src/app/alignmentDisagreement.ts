import { Cell, isDifference, type Stack, type StackRow } from './alignmentStack';

/**
 * Columns where the samples disagree with each other (#124). A difference
 * from the document that every covering sample shares is agreement, and what
 * makes it credible; two samples with different bases in one column is
 * usually a base-calling error in one of them. Columns are the stack's,
 * 0-based.
 */

/** A row's call in one column: 'A', 'C', 'G', 'T', '-' for a deletion, or null when it takes no part. */
function callOf(
  cell: number,
  base: string,
  quality: number | undefined,
  confidentFrom: number,
): string | null {
  // Outside the sample's stretch, or padding where another sample has an insertion.
  if (cell === Cell.Blank || cell === Cell.Padding) return null;
  if (cell === Cell.Deletion) return '-';
  if (quality !== undefined && !Number.isNaN(quality) && quality < confidentFrom) return null;
  const upper = base.toUpperCase() === 'U' ? 'T' : base.toUpperCase();
  // An ambiguity code (N, R, ...) is compatible with more than one base: no call.
  return 'ACGT'.includes(upper) && upper !== '' ? upper : null;
}

/** The calls of the samples that stand behind column `c`, at good quality. */
export function callsAt(stack: Stack, c: number, confidentFrom: number): string[] {
  const calls: string[] = [];
  for (const row of stack.rows) {
    // On a circle a read's base is in this column or its twin across the origin.
    const call =
      rowCall(stack, row, c, confidentFrom) ??
      rowCall(stack, row, stack.twin[c] ?? -1, confidentFrom);
    if (call !== null) calls.push(call);
  }
  return calls;
}

function rowCall(stack: Stack, row: StackRow, c: number, confidentFrom: number): string | null {
  if (c < 0 || c >= stack.columns) return null;
  return callOf(row.cells[c] ?? Cell.Blank, row.bases.charAt(c), row.qualities?.[c], confidentFrom);
}

/** Whether two or more samples cover column `c` at good quality and do not all carry the same base. */
export function disagreesAt(stack: Stack, c: number, confidentFrom: number): boolean {
  const calls = callsAt(stack, c, confidentFrom);
  return calls.length >= 2 && new Set(calls).size > 1;
}

/** The columns where the samples disagree, ascending. */
export function disagreementColumns(stack: Stack, confidentFrom: number): number[] {
  const columns: number[] = [];
  if (stack.rows.length < 2) return columns;
  for (let c = 0; c < stack.columns; c++) {
    if (disagreesAt(stack, c, confidentFrom)) columns.push(c);
  }
  return columns;
}

/**
 * Columns where two or more samples differ from the document and all carry
 * the same base: the difference several reads agree on. Ascending.
 */
export function agreementColumns(stack: Stack, confidentFrom: number): number[] {
  const columns: number[] = [];
  if (stack.rows.length < 2) return columns;
  for (const c of stack.differences) {
    const differing = stack.rows.flatMap((row) => {
      for (const col of [c, stack.twin[c] ?? -1]) {
        if (col < 0 || !isDifference(row.cells[col] ?? Cell.Blank)) continue;
        const call = rowCall(stack, row, col, confidentFrom);
        if (call !== null) return [call];
      }
      return [];
    });
    if (
      differing.length >= 2 &&
      new Set(differing).size === 1 &&
      !disagreesAt(stack, c, confidentFrom)
    )
      columns.push(c);
  }
  return columns;
}
