import oracle from '../../test/oracle/hairpinDimer.json';
import tmOracle from '../../test/oracle/hairpinTm.json';
import {
  dimerEnergy,
  hairpinEnergy,
  hairpinTm,
  selfDimerEnergy,
  STRUCTURE_PARAMS,
  threePrimeDimer,
  threePrimeDuplexEnergy,
} from './structure';
import { threePrimeComplementarity } from './thermo';

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
    // Measured: mean 0.31, max 2.63 kcal/mol over 300 primers (item 125).
    expect(e.mean).toBeLessThan(0.33);
    expect(e.max).toBeLessThan(2.7);
  });
});

/**
 * Hairpin loops by hand (item 125). The stems are self-complementary G/C
 * runs closed by A loops, so the best fold is the whole stem and its ΔG is
 * a sum anyone can check: SantaLucia 1998 stacks at 37 °C from ΔH and ΔS
 * (5'GC3'/3'CG5' -9.8 and -24.4 e.u., 5'CG3'/3'GC5' -10.6 and -27.2,
 * 5'CA3'/3'GT5' -8.5 and -22.7: -2.231, -2.164 and -1.460), the 0.34 salt
 * term per stack, 0.2 hairpin initiation, and the loop from SantaLucia and Hicks 2004,
 * Table 4 (p. 427), Equations 7 to 9 (pp. 427-428).
 */
describe('hairpin loops (SantaLucia and Hicks 2004)', () => {
  /** ΔG at 37 °C of a stack from its ΔH, kcal/mol, and ΔS, cal/(mol K). */
  const stack = (dH: number, dS: number): number => dH - (310.15 * dS) / 1000;
  const GC = stack(-9.8, -24.4);
  const CG = stack(-10.6, -27.2);
  const CA = stack(-8.5, -22.7);
  /** GCGC, a loop of `n` A, GCGC: three stacks and their salt. */
  const stem = (n: number): string => `GCGC${'A'.repeat(n)}GCGC`;
  /** The stem, salt, initiation and (past a triloop) the terminal mismatch of G/C. */
  const STEM = 2 * GC + CG + 3 * 0.34 + 0.2;
  /** A longer stem (GCGCGCGC both sides) for the loops too dear for a short one. */
  const long = (n: number): string => `GCGCGCGC${'A'.repeat(n)}GCGCGCGC`;
  const LONG = 4 * GC + 3 * CG + 7 * 0.34 + 0.2;
  const MISMATCH = -0.8;
  /** 2.44 RT at 37 °C, Equation 7. */
  const GROWTH = 2.44 * 0.001987 * 310.15;

  it('a loop of three has no terminal mismatch and none of the 3.5 is lost', () => {
    expect(hairpinEnergy(stem(3))).toBeCloseTo(STEM + 3.5, 3); // about -1.91
  });

  it('a loop of four takes the terminal mismatch, a loop of three does not', () => {
    expect(hairpinEnergy(stem(4))).toBeCloseTo(STEM + 3.5 + MISMATCH, 3); // about -2.71
    expect(hairpinEnergy(stem(4))).toBeLessThan(hairpinEnergy(stem(3)) - 0.7);
  });

  it('uses every size of Table 4 up to ten', () => {
    // Size 5 is 3.3, below the 3.5 of sizes 3 and 4; the rest climb.
    const table: readonly [number, number][] = [
      [5, 3.3],
      [6, 4.0],
      [7, 4.2],
      [8, 4.3],
      [9, 4.5],
      [10, 4.6],
    ];
    for (const [n, g] of table) {
      expect(hairpinEnergy(stem(n))).toBeCloseTo(STEM + MISMATCH + g, 3);
    }
  });

  it('uses the tabulated sizes past ten: 12, 14, 16, 18, 20, 25, 30', () => {
    const table: readonly [number, number][] = [
      [12, 5.0],
      [14, 5.1],
      [16, 5.3],
      [18, 5.5],
      [20, 5.7],
      [25, 6.1],
      [30, 6.3],
    ];
    for (const [n, g] of table) {
      expect(hairpinEnergy(long(n))).toBeCloseTo(LONG + MISMATCH + g, 3);
    }
  });

  it('extrapolates a size between rows from the row below (Equation 7)', () => {
    expect(hairpinEnergy(long(11))).toBeCloseTo(
      LONG + MISMATCH + 4.6 + GROWTH * Math.log(11 / 10),
      3,
    );
    expect(hairpinEnergy(long(13))).toBeCloseTo(
      LONG + MISMATCH + 5.0 + GROWTH * Math.log(13 / 12),
      3,
    );
    expect(hairpinEnergy(long(19))).toBeCloseTo(
      LONG + MISMATCH + 5.5 + GROWTH * Math.log(19 / 18),
      3,
    );
    expect(hairpinEnergy(long(27))).toBeCloseTo(
      LONG + MISMATCH + 6.1 + GROWTH * Math.log(27 / 25),
      3,
    );
    // Past the last row it keeps growing from 30.
    expect(hairpinEnergy(long(33))).toBeCloseTo(
      LONG + MISMATCH + 6.3 + GROWTH * Math.log(33 / 30),
      3,
    );
  });

  // GCGCGC, an A·T pair, the loop, then the T and GCGCGC: five G/C stacks, one C·A/G·T stack.
  const atStem = (loop: string): string => `GCGCGCA${loop}TGCGCGC`;
  const STACKS = 3 * GC + 2 * CG + CA + 6 * 0.34 + 0.2;

  it('a triloop closed by A·T costs 0.5 more, as Equation 8 says', () => {
    // Every loop past four is made dear, so that the fold keeps the A·T pair.
    const dear = [...STRUCTURE_PARAMS.hairpinLoop.slice(0, 2), [5, 30]] as const;
    const base = { ...STRUCTURE_PARAMS, hairpinLoop: dear };
    expect(hairpinEnergy(atStem('AAA'), base)).toBeCloseTo(STACKS + 3.5 + 0.5, 3);
    const none = { ...base, triloopAtClose: 0 };
    expect(hairpinEnergy(atStem('AAA'), none)).toBeCloseTo(STACKS + 3.5, 3);
    const big = { ...base, triloopAtClose: 1.5 };
    expect(hairpinEnergy(atStem('AAA'), big)).toBeCloseTo(STACKS + 3.5 + 1.5, 3);
  });

  it('the A·T penalty is for a loop of three only: four takes the A·T terminal mismatch', () => {
    const big = { ...STRUCTURE_PARAMS, triloopAtClose: 1.5 };
    expect(hairpinEnergy(atStem('AAAA'))).toBeCloseTo(STACKS + 3.5 - 0.6, 3); // about -7.34
    expect(hairpinEnergy(atStem('AAAA'), big)).toBeCloseTo(hairpinEnergy(atStem('AAAA')), 6);
  });

  it('does not charge a triloop closed by G·C the A·T penalty', () => {
    const big = { ...STRUCTURE_PARAMS, triloopAtClose: 1.5 };
    expect(hairpinEnergy(stem(3), big)).toBeCloseTo(hairpinEnergy(stem(3)), 6);
  });

  it('has the hairpin loop columns of Table 4 and the 0.5 of Equation 8 in its parameters', () => {
    const sizes = STRUCTURE_PARAMS.hairpinLoop.map(([n]) => n);
    expect(sizes).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 25, 30]);
    expect(STRUCTURE_PARAMS.hairpinLoop.map(([, g]) => g)).toEqual([
      3.5, 3.5, 3.3, 4.0, 4.2, 4.3, 4.5, 4.6, 5.0, 5.1, 5.3, 5.5, 5.7, 6.1, 6.3,
    ]);
    expect(STRUCTURE_PARAMS.triloopAtClose).toBe(0.5);
  });

  it('a loop adds entropy and no enthalpy: the Tm is the stacks’ ΔH over ΔS (Equation 11)', () => {
    // ΔH is the stacks' alone (5'GC3' -9.8 twice, 5'CG3' -10.6): -30.2 kcal/mol,
    // and the loop's ΔS is -ΔG/T (Table 4, footnote a: its ΔH is zero).
    const h = 2 * -9.8 + -10.6;
    const g = STEM + 3.5;
    const tm = (h * 310.15) / (h - g) - 273.15 + STRUCTURE_PARAMS.hairpinTmOffset;
    expect(hairpinTm(stem(3))).toBeCloseTo(tm, 2);
  });
});

