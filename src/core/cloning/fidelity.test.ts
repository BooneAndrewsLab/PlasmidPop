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

describe('reading the file people actually have', () => {
  it('splits on commas when a line has both, and on tabs when it has none', () => {
    // A comma-separated line with a stray tab in it is still
    // comma-separated; the cells are trimmed either way.
    const commas = ['Overhang,AAAA,TTTT\t', 'AAAA,0,7', 'TTTT,7,0'].join('\n');
    expect(parseFidelityCsv(commas).table.counts.get('AAAA')?.get('TTTT')).toBe(7);
    // With no comma anywhere, the tab is the separator.
    const tabs = ['Overhang\tAAAA\tTTTT', 'AAAA\t0\t7', 'TTTT\t7\t0'].join('\n');
    expect(parseFidelityCsv(tabs).table.counts.get('AAAA')?.get('TTTT')).toBe(7);
  });

  it('refuses a table that names an overhang twice, in a column or a row', () => {
    expect(() => parseFidelityCsv('Overhang,AAAA,AAAA\nAAAA,1,1\nTTTT,1,1')).toThrow(
      /same overhang in two columns/,
    );
    expect(() => parseFidelityCsv('Overhang,AAAA,TTTT\nAAAA,0,5\nAAAA,5,0')).toThrow(
      /two rows for AAAA/,
    );
  });

  it('refuses a count that is not one, and keeps a zero out of the table', () => {
    expect(() => parseFidelityCsv('Overhang,AAAA,TTTT\nAAAA,0,-5\nTTTT,-5,0')).toThrow(
      /is not a count/,
    );
    const { table } = parseFidelityCsv('Overhang,AAAA,TTTT\nAAAA,0,9\nTTTT,9,0');
    // A zero is no ligation: it is left out rather than stored.
    expect(table.counts.get('AAAA')?.has('AAAA')).toBe(false);
    expect(table.counts.get('AAAA')?.get('TTTT')).toBe(9);
  });

  it('reads a table that fills only one half of the matrix', () => {
    // Some tables give the upper triangle and leave the rest at zero; the
    // pair is counted whichever cell holds it.
    const text = ['Overhang,AAAA,TTTT,ACGT', 'AAAA,0,900,0', 'TTTT,0,0,0', 'ACGT,0,0,40'].join(
      '\n',
    );
    const { table, events } = parseFidelityCsv(text);
    expect(events).toBe(940);
    const scored = setFidelity(['AAAA'], table);
    expect(scored.junctions[0]?.onTarget).toBe(900);
  });

  it('names the table after the file, extension and all removed', () => {
    expect(
      parseFidelityCsv('Overhang,AAAA,TTTT\nAAAA,0,1\nTTTT,1,0', 'T4.18h.37C.csv').table,
    ).toMatchObject({ label: 'T4.18h.37C', fileName: 'T4.18h.37C.csv' });
    expect(parseFidelityCsv('Overhang,AAAA,TTTT\nAAAA,0,1\nTTTT,1,0', 'plain').table.label).toBe(
      'plain',
    );
  });

  it('holds an overhang to the length the table covers', () => {
    const { table } = parseFidelityCsv('Overhang,AAA,TTT\nAAA,0,5\nTTT,5,0');
    // Four bases against a table of three: not scored rather than mis-scored.
    const scored = setFidelity(['AAAA', 'AAA'], table);
    expect(scored.unknown).toEqual(['AAAA']);
    expect(scored.junctions.map((j) => j.overhang)).toEqual(['AAA']);
  });
});
