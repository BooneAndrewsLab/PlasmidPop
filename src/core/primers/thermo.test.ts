import {
  gcFraction,
  longestHomopolymer,
  maxSelfComplementarity,
  meltingTemperature,
} from './thermo';

describe('meltingTemperature', () => {
  it('matches a hand-computed SantaLucia value for a short oligo', () => {
    // ATGC: NN sums dH -25.5, dS -67.5; ends A (+2.3/+4.1) and C (+0.1/-2.8);
    // salt 0.368*3*ln(0.05); Ct/4 = 125 nM.
    expect(meltingTemperature('ATGC')).toBeCloseTo(-44.6, 0);
  });

  it('behaves physically', () => {
    const short = meltingTemperature('GTAAAACGACGGCCAGT'); // M13 forward
    expect(short).toBeGreaterThan(48);
    expect(short).toBeLessThan(60);
    expect(meltingTemperature('GTAAAACGACGGCCAGTGAATT')).toBeGreaterThan(short);
    expect(meltingTemperature('GCGCGCGCGCGCGCGCGCGC')).toBeGreaterThan(
      meltingTemperature('ATATATATATATATATATAT'),
    );
    expect(meltingTemperature('ACGTACGTACGTACGTACGT', { sodiumMM: 200 })).toBeGreaterThan(
      meltingTemperature('ACGTACGTACGTACGTACGT', { sodiumMM: 50 }),
    );
    expect(meltingTemperature('acgtu')).toBe(meltingTemperature('ACGTT'));
  });

  it('applies the symmetry correction to self-complementary oligos', () => {
    // GAATTC is its own reverse complement; the symmetric branch uses Ct, not Ct/4, and dS -1.4.
    const palindrome = meltingTemperature('GAATTCGAATTC');
    expect(Number.isFinite(palindrome)).toBe(true);
    expect(meltingTemperature('A')).toBeNaN();
    expect(meltingTemperature('ACGTN')).toBeNaN();
  });
});

describe('primer sequence metrics', () => {
  it('computes GC, homopolymer runs and self-complementarity', () => {
    expect(gcFraction('GGCC')).toBe(1);
    expect(gcFraction('ATAT')).toBe(0);
    expect(gcFraction('')).toBe(0);
    expect(longestHomopolymer('AACCCCGT')).toBe(4);
    expect(longestHomopolymer('')).toBe(0);
    expect(maxSelfComplementarity('GAATTC')).toBe(6);
    expect(maxSelfComplementarity('AAAAAAAA')).toBe(0);
    expect(maxSelfComplementarity('ACGTTTTT')).toBeGreaterThanOrEqual(4);
  });
});