describe('hairpinTm (#345)', () => {
  const sample = tmOracle.rows as readonly { seq: string; dg: number; tm: number }[];
  /** Primer3's limit, PRIMER_MAX_HAIRPIN_TH. */
  const LIMIT = 47;

  it('is zero where there is no hairpin and never exceeds the cap', () => {
    expect(hairpinTm('AAAAAAAAAAAAAAAAAAAA')).toBe(0);
    expect(hairpinTm('ACGT')).toBe(0);
    expect(hairpinTm('GTGCAAGCGGCCGCCGCTACAAGCGGCCGCA')).toBeGreaterThan(70);
  });

  it('rises with the stability of the stem', () => {
    // Primer3: 84.7 C for the long G/C stem, 38 C for the weak A/T one.
    expect(hairpinTm('GTGCAAGCGGCCGCCGCTACAAGCGGCCGCA')).toBeGreaterThan(
      hairpinTm('TTTTAATTAGCTTAATT'),
    );
  });

  it('flags the designer-like primers Primer3 refuses (47 C) with the measured agreement', () => {
    // 800 primers inside the designer's Tm and GC limits (hairpinTm.json,
    // primer3-py 2.2.0). The enthalpy terms were fitted on the even rows
    // and the 300 of hairpinDimer.json, the offset on all 800, so this is
    // the fit's own sample, not an independent one. Measured: 135 flagged
    // by both, 94 by us only, 27 by Primer3 only, 542 by neither (item 125).
    let both = 0;
    let ours = 0;
    let theirs = 0;
    for (const r of sample) {
      const a = hairpinTm(r.seq) > LIMIT;
      const b = r.dg < 0 && r.tm > LIMIT;
      if (a && b) both++;
      else if (a) ours++;
      else if (b) theirs++;
    }
    // Recall: the share of what Primer3 refuses that we refuse too.
    expect(both / (both + theirs)).toBeGreaterThanOrEqual(0.82); // measured 83.5 %
    // The price of the offset: refusals Primer3 would not make.
    expect(ours / sample.length).toBeLessThanOrEqual(0.12); // measured 11.75 %
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
    // Measured: mean 0.70, max 4.31 kcal/mol over 300 primers.
    expect(self.mean).toBeLessThan(0.8);
    expect(self.max).toBeLessThan(5);
    const pair = errors(pairs.map((p) => [dimerEnergy(p.a, p.b), p.dg]));
    // Measured: mean 0.48, max 5.20 kcal/mol over 199 pairs.
    expect(pair.mean).toBeLessThan(0.6);
    expect(pair.max).toBeLessThan(5.5);
  });
});

