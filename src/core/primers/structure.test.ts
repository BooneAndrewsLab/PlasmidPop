import oracle from '../../test/oracle/hairpinDimer.json';
import { dimerEnergy, hairpinEnergy, selfDimerEnergy } from './structure';

/**
 * The ΔG model against Primer3's `calc_hairpin`, `calc_homodimer` and
 * `calc_heterodimer` on the committed oracle (item 121/123). The loop terms
 * are scalars fitted to this kind of data, so the tolerances are the
 * measured ones, a little loosened, not a claim of exactness.
 */

interface Row {
  readonly seq: string;
  readonly hairpin: { readonly dg: number };
  readonly homodimer: { readonly dg: number };
}
interface Pair {
  readonly a: string;
  readonly b: string;
  readonly dg: number;
}
const rows = oracle.rows as readonly Row[];
const pairs = oracle.pairs as readonly Pair[];

/** Primer3 reports a positive ΔG for a structure that does not form; we say 0. */
const reference = (dg: number): number => Math.min(dg, 0);

function errors(cases: readonly (readonly [number, number])[]): { mean: number; max: number } {
  const e = cases.map(([ours, theirs]) => Math.abs(ours - reference(theirs)));
  return { mean: e.reduce((a, b) => a + b, 0) / e.length, max: Math.max(...e) };
}

describe('hairpinEnergy', () => {
  it('is zero for sequences that cannot fold', () => {
    expect(hairpinEnergy('AAAAAAAAAAAAAAAAAAAA')).toBe(0);
    expect(hairpinEnergy('ACGT')).toBe(0);
    expect(hairpinEnergy('')).toBe(0);
  });

  it('weighs G/C stems over A/T ones (#339, #340)', () => {
    // Primer3: +0.88 and -0.15 for the A/T stems, -2.79 for the G/C one.
    expect(hairpinEnergy('TTTATAGTAATAAATTATCACGATATTTTCA')).toBeGreaterThan(-2);
    expect(hairpinEnergy('AAAATTTTAAAAACAAAATTA')).toBeGreaterThan(-2);
    expect(hairpinEnergy('CCCGCCGGGGGTTTCGCGG')).toBeLessThanOrEqual(-2);
    expect(hairpinEnergy('GACGGGCTATCGGCCCTCTGTCTAT')).toBeLessThanOrEqual(-2);
  });

  it('is close to Primer3 on named primers', () => {
    const near = (seq: string, dg: number, tolerance: number): void => {
      expect(Math.abs(hairpinEnergy(seq) - dg)).toBeLessThan(tolerance);
    };
    near('CCCGCCGGGGGTTTCGCGG', -2.789, 1);
    near('GACGGGCTATCGGCCCTCTGTCTAT', -2.975, 0.5);
    near('CGCGCTTGACGCTTC', -2.023, 0.5);
    near('GGATCCTTTTGGATCC', -3.651, 1.5);
  });

  it('agrees with Primer3 across the oracle within the measured error', () => {
    const e = errors(rows.map((r) => [hairpinEnergy(r.seq), r.hairpin.dg]));
    // Measured: mean 0.26, max 2.26 kcal/mol over 300 primers.
    expect(e.mean).toBeLessThan(0.35);
    expect(e.max).toBeLessThan(2.6);
  });
});

describe('dimerEnergy', () => {
  it('is zero when nothing pairs', () => {
    expect(dimerEnergy('AAAAAAAAAAAA', 'AAAAAAAAAAAA')).toBe(0);
    expect(dimerEnergy('', 'ACGT')).toBe(0);
  });

  it('is symmetric in the two primers', () => {
    const a = 'GACGCCTGAGGGACAC';
    const b = 'AATGCGAGCCCAGGCGATCGCC';
    expect(dimerEnergy(a, b)).toBeCloseTo(dimerEnergy(b, a), 6);
  });

  it('finds the dimers a 3′ run misses and ignores the weak ones (#341-#344)', () => {
    // Primer3: -8.56 for the G/C cross-dimer with a 2 bp 3′ match.
    expect(dimerEnergy('GACGCCTGAGGGACAC', 'AATGCGAGCCCAGGCGATCGCC')).toBeLessThanOrEqual(-6);
    // Primer3: -5.34 and -1.89 for the A/T-rich self-dimers.
    expect(selfDimerEnergy('TTACTGTTATTTATAAATGAACAAATTCATTTT')).toBeGreaterThan(-6);
    expect(selfDimerEnergy('GCGTGTTGAGAATTATAATTATATTTTCA')).toBeGreaterThan(-6);
    // The G/C self-dimers with mismatches, -9.84 and -9.28.
    expect(selfDimerEnergy('GCGGCCGATGCTGGGCTACTCTTCCA')).toBeLessThanOrEqual(-6);
    expect(selfDimerEnergy('CCCGCCGGGGGTTTCGCGG')).toBeLessThanOrEqual(-6);
  });

  it('is close to Primer3 on a palindrome, where the whole primer pairs', () => {
    // Primer3: -29.62 for GCGCGCGCGCGCGCGCGC.
    expect(Math.abs(selfDimerEnergy('GCGCGCGCGCGCGCGCGC') + 29.62)).toBeLessThan(1);
    expect(Math.abs(selfDimerEnergy('GAATTCGAATTCGAATTC') + 13.14)).toBeLessThan(1);
  });

  it('agrees with Primer3 across the oracle within the measured error', () => {
    const self = errors(rows.map((r) => [selfDimerEnergy(r.seq), r.homodimer.dg]));
    // Measured: mean 0.69, max 4.69 kcal/mol over 300 primers.
    expect(self.mean).toBeLessThan(0.8);
    expect(self.max).toBeLessThan(5);
    const pair = errors(pairs.map((p) => [dimerEnergy(p.a, p.b), p.dg]));
    // Measured: mean 0.48, max 5.20 kcal/mol over 199 pairs.
    expect(pair.mean).toBeLessThan(0.6);
    expect(pair.max).toBeLessThan(5.5);
  });
});
