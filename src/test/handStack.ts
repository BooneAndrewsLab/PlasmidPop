import { Cell, isDifference, type Stack, type StackRow } from '@/app/alignmentStack';
import type { ReadAlignment } from '@/app/readAlignment';

/**
 * A large-view stack written out by hand, for tests that need exact cells
 * rather than whatever an aligner makes. `reference` has '-' in a column
 * another sample opened; each row has its character per column, ' ' outside
 * its stretch. Cells follow from comparing the two, as `stackAlignments`
 * would mark them. Rows carry no alignment result (tests of the large
 * view's pure helpers do not read it).
 */
export interface HandRow {
  readonly bases: string;
  /** One quality per column (NaN at a gap), or none. */
  readonly qualities?: readonly number[];
}

export function handStack(
  reference: string,
  rows: readonly HandRow[],
  options: { readonly offset?: number; readonly wrap?: number | null } = {},
): Stack {
  const columns = reference.length;
  const refIndex = new Int32Array(columns).fill(-1);
  let p = 0;
  for (let c = 0; c < columns; c++) if (reference.charAt(c) !== '-') refIndex[c] = p++;
  const differences = new Set<number>();
  const stackRows: StackRow[] = rows.map((row, r) => {
    const cells = new Uint8Array(columns);
    let first = -1;
    let end = -1;
    for (let c = 0; c < columns; c++) {
      const a = reference.charAt(c);
      const b = row.bases.charAt(c) || ' ';
      let cell: number = Cell.Blank;
      if (b !== ' ') {
        if (first < 0) first = c;
        end = c + 1;
        if (a === '-' && b === '-') cell = Cell.Padding;
        else if (a === '-') cell = Cell.Insertion;
        else if (b === '-') cell = Cell.Deletion;
        else cell = a.toUpperCase() === b.toUpperCase() ? Cell.Match : Cell.Mismatch;
      }
      cells[c] = cell;
      if (isDifference(cell)) differences.add(c);
    }
    return {
      name: `r${r}`,
      bases: row.bases.padEnd(columns, ' '),
      cells,
      qualities: row.qualities === undefined ? null : Float32Array.from(row.qualities),
      readIndex: null,
      firstColumn: Math.max(first, 0),
      endColumn: Math.max(end, 0),
      result: {} as unknown as ReadAlignment,
    };
  });
  return {
    columns,
    reference: reference.toUpperCase(),
    refIndex,
    twin: new Int32Array(columns).fill(-1),
    rows: stackRows,
    differences: [...differences].sort((x, y) => x - y),
    offset: options.offset ?? 0,
    wrap: options.wrap ?? null,
  };
}
