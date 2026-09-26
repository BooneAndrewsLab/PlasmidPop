import { BLOSUM62, BLOSUM62_ORDER } from './blosum62';
import { alignPairwise } from './pairwise';
import { encodeProtein, proteinScoreTable, residueMark } from './scoring';

/** What BLOSUM62 scores a pair of residues, straight from the table. */
function blosum(x: string, y: string): number {
  return BLOSUM62[BLOSUM62_ORDER.indexOf(x)]?.[BLOSUM62_ORDER.indexOf(y)] ?? 0;
}

describe('BLOSUM62 as the NCBI distributes it', () => {
  it('is square, symmetric, and has the values everyone knows', () => {
    expect(BLOSUM62_ORDER).toBe('ARNDCQEGHILKMFPSTWYVBZX*');
    expect(BLOSUM62).toHaveLength(BLOSUM62_ORDER.length);
    for (const [i, row] of BLOSUM62.entries()) {
      expect(row).toHaveLength(BLOSUM62_ORDER.length);
      for (const [j, value] of row.entries()) expect(value).toBe(BLOSUM62[j]?.[i]);
    }
    // The corners of the matrix people quote: W against W is 11, C against
    // C is 9, the conservative K/R is 2, and W against anything else is bad.
    expect(blosum('W', 'W')).toBe(11);
    expect(blosum('C', 'C')).toBe(9);
    expect(blosum('K', 'R')).toBe(2);
    expect(blosum('L', 'I')).toBe(2);
    expect(blosum('W', 'P')).toBe(-4);
    expect(blosum('*', '*')).toBe(1);
  });
});

describe('scoring residues', () => {
  it('reads a residue into its row, and the two the matrix predates', () => {
    const codes = encodeProtein('ARNDU O*?');
    expect(codes[0]).toBe(BLOSUM62_ORDER.indexOf('A'));
    // Selenocysteine scores as cysteine, pyrrolysine as lysine.
    expect(codes[4]).toBe(BLOSUM62_ORDER.indexOf('C'));
    expect(codes[6]).toBe(BLOSUM62_ORDER.indexOf('K'));
    expect(codes[7]).toBe(BLOSUM62_ORDER.indexOf('*'));
    // Neither a residue nor a stop: the row after the matrix.
    expect(codes[8]).toBe(BLOSUM62_ORDER.length);
    expect(codes[5]).toBe(BLOSUM62_ORDER.length);
  });

  it('builds the score table from the matrix, scaled', () => {
    const table = proteinScoreTable(2);
    const n = BLOSUM62_ORDER.length + 1;
    const at = (x: string, y: string): number =>
      table[BLOSUM62_ORDER.indexOf(x) * n + BLOSUM62_ORDER.indexOf(y)] ?? 0;
    expect(at('W', 'W')).toBe(22);
    expect(at('K', 'R')).toBe(4);
    // A letter that is no residue scores the matrix's own worst.
    expect(table[BLOSUM62_ORDER.length * n]).toBe(-4 * 2);
  });

  it('marks a match, a likely substitution and an unlikely one', () => {
    expect(residueMark('W', 'W')).toBe('|');
    expect(residueMark('K', 'R')).toBe(':');
    expect(residueMark('L', 'I')).toBe(':');
    expect(residueMark('W', 'P')).toBe('.');
    // X against X is not a match: it is two unknowns.
    expect(residueMark('X', 'X')).toBe('.');
    expect(residueMark('?', 'A')).toBe('.');
  });
});

describe('aligning two proteins (#95)', () => {
  it('scores an exact alignment as the matrix does, residue by residue', () => {
    const peptide = 'MKWVTFISLLFLFSSAYS';
    const result = alignPairwise(peptide, peptide, { alphabet: 'protein' });
    const expected = Array.from(peptide, (aa) => blosum(aa, aa)).reduce((a, b) => a + b, 0);
    expect(result.score).toBe(expected);
    expect(result.identities).toBe(peptide.length);
    expect(result.matchLine).toBe('|'.repeat(peptide.length));
  });

  it('prefers a conservative substitution to a gap, and says which it is', () => {
    // One residue differs: K for R, which BLOSUM62 likes (+2).
    const a = 'MKWVTFISLLFLFSSAYS';
    const b = 'MRWVTFISLLFLFSSAYS';
    const result = alignPairwise(a, b, { alphabet: 'protein' });
    expect(result.alignedA).toBe(a);
    expect(result.alignedB).toBe(b);
    expect(result.matchLine.charAt(1)).toBe(':');
    expect(result.identities).toBe(a.length - 1);
    expect(result.gaps).toBe(0);
  });

  it('is not the nucleotide alignment of the same letters', () => {
    // As bases these are a string of mismatches; as residues they are a
    // protein and its conservative variant.
    const a = 'ACDEFGHIKLMNPQRSTVWY';
    const b = 'ACDEFGHIKLMNPQRSTVWF';
    const asProtein = alignPairwise(a, b, { alphabet: 'protein' });
    const asDna = alignPairwise(a, b, {});
    expect(asProtein.score).toBeGreaterThan(asDna.score);
    // Y against F is a likely substitution, not a mismatch.
    expect(asProtein.matchLine.endsWith(':')).toBe(true);
  });

  it('opens a gap where a residue is missing, at the protein cost', () => {
    const a = 'MKWVTFISLLFLFSSAYS';
    const b = 'MKWVTFISLFLFSSAYS'; // one L short
    const result = alignPairwise(a, b, { alphabet: 'protein' });
    expect(result.gaps).toBe(1);
    expect(result.alignedB).toContain('-');
    // The gap costs 11 to open, so the score is the identity score less that.
    const whole = Array.from(a, (aa) => blosum(aa, aa)).reduce((x, y) => x + y, 0);
    expect(result.score).toBe(whole - blosum('L', 'L') - 11);
  });

  it('finds the shared stretch of two proteins in local mode', () => {
    const shared = 'LVPRGSHMASMTGGQQMG';
    const result = alignPairwise(`AAAA${shared}CCCC`, `WWWWWW${shared}YY`, {
      alphabet: 'protein',
      mode: 'local',
    });
    expect(result.alignedA.replace(/-/g, '')).toBe(shared);
    expect(result.identities).toBe(shared.length);
  });
});
