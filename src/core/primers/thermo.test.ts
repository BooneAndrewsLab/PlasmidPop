import {
  q5AnnealingTemperature,
  q5MeltingTemperature,
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

describe('q5MeltingTemperature (#69)', () => {
  // What NEB's Tm Calculator showed for Q5 High-Fidelity DNA Polymerase at
  // 500 nM, 2026-09-25, whole degrees as it shows them.
  const NEB: readonly (readonly [string, number])[] = [
    ['ATGACCATGATTACGCCAAGC', 65],
    ['GTAAAACGACGGCCAGT', 62],
    ['AGCGGATAACAATTTCACACAGGA', 66],
    ['CAGGAAACAGCTATGAC', 56],
    ['TTATATAATTATAAATTTAAAGC', 46],
    ['GCGGCCGCGGATCCGCGGCC', 86],
    ['GCGGCCGCGGATCCGCGGCCGCAGC', 91],
    ['GGCCGCTGCGGCCGCGGATCCGCGG', 90],
    ['GATTACAGATTACAGATTACAGATTACA', 59],
    ['CTGGTGCCGCGCGGCAGCCATATG', 80],
    ['TCTAGAGTCGACCTGCAGGCATGCAAGCTTGG', 78],
  ];

  it.each(NEB)('gives %s the Tm NEB gives it', (primer, tm) => {
    expect(Math.round(q5MeltingTemperature(primer))).toBe(tm);
  });

  it('reads above the nearest-neighbour Tm at 50 mM, as NEB warns', () => {
    for (const [primer] of NEB)
      expect(q5MeltingTemperature(primer)).toBeGreaterThan(meltingTemperature(primer));
  });

  it('takes lower case and U, and refuses what it cannot pair', () => {
    expect(q5MeltingTemperature('atgaccatgauuacgccaagc')).toBeCloseTo(
      q5MeltingTemperature('ATGACCATGATTACGCCAAGC'),
    );
    expect(q5MeltingTemperature('ACGTN')).toBeNaN();
    expect(q5MeltingTemperature('A')).toBeNaN();
  });
});

describe('q5AnnealingTemperature (#69)', () => {
  it('is a degree over the lower Tm, and no more than 72 °C', () => {
    // The pairs NEB's calculator was given, and what it said.
    expect(q5AnnealingTemperature(65, 62)).toBe(63);
    expect(q5AnnealingTemperature(66, 65)).toBe(66);
    expect(q5AnnealingTemperature(66, 46)).toBe(47);
    expect(q5AnnealingTemperature(59, 80)).toBe(60);
    expect(q5AnnealingTemperature(78, 80)).toBe(72);
    expect(q5AnnealingTemperature(91, 90)).toBe(72);
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
