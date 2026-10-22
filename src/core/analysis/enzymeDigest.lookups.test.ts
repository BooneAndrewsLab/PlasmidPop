import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enzymeDigest } from './enzymeDigest';
import type * as methylation from './methylation';
import { hostMethylationAt, isHostMethylationSensitive } from './methylation';
import type * as restriction from './restriction';
import { findCutSites, getEnzyme } from './restriction';

// #275: enzymeDigest looks each enzyme up once per name, and asks
// hostMethylationAt only about the sites of enzymes Dam or Dcm can block.
// The results are the same either way (enzymeDigest.property.test.ts), so
// these count the calls.

vi.mock('./restriction', async (importOriginal) => {
  const actual = await importOriginal<typeof restriction>();
  return { ...actual, getEnzyme: vi.fn(actual.getEnzyme) };
});
vi.mock('./methylation', async (importOriginal) => {
  const actual = await importOriginal<typeof methylation>();
  return {
    ...actual,
    hostMethylationAt: vi.fn(actual.hostMethylationAt),
    isHostMethylationSensitive: vi.fn(actual.isHostMethylationSensitive),
  };
});

/** Three EcoRI sites (no Dam or Dcm in the way of it) and three ClaI sites (Dam can block it). */
const sequence = `${'A'.repeat(10)}GAATTC${'A'.repeat(10)}ATCGAT${'A'.repeat(10)}GAATTC${'A'.repeat(10)}ATCGAT${'A'.repeat(10)}GAATTC${'A'.repeat(10)}ATCGAT${'A'.repeat(10)}`;

function sitesOf(...names: string[]) {
  const enzymes = names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(n);
    return e;
  });
  return findCutSites(sequence, 'linear', enzymes);
}

describe('enzymeDigest lookups (#275)', () => {
  beforeEach(() => {
    vi.mocked(getEnzyme).mockClear();
    vi.mocked(hostMethylationAt).mockClear();
    vi.mocked(isHostMethylationSensitive).mockClear();
  });

  it('looks each enzyme up once, however many sites it has', () => {
    const sites = sitesOf('EcoRI', 'ClaI');
    expect(sites).toHaveLength(6);
    vi.mocked(getEnzyme).mockClear();
    const { counts } = enzymeDigest(sites, sequence, 'linear');
    expect(counts.get('EcoRI')).toBe(3);
    expect(counts.get('ClaI')).toBe(3);
    // hostMethylationAt looks ClaI up again at each of its sites; EcoRI,
    // which it is not asked about, is looked up by enzymeDigest alone.
    const looked = vi.mocked(getEnzyme).mock.calls.map((c) => c[0]);
    expect(looked.filter((n) => n === 'EcoRI')).toHaveLength(1);
    expect(looked.filter((n) => n === 'ClaI')).toHaveLength(
      1 + vi.mocked(hostMethylationAt).mock.calls.length,
    );
    expect(
      vi
        .mocked(isHostMethylationSensitive)
        .mock.calls.map((c) => c[0])
        .sort(),
    ).toEqual(['ClaI', 'EcoRI']);
  });

  it('asks about host methylation only at the sites of enzymes it can block', () => {
    expect(isHostMethylationSensitive('ClaI')).toBe(true);
    expect(isHostMethylationSensitive('EcoRI')).toBe(false);
    const sites = sitesOf('EcoRI', 'ClaI');
    enzymeDigest(sites, sequence, 'linear');
    const asked = vi.mocked(hostMethylationAt).mock.calls.map((c) => c[2].enzyme);
    expect(asked).toEqual(['ClaI', 'ClaI', 'ClaI']);
  });
});
