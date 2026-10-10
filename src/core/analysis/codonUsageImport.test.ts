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
});
