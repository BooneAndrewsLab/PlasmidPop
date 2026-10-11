import { ALL_CODONS, codonUsageTable, parseCodonUsageText } from './codonUsage';

const ecoli = codonUsageTable('ecoli');

/** The Codon Usage Database's page layout, four codons to a line. */
function kazusaText(): string {
  const rows: string[] = [];
  for (let i = 0; i < 64; i += 4) {
    rows.push(
      [0, 1, 2, 3]
        .map((k) => {
          const codon = (ALL_CODONS[i + k] ?? '').replace(/T/g, 'U');
          const n = ecoli.counts[i + k] ?? 0;
          return `${codon} 12.3(${String(n).padStart(7)})`;
        })
        .join('  '),
    );
  }
  return `# My strain\n${rows.join('\n')}\n`;
}

describe('parseCodonUsageText (#209)', () => {
  it("reads the Codon Usage Database's layout, U as T, and names it from the first line", () => {
    const r = parseCodonUsageText(kazusaText(), 'x.txt');
    if (!r.ok) throw new Error(r.error);
    expect(r.table.counts).toEqual(ecoli.counts);
    expect(r.table.name).toBe('My strain');
    expect(r.table.id).toBe('custom-my-strain');
  });

  it('reads one codon a line, the count last, comma or tab or space', () => {
    const csv = ALL_CODONS.map((c, i) => `${c},${ecoli.counts[i] ?? 0}`).join('\n');
    const tsv = ALL_CODONS.map((c, i) => `${c}\tX\t${ecoli.counts[i] ?? 0}`).join('\n');
    for (const text of [csv, tsv]) {
      const r = parseCodonUsageText(text, 'host.csv');
      if (!r.ok) throw new Error(r.error);
      expect(r.table.counts).toEqual(ecoli.counts);
      expect(r.table.name).toBe('host');
    }
  });

  it('takes a table with the stops left out but not with half of it missing', () => {
    const rows = ALL_CODONS.map((c, i) => `${c} ${ecoli.counts[i] ?? 0}`);
    expect(parseCodonUsageText(rows.slice(0, 61).join('\n'), 'a').ok).toBe(true);
    const short = parseCodonUsageText(rows.slice(0, 30).join('\n'), 'a');
    expect(short.ok).toBe(false);
  });

  it('refuses a codon given twice and a table of zeros', () => {
    const rows = ALL_CODONS.map((c, i) => `${c} ${ecoli.counts[i] ?? 0}`);
    const twice = parseCodonUsageText([...rows, 'TTT 5'].join('\n'), 'a');
    expect(twice.ok ? '' : twice.error).toMatch(/TTT is given more than once/);
    const zeros = parseCodonUsageText(ALL_CODONS.map((c) => `${c} 0`).join('\n'), 'a');
    expect(zeros.ok ? '' : zeros.error).toMatch(/zero/);
  });

  const valid = (n: number): string[] => ALL_CODONS.slice(0, n).map((c, i) => `${c} ${i + 1}`);

  it('names the table from the first line only, past a BOM, blanks and indentation', () => {
    const rows = valid(64).join('\n');
    const named = (head: string, file: string | null) => {
      const r = parseCodonUsageText(`${head}\n${rows}`, file);
      if (!r.ok) throw new Error(r.error);
      return r.table;
    };
    expect(named('﻿# Bom name', 'f.txt').name).toBe('Bom name');
    expect(named('\n\n# After blanks', 'f.txt').name).toBe('After blanks');
    expect(named('   # Indented   ', 'f.txt').name).toBe('Indented');
    // Only the first line names it; an empty first comment leaves the file name.
    expect(named('#', 'host.txt').name).toBe('host');
    const late = parseCodonUsageText(`${rows}\n# Late`, 'host.txt');
    expect(late.ok && late.table.name).toBe('host');
  });

  it('falls back to the file name sans its last extension, then to a default', () => {
    const rows = valid(64).join('\n');
    const nameOf = (file: string | null) => {
      const r = parseCodonUsageText(rows, file);
      if (!r.ok) throw new Error(r.error);
      return r.table;
    };
    expect(nameOf('my.host.csv').name).toBe('my.host');
    expect(nameOf('host .csv').name).toBe('host');
    expect(nameOf(null).name).toBe('Imported table');
    expect(nameOf(null).id).toBe('custom-imported-table');
  });

  it('makes the id from letters and digits, one dash for a run, none at the ends', () => {
    const idOf = (name: string): string => {
      const r = parseCodonUsageText(`# ${name}\n${valid(64).join('\n')}`, null);
      if (!r.ok) throw new Error(r.error);
      return r.table.id;
    };
    expect(idOf('My  strain (K-12)')).toBe('custom-my-strain-k-12');
    expect(idOf('!!x!!')).toBe('custom-x');
    expect(idOf('!!!')).toBe('custom-table');
  });

  it('skips what is not a codon with a count, so it cannot pad a short table', () => {
    const junk = ['NNN 5', 'XYZ 1', 'TTTT 5', 'XACG 5', 'GGG 1e5', `AAA ${'9'.repeat(400)}`];
    const r = parseCodonUsageText([...valid(60), ...junk].join('\n'), 'a');
    expect(r.ok ? '' : r.error).toMatch(/Found 60 codons/);
  });

  it('leaves out a codon whose count is not finite', () => {
    const rows = ALL_CODONS.map((c, i) => `${c} ${i === 0 ? '9'.repeat(400) : i}`);
    const r = parseCodonUsageText(rows.join('\n'), 'a');
    if (!r.ok) throw new Error(r.error);
    expect(r.table.counts[0]).toBe(0);
    expect(r.table.counts[1]).toBe(1);
  });

  it('reads the database layout however the numbers are spaced', () => {
    const rows = ALL_CODONS.map((c, i) => `${c.replace(/T/g, 'U')}   17.6 ( ${i + 1} )`);
    const r = parseCodonUsageText(rows.join('\n'), 'a');
    if (!r.ok) throw new Error(r.error);
    expect(r.table.counts).toEqual(ALL_CODONS.map((_, i) => i + 1));
  });

  it('reads a decimal count, and ignores separators at the ends of a line', () => {
    const rows = ALL_CODONS.map((c, i) => `${c},${i + 1}.25,,`);
    const lead = ALL_CODONS.map((c, i) => `,${c};F;${i + 1}`);
    for (const text of [rows, lead]) {
      const r = parseCodonUsageText(text.join('\n'), 'a');
      if (!r.ok) throw new Error(r.error);
      expect(r.table.counts[63]).toBeGreaterThanOrEqual(64);
    }
  });

  it('takes only a plain number as the count', () => {
    const rows = valid(60);
    rows.push('GGG 1e5');
    const r = parseCodonUsageText(rows.join('\n'), 'a');
    expect(r.ok).toBe(false);
  });
});
