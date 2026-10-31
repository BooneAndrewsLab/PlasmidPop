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
import { TETRALOOP_BONUS, TRILOOP_BONUS } from './hairpinLoops';
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
  /** The parameters without the supplement's tri- and tetraloop increments. */
  const PLAIN = { ...STRUCTURE_PARAMS, triloops: {}, tetraloops: {} };
  /** 2.44 RT at 37 °C, Equation 7. */
  const GROWTH = 2.44 * 0.001987 * 310.15;

  it('a loop of three has no terminal mismatch and none of the 3.5 is lost', () => {
    expect(hairpinEnergy(stem(3))).toBeCloseTo(STEM + 3.5, 3); // about -1.91
  });

  it('a loop of four takes the terminal mismatch, a loop of three does not', () => {
    // No special loops here (the bonuses are tested below): GCGC AAAA GCGC would be CAAAAG.
    expect(hairpinEnergy(stem(4), PLAIN)).toBeCloseTo(STEM + 3.5 + MISMATCH, 3); // about -2.71
    expect(hairpinEnergy(stem(4), PLAIN)).toBeLessThan(hairpinEnergy(stem(3), PLAIN) - 0.7);
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
    const plain = PLAIN;
    expect(hairpinEnergy(atStem('AAAA'), plain)).toBeCloseTo(STACKS + 3.5 - 0.6, 3); // about -7.34
    expect(hairpinEnergy(atStem('AAAA'), { ...big, ...plain })).toBeCloseTo(
      hairpinEnergy(atStem('AAAA'), plain),
      6,
    );
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

describe('special tri- and tetraloops (SantaLucia and Hicks 2004, Table S1, Equations 8 and 9)', () => {
  const stack = (dH: number, dS: number): number => dH - (310.15 * dS) / 1000;
  const GC = stack(-9.8, -24.4);
  const CG = stack(-10.6, -27.2);
  const CA = stack(-8.5, -22.7);
  const PLAIN = { ...STRUCTURE_PARAMS, triloops: {}, tetraloops: {} };
  /** GCGC, the loop, GCGC: three stacks, their salt, the initiation. */
  const stem = (loop: string): string => `GCGC${loop}GCGC`;
  const STEM = 2 * GC + CG + 3 * 0.34 + 0.2;
  /** GCGCGC, an A·T pair, the loop, the T and GCGCGC: the loop is closed by A·T. */
  const atStem = (loop: string): string => `GCGCGCA${loop}TGCGCGC`;
  const STACKS = 3 * GC + 2 * CG + CA + 6 * 0.34 + 0.2;
  /** Every loop past four dear, so the fold keeps a short loop's closing pair. */
  const DEAR = [...STRUCTURE_PARAMS.hairpinLoop.slice(0, 2), [5, 30]] as const;
  const MISMATCH = -0.8;
  const MISMATCH_AT = -0.6;

  it('has all 16 triloops and 115 tetraloops of the supplement, and their sums', () => {
    expect(Object.keys(TRILOOP_BONUS)).toHaveLength(16);
    expect(Object.keys(TETRALOOP_BONUS)).toHaveLength(115);
    const sum = (t: Record<string, readonly [number, number]>, k: 0 | 1): number =>
      Object.values(t).reduce((a, v) => a + v[k], 0);
    expect(sum(TRILOOP_BONUS, 0)).toBeCloseTo(-28.0, 6);
    expect(sum(TRILOOP_BONUS, 1)).toBeCloseTo(-28.0, 6);
    expect(sum(TETRALOOP_BONUS, 0)).toBeCloseTo(-79.9, 6);
    expect(sum(TETRALOOP_BONUS, 1)).toBeCloseTo(-53.5, 6);
  });

  it('keeps the values of the supplement for the entries checked by hand', () => {
    // First, middle and last rows of each list, and the ones with ΔG different from ΔH.
    expect(TRILOOP_BONUS['AGAAT']).toEqual([-1.5, -1.5]);
    expect(TRILOOP_BONUS['CGAAG']).toEqual([-2.0, -2.0]);
    expect(TRILOOP_BONUS['GGTAC']).toEqual([-2.0, -2.0]);
    expect(TRILOOP_BONUS['TGTAA']).toEqual([-1.5, -1.5]);
    expect(TETRALOOP_BONUS['AAAAAT']).toEqual([0.7, 0.5]);
    expect(TETRALOOP_BONUS['ACTTGT']).toEqual([-1.3, 0]);
    expect(TETRALOOP_BONUS['AGCAAT']).toEqual([-2.1, -1.6]);
    expect(TETRALOOP_BONUS['CAAAAG']).toEqual([0.9, 0.5]);
    expect(TETRALOOP_BONUS['CGCAAG']).toEqual([-1.6, -1.6]); // the paper's own example (p. 428)
    expect(TETRALOOP_BONUS['GAAAAC']).toEqual([1.5, 0.5]);
    expect(TETRALOOP_BONUS['GGGGGC']).toEqual([0.8, 0.5]);
    expect(TETRALOOP_BONUS['GTTTGT']).toEqual([-0.4, -0.4]);
    expect(TETRALOOP_BONUS['TGATAA']).toEqual([-2.1, -1.6]);
    expect(TETRALOOP_BONUS['TGTTCA']).toEqual([0.3, 0.8]);
    expect(TETRALOOP_BONUS['TTTTTG']).toEqual([-1, -0.5]);
  });

  it('every triloop is GNA closed by a Watson-Crick pair (the GNA rule)', () => {
    const wc: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' };
    for (const [key, [g, h]] of Object.entries(TRILOOP_BONUS)) {
      expect(key.slice(1, 4)).toMatch(/^G.A$/);
      expect(key[4]).toBe(wc[key[0] ?? '']);
      expect(g).toBe(h);
      // 1.5 when the pair is A·T/T·A, 2.0 when it is C·G or G·C
      expect(g).toBe(key.startsWith('A') || key.startsWith('T') ? -1.5 : -2.0);
    }
  });

  it('a GNA triloop closed by C·G takes its 2.0, a plain triloop of the same stem does not', () => {
    // GCGC GAA GCGC: the loop is CGAAG, -2.0. Equation 8: 3.5 + bonus, no terminal mismatch.
    expect(hairpinEnergy(stem('GAA'), PLAIN)).toBeCloseTo(STEM + 3.5, 3);
    expect(hairpinEnergy(stem('GAA'))).toBeCloseTo(STEM + 3.5 - 2.0, 3);
    // N is any base; the third base must be A: GNA only.
    for (const loop of ['GAA', 'GCA', 'GGA', 'GTA']) {
      expect(hairpinEnergy(stem(loop))).toBeCloseTo(STEM + 3.5 - 2.0, 3);
    }
    expect(hairpinEnergy(stem('GAT'))).toBeCloseTo(STEM + 3.5, 3);
    expect(hairpinEnergy(stem('AAA'))).toBeCloseTo(STEM + 3.5, 3);
  });

  it('a GNA triloop closed by A·T gets its 1.5 and still pays the 0.5 of the A·T closing', () => {
    const p = { ...STRUCTURE_PARAMS, hairpinLoop: DEAR };
    // AGAAT: Equation 8 is 3.5 - 1.5 + 0.5.
    expect(hairpinEnergy(atStem('GAA'), p)).toBeCloseTo(STACKS + 3.5 - 1.5 + 0.5, 3);
    expect(hairpinEnergy(atStem('GAA'), { ...p, triloops: {} })).toBeCloseTo(STACKS + 3.5 + 0.5, 3);
    expect(hairpinEnergy(atStem('GAA'), { ...p, triloopAtClose: 0 })).toBeCloseTo(
      STACKS + 3.5 - 1.5,
      3,
    );
    // the same loop with no G at 5' has no entry
    expect(hairpinEnergy(atStem('AAA'), p)).toBeCloseTo(STACKS + 3.5 + 0.5, 3);
  });

  it('a triloop takes no terminal mismatch whatever its bonus', () => {
    const odd = { ...STRUCTURE_PARAMS, hairpinMismatchGc: 5, hairpinMismatchAt: 5 };
    expect(hairpinEnergy(stem('GAA'), odd)).toBeCloseTo(hairpinEnergy(stem('GAA')), 6);
  });

  it('a tetraloop takes its bonus and the terminal mismatch (Equation 9)', () => {
    // GCGC AAAA GCGC is CAAAAG: +0.9, a tetraloop that is worse than none.
    expect(hairpinEnergy(stem('AAAA'), PLAIN)).toBeCloseTo(STEM + 3.5 + MISMATCH, 3);
    expect(hairpinEnergy(stem('AAAA'))).toBeCloseTo(STEM + 3.5 + MISMATCH + 0.9, 3);
    // CGCAAG: -1.6, the paper's own example: 3.5 - 1.6 plus the mismatch.
    expect(hairpinEnergy(stem('GCAA'))).toBeCloseTo(STEM + 3.5 - 1.6 + MISMATCH, 3);
    expect(hairpinEnergy(stem('GCAA'), PLAIN)).toBeCloseTo(STEM + 3.5 + MISMATCH, 3);
    // GNRA, a GNRA tetraloop closed by C·G: GGAA ... CGGAAG -1.1
    expect(hairpinEnergy(stem('GGAA'))).toBeCloseTo(STEM + 3.5 - 1.1 + MISMATCH, 3);
  });

  it('a tetraloop closed by A·T has its bonus and the A·T terminal mismatch', () => {
    const p = { ...STRUCTURE_PARAMS, hairpinLoop: DEAR };
    // A AGCA... AGCAAT is -2.1: A, GCAA, T
    expect(hairpinEnergy(atStem('GCAA'), p)).toBeCloseTo(STACKS + 3.5 - 2.1 + MISMATCH_AT, 3);
    // AAAAAT is +0.7
    expect(hairpinEnergy(atStem('AAAA'), p)).toBeCloseTo(STACKS + 3.5 + 0.7 + MISMATCH_AT, 3);
    expect(hairpinEnergy(atStem('AAAA'), { ...p, tetraloops: {} })).toBeCloseTo(
      STACKS + 3.5 + MISMATCH_AT,
      3,
    );
  });

  it('applies the terminal mismatch of loops of four and five by the closing pair, C·G G·C A·T T·A', () => {
    // Each stem is closed by a different pair and the loop is five A (no bonus). Changing
    // the fitted mismatch for G/C changes the first two and not the last two, and vice versa.
    const closings = [
      ['C·G', 'GCGCAAAAAGCGC', true],
      ['G·C', 'CGCGAAAAACGCG', true],
      ['A·T', 'GCGCGCAAAAAATGCGCGC', false],
      ['T·A', 'GCGCGCTAAAAAAGCGCGC', false],
    ] as const;
    for (const [name, seq, gc] of closings) {
      const base = hairpinEnergy(seq);
      const moreGc = hairpinEnergy(seq, { ...STRUCTURE_PARAMS, hairpinMismatchGc: -0.8 + 1 });
      const moreAt = hairpinEnergy(seq, { ...STRUCTURE_PARAMS, hairpinMismatchAt: -0.6 + 1 });
      expect(moreGc - base, `${name} gc`).toBeCloseTo(gc ? 1 : 0, 6);
      expect(moreAt - base, `${name} at`).toBeCloseTo(gc ? 0 : 1, 6);
    }
  });

  it('the bonus is for the loop sizes: triloops at 3, tetraloops at 4, neither at 5', () => {
    // A made-up bonus on the loop of each stem: it shows only for the matching size.
    const p = {
      ...STRUCTURE_PARAMS,
      triloops: { CAAAG: [-5, -5], CAAAAG: [-6, -6], CAAAAAG: [-7, -7] } as const,
      tetraloops: { CAAAG: [-8, -8], CAAAAG: [-9, -9], CAAAAAG: [-10, -10] } as const,
    };
    const base = (s: string): number => hairpinEnergy(s, PLAIN);
    expect(hairpinEnergy(stem('AAA'), p) - base(stem('AAA'))).toBeCloseTo(-5, 3);
    expect(hairpinEnergy(stem('AAAA'), p) - base(stem('AAAA'))).toBeCloseTo(-9, 3);
    expect(hairpinEnergy(stem('AAAAA'), p)).toBeCloseTo(base(stem('AAAAA')), 6);
    expect(hairpinEnergy(stem('AAAAAA'), p)).toBeCloseTo(base(stem('AAAAAA')), 6);
  });

  it('adds the bonus enthalpy to the Tm: a triloop and a tetraloop (Equation 11)', () => {
    const offset = STRUCTURE_PARAMS.hairpinTmOffset;
    const hs = 2 * -9.8 + -10.6;
    const tm = (h: number, g: number): number => (h * 310.15) / (h - g) - 273.15 + offset;
    // CGAAG: ΔG and ΔH -2.0, no terminal mismatch, loop enthalpy 0.
    expect(hairpinTm(stem('GAA'))).toBeCloseTo(tm(hs - 2.0, STEM + 3.5 - 2.0), 2);
    // CAAAAG: ΔG +0.9, ΔH +0.5; the terminal mismatch has its own enthalpy.
    const hm = STRUCTURE_PARAMS.enthalpy.hairpinMismatch;
    expect(hairpinTm(stem('AAAA'))).toBeCloseTo(tm(hs + 0.5 + hm, STEM + 3.5 + 0.9 + MISMATCH), 2);
    // the bonus raises the Tm of the triloop above the plain one
    expect(hairpinTm(stem('GAA'))).toBeGreaterThan(hairpinTm(stem('GAA'), PLAIN) + 5);
  });

  it('finds a hairpin the plain loops miss: 3 bp of G/C closing a GNA triloop', () => {
    // Without the bonus the stem is too weak for the -2 kcal/mol the designer flags.
    expect(hairpinEnergy('ACGCGAAGCGTA', PLAIN)).toBeGreaterThan(-2);
    expect(hairpinEnergy('ACGCGAAGCGTA')).toBeLessThanOrEqual(-2);
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
    // the fit's own sample, not an independent one. With the supplement's
    // tri- and tetraloop increments: 157 flagged by both, 97 by us only,
    // 7 by Primer3 only, 539 by neither (item 125). Two held-out sets of 800
    // (not committed): recall 98.1 and 98.7 %, ours only 12.8 and 15.3 %.
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
    expect(both / (both + theirs)).toBeGreaterThanOrEqual(0.94); // measured 95.7 %
    // The price of the offset: refusals Primer3 would not make.
    expect(ours / sample.length).toBeLessThanOrEqual(0.125); // measured 12.1 %
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
