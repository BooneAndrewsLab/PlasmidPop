import {
  ALL_CODONS,
  DEGENERATE_CODONS,
  codonChoices,
  codonUsageTable,
  libraryCoverage,
} from './codonUsage';
import { CODON_USAGE_TABLES } from './codonUsageTables';
import { translateCodon } from './codons';

describe('codon usage tables (#69)', () => {
  it('counts all 64 codons for every host', () => {
    for (const t of CODON_USAGE_TABLES) {
      expect(t.counts).toHaveLength(64);
      expect(t.counts.every((n) => Number.isInteger(n) && n >= 0)).toBe(true);
      expect(t.counts.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    }
  });

  it('holds the numbers the database prints for E. coli W3110', () => {
    // https://www.kazusa.or.jp/codon/, taxon 316407, fetched 2026-09-25.
    const ecoli = codonUsageTable('ecoli');
    expect(ecoli.cds).toBe(4332);
    expect(ecoli.counts.reduce((a, b) => a + b, 0)).toBe(1_372_057);
    expect(ecoli.counts[ALL_CODONS.indexOf('CTG')]).toBe(72_898);
  });

  it('falls back to the first table for an id it does not know', () => {
    expect(codonUsageTable('mars').id).toBe(CODON_USAGE_TABLES[0]?.id);
  });
});

describe('codonChoices', () => {
  const first = (aa: string, host: string): string | undefined =>
    codonChoices(aa, codonUsageTable(host))[0]?.codon;

  it("puts the host's commonest codon first", () => {
    // The textbook preferences: E. coli leucine CTG and proline CCG,
    // yeast leucine TTG and arginine AGA.
    expect(first('L', 'ecoli')).toBe('CTG');
    expect(first('P', 'ecoli')).toBe('CCG');
    expect(first('L', 'yeast')).toBe('TTG');
    expect(first('R', 'yeast')).toBe('AGA');
  });

  it('offers every synonym of the amino acid and nothing else, shares summing to one', () => {
    const choices = codonChoices('S', codonUsageTable('human'));
    expect(choices.map((c) => c.codon).sort()).toEqual(
      ALL_CODONS.filter((c) => translateCodon(c) === 'S').sort(),
    );
    expect(choices.reduce((n, c) => n + c.fraction, 0)).toBeCloseTo(1);
    expect(choices.map((c) => c.fraction)).toEqual(
      [...choices.map((c) => c.fraction)].sort((a, b) => b - a),
    );
  });

  it('breaks a tie in favour of the fewest bases changed', () => {
    // K to R with every codon as common as the next: of arginine's six,
    // AGG alone is one base from AAG, so it comes first.
    const host = { ...codonUsageTable('ecoli'), counts: ALL_CODONS.map(() => 1) };
    const [top] = codonChoices('R', host, 'AAG');
    expect(top?.codon).toBe('AGG');
    expect(top?.changes).toBe(1);
    // Without a codon to replace, nothing has changed.
    expect(codonChoices('R', host)[0]?.changes).toBe(0);
  });

  it('reads the amino acid with the genetic code it is given', () => {
    // Table 2 (vertebrate mitochondrial) reads TGA as tryptophan.
    expect(codonChoices('W', codonUsageTable('human'), '', 2).map((c) => c.codon)).toContain('TGA');
    expect(codonChoices('W', codonUsageTable('human')).map((c) => c.codon)).not.toContain('TGA');
  });

  it('splits evenly when the host counted none of the codons', () => {
    const empty = { ...codonUsageTable('ecoli'), counts: ALL_CODONS.map(() => 0) };
    const choices = codonChoices('C', empty);
    expect(choices).toHaveLength(2);
    expect(choices.every((c) => c.fraction === 0.5)).toBe(true);
  });
});

describe('libraryCoverage', () => {
  it('has NNK give 32 codons, all 20 amino acids and one stop', () => {
    const nnk = libraryCoverage('NNK');
    expect(nnk.codons).toBe(32);
    expect(nnk.aminoAcids.size).toBe(20);
    expect(nnk.stops).toBe(1);
    // Three codons of the 32 are leucine, one is methionine.
    expect(nnk.aminoAcids.get('L')).toBe(3);
    expect(nnk.aminoAcids.get('M')).toBe(1);
  });

  it('has NNN give 64 codons and three stops, NDT 12 codons and no stop', () => {
    const nnn = libraryCoverage('NNN');
    expect([nnn.codons, nnn.aminoAcids.size, nnn.stops]).toEqual([64, 20, 3]);
    const ndt = libraryCoverage('NDT');
    expect([ndt.codons, ndt.aminoAcids.size, ndt.stops]).toEqual([12, 12, 0]);
  });

  it('asks for about three times the codons to be 95 % sure of meeting one', () => {
    for (const degenerate of DEGENERATE_CODONS) {
      const { codons, screen95 } = libraryCoverage(degenerate);
      expect(1 - (1 - 1 / codons) ** screen95).toBeGreaterThanOrEqual(0.95);
      expect(1 - (1 - 1 / codons) ** (screen95 - 1)).toBeLessThan(0.95);
      expect(screen95).toBeGreaterThan(2 * codons);
      expect(screen95).toBeLessThan(3.5 * codons);
    }
  });

  it('counts a plain codon as one, and reads the code it is given', () => {
    expect(libraryCoverage('ATG')).toMatchObject({ codons: 1, stops: 0, screen95: 1 });
    // TGA is a stop under the standard code and tryptophan under table 2.
    expect(libraryCoverage('TGA').stops).toBe(1);
    expect(libraryCoverage('TGA', 2).stops).toBe(0);
  });
});
