import { describe, expect, it } from 'vitest';

import { DEFAULT_PRIMER_CRITERIA, normalizePrimerCriteria } from './criteria';

describe('normalizePrimerCriteria keeps the fractional free-energy and Tm limits', () => {
  it('does not round the hairpin, dimer and 3′ ΔG limits or the hairpin Tm', () => {
    const c = normalizePrimerCriteria({
      hairpinDg: -2.4,
      hairpinTm: 47.5,
      dimerDg: -6.6,
      threePrimeDg: -4.4,
    });
    expect(c.hairpinDg).toBe(-2.4);
    expect(c.hairpinTm).toBe(47.5);
    expect(c.dimerDg).toBe(-6.6);
    expect(c.threePrimeDg).toBe(-4.4);
  });

  it('reads the hairpin Tm from its own field, and holds it to 0..150', () => {
    expect(normalizePrimerCriteria({ hairpinTm: 52 }).hairpinTm).toBe(52);
    expect(normalizePrimerCriteria({ hairpinTm: 400 }).hairpinTm).toBe(150);
    expect(normalizePrimerCriteria({ hairpinTm: -3 }).hairpinTm).toBe(0);
    expect(normalizePrimerCriteria({}).hairpinTm).toBe(DEFAULT_PRIMER_CRITERIA.hairpinTm);
  });
});
