import { describe, expect, it } from 'vitest';

import { parsePrimerList, splitRow } from './collection';
import { ORDER_HEADER, buildOrderSheet, wellOf, type OrderOligo } from './orderSheet';

const oligos = (n: number): OrderOligo[] =>
  Array.from({ length: n }, (_, i) => ({ name: `o${i + 1}`, sequence: 'ACGTACGTAC' }));

describe('buildOrderSheet (#358)', () => {
  it('writes the header and one line per oligo, with defaults', () => {
    const sheet = buildOrderSheet([{ name: 'a fwd', sequence: 'acgtn', note: 'low Tm' }]);
    expect(ORDER_HEADER).toBe('plate,well,name,sequence,length,scale,purification,notes');
    expect(sheet.csv).toBe(`${ORDER_HEADER}\r\n1,A1,a fwd,ACGTN,5,25 nmol,desalted,low Tm\r\n`);
    expect(sheet.problems).toEqual([]);
  });

  it('takes the scale and purification from the options and computes the length', () => {
    const sheet = buildOrderSheet(oligos(1), { scale: '100 nmol', purification: 'HPLC' });
    expect(sheet.lines[0]).toMatchObject({ length: 10, scale: '100 nmol', purification: 'HPLC' });
  });

  it('fills wells along rows or down columns', () => {
    const rowWise = buildOrderSheet(oligos(14), { wellOrder: 'row' }).lines.map((l) => l.well);
    expect(rowWise.slice(0, 3)).toEqual(['A1', 'A2', 'A3']);
    expect(rowWise[11]).toBe('A12');
    expect(rowWise[12]).toBe('B1');
    const colWise = buildOrderSheet(oligos(10), { wellOrder: 'column' }).lines.map((l) => l.well);
    expect(colWise).toEqual(['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1', 'A2', 'B2']);
  });

  it('starts a second plate at the 97th oligo, in either order', () => {
    for (const wellOrder of ['row', 'column'] as const) {
      const lines = buildOrderSheet(oligos(97), { wellOrder }).lines;
      expect(lines[95]).toMatchObject({ plate: 1, well: wellOrder === 'row' ? 'H12' : 'H12' });
      expect(lines[96]).toMatchObject({ plate: 2, well: 'A1' });
    }
    expect(wellOf(191, 'column')).toEqual({ plate: 2, well: 'H12' });
  });

  it('escapes names and notes with commas, quotes and line breaks', () => {
    const sheet = buildOrderSheet([{ name: 'p "1", fwd', sequence: 'ACGT', note: 'two\nlines' }]);
    expect(sheet.csv).toContain('"p ""1"", fwd"');
    expect(sheet.csv).toContain('"two\nlines"');
  });

  it('reports repeated names (without regard to case) and does not rename', () => {
    const sheet = buildOrderSheet([
      { name: 'x', sequence: 'ACGT' },
      { name: 'X', sequence: 'ACGA' },
      { name: 'y', sequence: 'ACGT' },
    ]);
    expect(sheet.problems).toEqual([
      'The name x is used 2 times; a vendor rejects repeated names.',
    ]);
    expect(sheet.lines.map((l) => l.name)).toEqual(['x', 'X', 'y']);
  });

  it('flags an empty name, an empty sequence and non-base characters', () => {
    const sheet = buildOrderSheet([
      { name: '', sequence: 'ACGT' },
      { name: 'b', sequence: '' },
      { name: 'c', sequence: 'AC1T' },
    ]);
    expect(sheet.problems).toEqual([
      'An oligo has no name.',
      'b has no sequence.',
      'c has characters that are not bases.',
    ]);
  });

  it('writes only the header for no oligos', () => {
    const sheet = buildOrderSheet([]);
    expect(sheet.csv).toBe(`${ORDER_HEADER}\r\n`);
    expect(sheet.lines).toEqual([]);
    expect(sheet.problems).toEqual([]);
  });

  it('reads back, through the repo CSV readers, as the same oligos', () => {
    const made: OrderOligo[] = [
      { name: 'gene, "A" fwd', sequence: 'ACGTRYNACGT', note: 'a, b' },
      { name: 'gene rev', sequence: 'TTGACCATGCAGGTCA' },
    ];
    const sheet = buildOrderSheet(made);
    const [header, ...rest] = sheet.csv.trimEnd().split('\r\n');
    expect(splitRow(header ?? '', ',')).toEqual(ORDER_HEADER.split(','));
    expect(rest.map((r) => splitRow(r, ',').slice(2, 5))).toEqual([
      ['gene, "A" fwd', 'ACGTRYNACGT', '11'],
      ['gene rev', 'TTGACCATGCAGGTCA', '16'],
    ]);
    const read = parsePrimerList(sheet.csv);
    expect(read.primers.map((p) => [p.name, p.sequence])).toEqual(
      made.map((o) => [o.name, o.sequence]),
    );
  });
});
