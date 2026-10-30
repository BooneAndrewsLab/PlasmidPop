import { dimerEnergy, hairpinEnergy, selfDimerEnergy } from '@/core/primers/structure';
import { threePrimeComplementarity } from '@/core/primers/thermo';
import { DEFAULT_PRIMER_CRITERIA as C } from '@/core/primers/criteria';

import oracle from './hairpinDimer.json';

/**
 * Hairpin and dimer checks against primer3-py (scripts/oracle/hairpindimer.py,
 * items 121 and 123, issues #336 and #339-#344). Our checks are the
 * nearest-neighbour ΔG of `structure.ts` at the designer's cutoffs
 * (`hairpinDg`, `dimerDg`); Primer3's calc_hairpin, calc_homodimer and
 * calc_heterodimer give the reference ΔG. A primer or pair is "flagged" by
 * both when its dG is at or below the cutoff. The gate is the share flagged
 * the same way, held just under what was measured, with the disagreements
 * capped at the measured counts so they cannot grow unnoticed. The loop
 * terms of `structure.ts` were fitted to data of this kind, so this set is
 * not independent of them: item 123 reports two held-out sets as well.
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
  ours: hairpinEnergy(r.seq) <= C.hairpinDg,
  primer3: r.hairpin.dg <= HAIRPIN_DG,
}));
const homodimer = rows.map((r) => ({
  ours: selfDimerEnergy(r.seq) <= C.dimerDg,
  primer3: r.homodimer.dg <= DIMER_DG,
}));
const heterodimer = pairs.map((p) => ({
  ours: dimerEnergy(p.a, p.b) <= C.dimerDg,
  primer3: p.dg <= DIMER_DG,
}));
// The designer also refuses a 3' match over `maxThreePrime`, by design a
// separate rule (item 123). With it, "ours" flags more than Primer3's dG does.
const homodimerWith3 = rows.map((r, i) => ({
  ours: (homodimer[i]?.ours ?? false) || threePrimeComplementarity(r.seq, r.seq) > C.maxThreePrime,
  primer3: r.homodimer.dg <= DIMER_DG,
}));
const heterodimerWith3 = pairs.map((p, i) => ({
  ours:
    (heterodimer[i]?.ours ?? false) ||
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
    expect(m.agreement).toBeGreaterThanOrEqual(0.94); // measured 94.7 %
    // Remaining disagreements: ours only, Primer3 only.
    expect(m.oursOnly).toBeLessThanOrEqual(4);
    expect(m.primer3Only).toBeLessThanOrEqual(12);
  });

  it('self-dimer: flagged the same way as Primer3 (dG <= -6 kcal/mol)', () => {
    const m = matrix(homodimer);
    expect(m.agreement).toBeGreaterThanOrEqual(0.95); // measured 95.7 %
    expect(m.oursOnly).toBeLessThanOrEqual(4);
    expect(m.primer3Only).toBeLessThanOrEqual(9);
  });

  it('primer pair: flagged the same way as Primer3 (dG <= -6 kcal/mol)', () => {
    const m = matrix(heterodimer);
    expect(m.agreement).toBeGreaterThanOrEqual(0.95); // measured 95.5 %
    expect(m.oursOnly).toBeLessThanOrEqual(6);
    expect(m.primer3Only).toBeLessThanOrEqual(3);
  });

  // The 3' rule is a separate check by design: a few bases at a 3' end are
  // extended whatever their dG, and Primer3's dG does not say so. What it
  // flags beyond the dG is "ours only" here, and is expected.
  it('self-dimer with the 3′ rule: the extra flags are the rule, not the dG', () => {
    const m = matrix(homodimerWith3);
    expect(m.agreement).toBeGreaterThanOrEqual(0.89); // measured 90.3 %
    expect(m.oursOnly).toBeLessThanOrEqual(23);
    expect(m.primer3Only).toBeLessThanOrEqual(6);
  });

  it('primer pair with the 3′ rule: the extra flags are the rule, not the dG', () => {
    const m = matrix(heterodimerWith3);
    expect(m.agreement).toBeGreaterThanOrEqual(0.78); // measured 79.4 %
    expect(m.oursOnly).toBeLessThanOrEqual(39);
    expect(m.primer3Only).toBeLessThanOrEqual(2);
  });
});
