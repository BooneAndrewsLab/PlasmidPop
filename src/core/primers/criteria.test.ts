import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PRIMER_CRITERIA,
  PRIMER_SETTING_FIELDS,
  describePrimerChanges,
  normalizePrimerCriteria,
  primerSettingChanged,
  restorePrimerSetting,
} from './criteria';

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

describe('describePrimerChanges', () => {
  const d = DEFAULT_PRIMER_CRITERIA;
  it('is empty for the defaults', () => {
    expect(describePrimerChanges(d)).toEqual([]);
  });
  it('names a range with both ends when one end moved', () => {
    expect(describePrimerChanges({ ...d, maxTm: 62 })).toEqual(['Tm 55–62 °C']);
  });
  it('names a filter, with a real minus sign', () => {
    expect(describePrimerChanges({ ...d, dimerDg: -2.5 })).toEqual(['Dimer ΔG −2.5']);
  });
  it('lists several in the panel order', () => {
    expect(
      describePrimerChanges({ ...d, dimerDg: -2.5, minTm: 55, maxTm: 62, minLength: 20 }),
    ).toEqual(['Length 20–27 nt', 'Tm 55–62 °C', 'Dimer ΔG −2.5']);
  });
  it('shows GC as a percent', () => {
    expect(describePrimerChanges({ ...d, minGc: 0.4 })).toEqual(['GC 40–65 %']);
  });
  it('names the toggles and the regions', () => {
    expect(
      describePrimerChanges({
        ...d,
        requireGcClamp: true,
        requireSpecific: false,
        forwardRegion: { near: -30, far: 0 },
      }),
    ).toEqual(['Forward −30–0 bp', 'GC clamp required', 'Elsewhere allowed']);
  });
});

describe('restorePrimerSetting', () => {
  const find = (id: string) => {
    const f = PRIMER_SETTING_FIELDS.find((x) => x.id === id);
    if (f === undefined) throw new Error(id);
    return f;
  };
  it('restores both ends of a range and nothing else', () => {
    const c = { ...DEFAULT_PRIMER_CRITERIA, minTm: 58, maxTm: 62, dimerDg: -2.5 };
    const r = restorePrimerSetting(c, find('tm'));
    expect(r.minTm).toBe(55);
    expect(r.maxTm).toBe(65);
    expect(r.dimerDg).toBe(-2.5);
  });
  it('restores a single filter', () => {
    const c = { ...DEFAULT_PRIMER_CRITERIA, dimerDg: -2.5 };
    expect(primerSettingChanged(restorePrimerSetting(c, find('dimerDg')), find('dimerDg'))).toBe(
      false,
    );
  });
});
