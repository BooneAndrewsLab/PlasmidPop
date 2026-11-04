import type { ResidueFrame } from '../app/alignmentResidues';
import { Cell, type Stack, type StackRow } from '../app/alignmentStack';

/**
 * A small stack for the large view's selection and copy tests (#366): a row
 * is spelt as its characters per column, a space outside the sample's
 * stretch and `-` a gap.
 */
export function row(name: string, bases: string): StackRow {
  const cells = Uint8Array.from(
    bases
      .split('')
      .map((ch) => (ch === ' ' ? Cell.Blank : ch === '-' ? Cell.Deletion : Cell.Match)),
  );
  const first = bases.search(/\S/);
  return {
    name,
    bases,
    cells,
    qualities: null,
    readIndex: null,
    firstColumn: first,
    endColumn: bases.trimEnd().length,
    result: {} as StackRow['result'],
  };
}

/** A stack whose reference positions run 1, 2, 3… over its bases, an inserted column (`-`) numbered as none. */
export function stackOf(reference: string, rows: StackRow[]): Stack {
  const refIndex = new Int32Array(reference.length);
  let n = 0;
  for (let c = 0; c < reference.length; c++) refIndex[c] = reference[c] === '-' ? -1 : n++;
  return {
    columns: reference.length,
    reference,
    refIndex,
    twin: new Int32Array(reference.length).fill(-1),
    rows,
    differences: [],
    offset: 0,
    wrap: null,
  };
}

/** Reference ATGAAA-CCC (insertion column 6); s1 has a gap and s2 a short stretch. */
export const SAMPLE_STACK = stackOf('ATGAAA-CCC', [
  row('s1', 'ATG-AAGCCC'),
  row('s2', '  GAAA-CC '),
]);

/** A forward CDS ATG AAA CCC over columns 0-2, 3-5, then 7-9 (column 6 is an insertion). */
export const SAMPLE_FRAME: ResidueFrame = {
  name: 'x',
  strand: 'forward',
  table: 1,
  codons: [
    { columns: [0, 1, 2], reference: 'M', index: 0, first: true },
    { columns: [3, 4, 5], reference: 'K', index: 1, first: false },
    { columns: [7, 8, 9], reference: 'P', index: 2, first: false },
  ],
  start: 0,
  end: 10,
};
