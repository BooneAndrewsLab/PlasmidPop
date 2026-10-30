import {
  longestHairpinStem,
  maxSelfComplementarity,
  threePrimeComplementarity,
} from '@/core/primers/thermo';
import { DEFAULT_PRIMER_CRITERIA as C } from '@/core/primers/criteria';

import oracle from './hairpinDimer.json';

/**
 * Hairpin and dimer checks against primer3-py (scripts/oracle/hairpindimer.py,
 * item 121, issue #336). Our checks are length heuristics at the designer's
 * defaults; Primer3's calc_hairpin, calc_homodimer and calc_heterodimer are
 * thermodynamic. A primer or pair is "flagged" by us when it breaks a
 * default criterion and by Primer3 when its dG is at or below a cutoff. The
 * gate is loose: the share of primers flagged the same way must stay above a
 * floor set just under what was measured. Where the two disagree the
 * deviation is recorded with its issue and capped at the measured count, so
 * it cannot grow unnoticed. Nothing here says which of the two is right.
 */

interface Row {
  readonly seq: string;
  readonly hairpin: { readonly dg: number; readonly tm: number };
  readonly homodimer: { readonly dg: number; readonly tm: number };
}
interface Pair {
  readonly a: string;
  readonly b: string;
  readonly dg: number;
}

const rows = oracle.rows as readonly Row[];
const pairs = oracle.pairs as readonly Pair[];

/** kcal/mol: Primer3 flags a hairpin at or below this. */
const HAIRPIN_DG = -2;
/** kcal/mol: Primer3 flags a self- or primer-dimer at or below this. */
const DIMER_DG = -6;

interface Case {
  readonly ours: boolean;
  readonly primer3: boolean;
}

function matrix(cases: readonly Case[]) {
  let both = 0;
  let oursOnly = 0;
  let primer3Only = 0;
  let neither = 0;
  for (const c of cases) {
    if (c.ours && c.primer3) both++;
    else if (c.ours) oursOnly++;
    else if (c.primer3) primer3Only++;
    else neither++;
  }
  return { both, oursOnly, primer3Only, neither, agreement: (both + neither) / cases.length };
}

const hairpin = rows.map((r) => ({
  ours: longestHairpinStem(r.seq) > C.maxHairpin,
  primer3: r.hairpin.dg <= HAIRPIN_DG,
}));
const homodimer = rows.map((r) => ({
  ours:
    maxSelfComplementarity(r.seq) > C.maxSelfComplementarity ||
    threePrimeComplementarity(r.seq, r.seq) > C.maxThreePrime,
  primer3: r.homodimer.dg <= DIMER_DG,
}));
const heterodimer = pairs.map((p) => ({
  ours:
    Math.max(threePrimeComplementarity(p.a, p.b), threePrimeComplementarity(p.b, p.a)) >
    C.maxThreePrime,
  primer3: p.dg <= DIMER_DG,
}));

describe('hairpin and dimer checks against primer3-py', () => {
  it('has the dataset the floors were measured on', () => {
    expect(rows).toHaveLength(300);
    expect(pairs).toHaveLength(199);
  });

  it('hairpin: flagged the same way as Primer3 (dG <= -2 kcal/mol)', () => {
    const m = matrix(hairpin);
    expect(m.agreement).toBeGreaterThanOrEqual(0.8); // measured 82.0 %
    // Known deviations: #339 (ours only), #340 (Primer3 only).
    expect(m.oursOnly).toBeLessThanOrEqual(35);
    expect(m.primer3Only).toBeLessThanOrEqual(19);
  });

  it('self-dimer: flagged the same way as Primer3 (dG <= -6 kcal/mol)', () => {
    const m = matrix(homodimer);
    expect(m.agreement).toBeGreaterThanOrEqual(0.78); // measured 79.7 %
    // Known deviations: #341 (ours only), #342 (Primer3 only).
    expect(m.oursOnly).toBeLessThanOrEqual(27);
    expect(m.primer3Only).toBeLessThanOrEqual(34);
  });

  it('primer pair: flagged the same way as Primer3 (dG <= -6 kcal/mol)', () => {
    const m = matrix(heterodimer);
    expect(m.agreement).toBeGreaterThanOrEqual(0.68); // measured 70.9 %
    // Known deviations: #343 (ours only), #344 (Primer3 only).
    expect(m.oursOnly).toBeLessThanOrEqual(35);
    expect(m.primer3Only).toBeLessThanOrEqual(23);
  });
});
