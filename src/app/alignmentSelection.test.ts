import { describe, expect, it } from 'vitest';

import {
  REFERENCE_ROW,
  copiedNote,
  extendSelection,
  selectionColumns,
  selectionText,
  selectionValid,
  startSelection,
} from './alignmentSelection';
import type { ResidueFrame } from './alignmentResidues';
import { Cell, type Stack, type StackRow } from './alignmentStack';
import {
  stackLayout,
  selectionTargetAt,
  ROW_HEIGHT,
  AA_HEIGHT,
  RULER_HEIGHT,
} from './components/alignmentStackDraw';

function row(name: string, bases: string): StackRow {
  const cells = Uint8Array.from(
    bases.split('').map((ch) => (ch === ' ' ? Cell.Blank : ch === '-' ? Cell.Deletion : Cell.Match)),
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

function stackOf(reference: string, rows: StackRow[]): Stack {
  return {
    columns: reference.length,
    reference,
    refIndex: new Int32Array(reference.length),
    twin: new Int32Array(reference.length).fill(-1),
    rows,
    differences: [],
    offset: 0,
    wrap: null,
  };
}

// Reference ATGAAA-CCC (insertion column 6), sample 1 has a gap and a short stretch.
const stack = stackOf('ATGAAA-CCC', [row('s1', 'ATG-AAGCCC'), row('s2', '  GAAA-CC ')]);

describe('selectionColumns', () => {
  it('is inclusive of both ends, whichever came first', () => {
    expect(selectionColumns(stack, { row: 0, track: 'bases', anchor: 2, head: 4 })).toEqual({
      start: 2,
      end: 5,
    });
    expect(selectionColumns(stack, { row: 0, track: 'bases', anchor: 4, head: 2 })).toEqual({
      start: 2,
      end: 5,
    });
  });
  it('stays inside the stack', () => {
    expect(selectionColumns(stack, { row: 0, track: 'bases', anchor: 8, head: 40 })).toEqual({
      start: 8,
      end: 10,
    });
    expect(selectionColumns(stack, { row: 0, track: 'bases', anchor: 20, head: 30 })).toBeNull();
  });
  it('extends keeping the anchor, row and track', () => {
    const s = extendSelection(startSelection(1, 'aa', 3), 7);
    expect(s).toEqual({ row: 1, track: 'aa', anchor: 3, head: 7 });
  });
  it('is invalid for a row the stack lacks', () => {
    expect(selectionValid(stack, startSelection(5, 'bases', 1))).toBe(false);
    expect(selectionValid(stack, startSelection(REFERENCE_ROW, 'bases', 1))).toBe(true);
  });
});

describe('selectionText bases', () => {
  const sel = (row: number, a: number, b: number) => ({
    ...startSelection(row, 'bases', a),
    head: b,
  });
  it('copies a sample without its gaps', () => {
    expect(selectionText(stack, null, sel(0, 0, 9), 'residues')).toBe('ATGAAGCCC');
    expect(selectionText(stack, null, sel(0, 2, 4), 'residues')).toBe('GA');
  });
  it('copies the aligned row with gaps kept', () => {
    expect(selectionText(stack, null, sel(0, 0, 4), 'aligned')).toBe('ATG-A');
  });
  it('drops columns outside the stretch a sample covers, or shows them as gaps when aligned', () => {
    expect(selectionText(stack, null, sel(1, 0, 5), 'residues')).toBe('GAAA');
    expect(selectionText(stack, null, sel(1, 0, 3), 'aligned')).toBe('--GA');
  });
  it('copies the reference, dropping the columns another sample opened', () => {
    expect(selectionText(stack, null, sel(REFERENCE_ROW, 3, 8), 'residues')).toBe('AAACC');
    expect(selectionText(stack, null, sel(REFERENCE_ROW, 3, 8), 'aligned')).toBe('AAA-CC');
  });
  it('is empty for a selection that no longer fits', () => {
    expect(selectionText(stack, null, sel(9, 0, 3), 'residues')).toBe('');
  });
});

describe('selectionText amino acids', () => {
  // A forward CDS ATG AAA CCC over columns 0-2, 3-5, then 7-9 (column 6 is an insertion).
  const frame: ResidueFrame = {
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
  const aa = (row: number, a: number, b: number) => ({ ...startSelection(row, 'aa', a), head: b });
  it('copies the reference residues of the codons the columns touch', () => {
    expect(selectionText(stack, [frame], aa(REFERENCE_ROW, 0, 9), 'residues')).toBe('MKP');
    expect(selectionText(stack, [frame], aa(REFERENCE_ROW, 4, 4), 'residues')).toBe('K');
    expect(selectionText(stack, [frame], aa(REFERENCE_ROW, 6, 6), 'residues')).toBe('');
  });
  it('is empty without residues', () => {
    expect(selectionText(stack, null, aa(REFERENCE_ROW, 0, 9), 'residues')).toBe('');
  });
  it('translates the sample and marks an indel codon only when gaps are kept', () => {
    // s1's codon 2 (columns 3-5) has a gap in column 3.
    expect(selectionText(stack, [frame], aa(0, 0, 9), 'residues').length).toBeGreaterThan(0);
    expect(selectionText(stack, [frame], aa(0, 0, 9), 'residues')).not.toContain('-');
    expect(selectionText(stack, [frame], aa(0, 0, 9), 'aligned')).toContain('-');
  });
  it('leaves out codons a sample does not cover', () => {
    const late = stackOf('ATGAAA-CCC', [row('s3', '      -CCC')]);
    expect(selectionText(late, [frame], aa(0, 0, 5), 'aligned')).toBe('');
    // A codon only partly covered is an indel, as the strip draws it.
    expect(selectionText(stack, [frame], aa(1, 0, 2), 'aligned')).toBe('-');
  });
});

describe('copiedNote', () => {
  it('counts and names', () => {
    expect(copiedNote('s1', 'bases', 'ACG', 'residues')).toBe('Copied 3 bases of s1');
    expect(copiedNote('s1', 'aa', 'M', 'aligned')).toBe('Copied 1 amino acid of s1, gaps kept');
    expect(copiedNote('s1', 'aa', 'MK\nP', 'residues')).toBe('Copied 3 amino acids of s1');
  });
});

describe('selectionTargetAt', () => {
  const layout = stackLayout(stack, null, true, false);
  const refTop = RULER_HEIGHT;
  it('finds the reference row and its strip in the pinned header', () => {
    expect(selectionTargetAt(layout, 2, refTop + 2, 0)).toEqual({
      row: REFERENCE_ROW,
      track: 'bases',
    });
    expect(selectionTargetAt(layout, 2, refTop + ROW_HEIGHT + 2, 0)).toEqual({
      row: REFERENCE_ROW,
      track: 'aa',
    });
    expect(selectionTargetAt(layout, 2, 3, 0)).toBeNull();
  });
  it('finds a sample row by scroll, and its strip', () => {
    const rowHeight = ROW_HEIGHT + AA_HEIGHT;
    const y = layout.headerHeight + rowHeight + 3;
    expect(selectionTargetAt(layout, 2, y, 0)).toEqual({ row: 1, track: 'bases' });
    expect(selectionTargetAt(layout, 2, y + ROW_HEIGHT, 0)).toEqual({ row: 1, track: 'aa' });
    expect(selectionTargetAt(layout, 2, layout.headerHeight + 3, rowHeight)).toEqual({
      row: 1,
      track: 'bases',
    });
    expect(selectionTargetAt(layout, 2, layout.contentHeight + 50, 0)).toBeNull();
  });
});
