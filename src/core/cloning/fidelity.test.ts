import { reverseComplement } from '@/core';

import { type FidelityTable, formatFidelity, parseFidelityCsv, setFidelity } from './fidelity';

/**
 * A table in the shape the published ones come in: a header of overhangs,
 * then a row per overhang. Only the pairs named are counted, so a test says
 * exactly what the ligase did.
 */
function tableOf(
  overhangs: readonly string[],
  pairs: Readonly<Record<string, number>>,
): { readonly text: string; readonly table: FidelityTable } {
  const count = (row: string, column: string): number =>
    pairs[`${row}/${column}`] ?? pairs[`${column}/${row}`] ?? 0;
  const lines = [
    ['Overhang', ...overhangs].join(','),
    ...overhangs.map((row) => [row, ...overhangs.map((c) => count(row, c))].join(',')),
  ];
  const text = lines.join('\n');
  return { text, table: parseFidelityCsv(text, 'test-table.csv').table };
}

/** The four overhangs of a two-part assembly, with their partners. */
const FOUR = ['AAAA', 'TTTT', 'ACGT', 'GGCC'];

describe('parseFidelityCsv (#68)', () => {
  it('reads a square matrix, its overhang length and what it counted', () => {
    const { text } = tableOf(FOUR, { 'AAAA/TTTT': 500, 'ACGT/ACGT': 20, 'GGCC/GGCC': 7 });
    const parsed = parseFidelityCsv(text, 'T4_18h_37C.csv');
    expect(parsed.overhangs).toBe(4);
    // A pair stands in both of its cells and is one ligation, not two.
    expect(parsed.events).toBe(500 + 20 + 7);
    expect(parsed.table.overhangLength).toBe(4);
    expect(parsed.table.label).toBe('T4_18h_37C');
    expect(parsed.table.counts.get('AAAA')?.get('TTTT')).toBe(500);
  });

  it('takes a tab-separated file too, and a file with no name', () => {
    const { text } = tableOf(['AAA', 'TTT'], { 'AAA/TTT': 9 });
    const parsed = parseFidelityCsv(text.replaceAll(',', '\t'));
    expect(parsed.table.overhangLength).toBe(3);
    expect(parsed.table.label).toBe('Imported table');
    expect(parsed.table.counts.get('AAA')?.get('TTT')).toBe(9);
  });

  it('says what is wrong with a file that is not one', () => {
    expect(() => parseFidelityCsv('name,site\nEcoRI,GAATTC\n')).toThrow(/not a ligation fidelity/);
    expect(() => parseFidelityCsv('')).toThrow(/not a ligation fidelity/);
    const { text } = tableOf(FOUR, { 'AAAA/TTTT': 500 });
    expect(() => parseFidelityCsv(text.split('\n').slice(0, 3).join('\n'))).toThrow(/square/);
    expect(() => parseFidelityCsv(text.replace('\nACGT,', '\nACG,'))).toThrow(
      /not an overhang of 4/,
    );
    expect(() => parseFidelityCsv(text.replace('500', 'lots'))).toThrow(/is not a count/);
    expect(() => parseFidelityCsv(tableOf(FOUR, {}).text)).toThrow(/counts no ligation/);
  });
});

describe('setFidelity', () => {
  it('is one where every junction only ever joined its own partner', () => {
    const { table } = tableOf(['AAAA', 'TTTT', 'ACGT', 'GGCC'], {
      'AAAA/TTTT': 1000,
      'ACGT/ACGT': 1000,
    });
    const perfect = setFidelity(['AAAA'], table);
    expect(perfect.fidelity).toBe(1);
    expect(perfect.worst).toEqual([]);
    expect(perfect.junctions[0]).toMatchObject({ onTarget: 1000, offTarget: 0 });
  });

  it('counts a join to another junction as a mistake, and names the worst', () => {
    // AAAA/TTTT is one junction, AAAT/ATTT the other; AAAA also joined ATTT,
    // which is the mis-join, in a tenth of its ligations.
    const { table } = tableOf(['AAAA', 'TTTT', 'AAAT', 'ATTT'], {
      'AAAA/TTTT': 900,
      'AAAT/ATTT': 1000,
      'AAAA/ATTT': 100,
    });
    const scored = setFidelity(['AAAA', 'AAAT'], table);
    expect(scored.junctions[0]).toMatchObject({ overhang: 'AAAA', onTarget: 900, offTarget: 100 });
    expect(scored.junctions[0]?.fidelity).toBeCloseTo(0.9);
    // The other junction saw the same mis-join among its own ligations.
    expect(scored.junctions[1]?.fidelity).toBeCloseTo(1000 / 1100);
    expect(scored.fidelity).toBeCloseTo(0.9 * (1000 / 1100));
    expect(scored.worst[0]).toMatchObject({ a: 'AAAA', b: 'ATTT' });
    expect(scored.worst[0]?.rate).toBeCloseTo(0.1);
  });

  it('counts a palindrome joining a copy of itself', () => {
    // GGCC is its own reverse complement, so its two ends are the same
    // overhang: a join of GGCC to GGCC is both the right one and a wrong one.
    const { table } = tableOf(['GGCC', 'AAAA', 'TTTT'], { 'GGCC/GGCC': 800, 'AAAA/TTTT': 800 });
    const scored = setFidelity(['GGCC', 'AAAA'], table);
    expect(scored.junctions[0]?.overhang).toBe('GGCC');
    expect(reverseComplement('GGCC')).toBe('GGCC');
    expect(scored.fidelity).toBe(1);
  });

  it('leaves out an overhang the table does not cover, and scores the rest', () => {
    const { table } = tableOf(['AAAA', 'TTTT'], { 'AAAA/TTTT': 10 });
    const scored = setFidelity(['AAAA', 'NNNN', 'AAA'], table);
    expect(scored.unknown).toEqual(['NNNN', 'AAA']);
    expect(scored.junctions.map((j) => j.overhang)).toEqual(['AAAA']);
    expect(scored.fidelity).toBe(1);
  });

  it('is one for an empty set, and for a junction the table never saw', () => {
    const { table } = tableOf(['AAAA', 'TTTT', 'ACGT'], { 'AAAA/TTTT': 5 });
    expect(setFidelity([], table).fidelity).toBe(1);
    const never = setFidelity(['ACGT'], table);
    expect(never.junctions[0]).toMatchObject({ onTarget: 0, offTarget: 0, fidelity: 1 });
  });
});

describe('formatFidelity', () => {
  it('keeps a decimal where a whole number would round away the loss', () => {
    expect(formatFidelity(1)).toBe('100 %');
    expect(formatFidelity(0.996)).toBe('99.6 %');
    expect(formatFidelity(0.9999)).toBe('100.0 %');
    expect(formatFidelity(0.982)).toBe('98 %');
    expect(formatFidelity(0.5)).toBe('50 %');
    expect(formatFidelity(0.061)).toBe('6.1 %');
  });
});