describe('the 3′ duplex (#343)', () => {
  // The 3′ end of each `a` pairs with `b` over exactly five bases (checked
  // below), the weak one through C·G and G·C pairs only at the very end.
  const weakA = 'ATATCATATCGGCC';
  const weakB = 'TTATGGCCGTTAT';
  const strongA = 'ATATCATATGCGCG';
  const strongB = 'TTATCGCGCTTAT';

  it('is the ΔG of the matched bases alone, 0 where the 3′ end pairs nowhere', () => {
    expect(threePrimeComplementarity(weakA, weakB)).toBe(5);
    expect(threePrimeComplementarity(strongA, strongB)).toBe(5);
    expect(threePrimeDuplexEnergy(weakA, weakB)).toBeCloseTo(dimerEnergy('CGGCC', 'GGCCG'), 9);
    expect(threePrimeDuplexEnergy(weakA, weakB)).toBeCloseTo(-4.492, 3);
    expect(threePrimeDuplexEnergy(strongA, strongB)).toBeCloseTo(-5.233, 3);
    // Not the whole dimer: the rest of `a` and `b` may pair as well.
    expect(threePrimeDuplexEnergy(weakA, weakB)).toBeGreaterThan(dimerEnergy(weakA, weakB));
    expect(threePrimeDuplexEnergy('GGGGGGGG', 'GGGGGGGG')).toBe(0);
  });

  it('is weak for a run of A and T, strong for G and C, at the same length', () => {
    const at = threePrimeDuplexEnergy('GGGGCAAATT', 'TTTAATTTT');
    expect(threePrimeComplementarity('GGGGCAAATT', 'TTTAATTTT')).toBe(5);
    expect(at).toBeGreaterThan(-1.5);
    expect(at).toBeLessThan(0);
    expect(threePrimeDuplexEnergy(strongA, strongB)).toBeLessThan(-5);
  });

  it('flags a match at or below the ΔG cutoff and not above it', () => {
    const dg = threePrimeDuplexEnergy(strongA, strongB);
    expect(threePrimeDimer(strongA, strongB, 4, dg)).toBe(true);
    expect(threePrimeDimer(strongA, strongB, 4, dg - 0.001)).toBe(false);
    const weak = threePrimeDuplexEnergy(weakA, weakB);
    expect(threePrimeDimer(weakA, weakB, 4, weak)).toBe(true);
    expect(threePrimeDimer(weakA, weakB, 4, weak - 0.001)).toBe(false);
    // The default cutoff, -5, lets the weak one through and stops the strong one.
    expect(threePrimeDimer(weakA, weakB, 4, -5)).toBe(false);
    expect(threePrimeDimer(strongA, strongB, 4, -5)).toBe(true);
  });

  it('flags only a match longer than the length limit', () => {
    expect(threePrimeDimer(strongA, strongB, 4, 0)).toBe(true);
    expect(threePrimeDimer(strongA, strongB, 5, 0)).toBe(false);
    expect(threePrimeDimer(strongA, strongB, 6, 0)).toBe(false);
    expect(threePrimeDimer(strongA, strongB, 0, 0)).toBe(true);
    // No 3′ pairing at all is never a dimer, whatever the cutoff.
    expect(threePrimeDimer('GGGGGGGG', 'GGGGGGGG', 0, 0)).toBe(false);
  });

  it('looks at both primers’ 3′ ends, in either order', () => {
    // Only b's 3′ end pairs with a.
    const a = strongB;
    const b = strongA;
    expect(threePrimeComplementarity(a, b)).toBe(3);
    expect(threePrimeComplementarity(b, a)).toBe(5);
    expect(threePrimeDimer(a, b, 4, -5)).toBe(true);
    expect(threePrimeDimer(b, a, 4, -5)).toBe(true);
  });

  it('flags a self-dimer when one primer is passed twice', () => {
    expect(threePrimeDimer('ACGTACGTACGTTGCGCGC', 'ACGTACGTACGTTGCGCGC', 4, -5)).toBe(true);
    expect(threePrimeDimer('AAAAAAAAAAAAAAAAAAAA', 'AAAAAAAAAAAAAAAAAAAA', 4, -5)).toBe(false);
  });
});
