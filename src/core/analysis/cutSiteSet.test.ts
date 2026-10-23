import { PackedCutSiteSet, cutSiteSetOf, toCutSiteSet } from './cutSiteSet';
import { type CutSite } from './restriction';

// #281: a scan's sites read by enzyme, kept as objects or packed. The
// property test in `src/workers/packedSites.property.test.ts` checks both
// against `findCutSites`; these pin what the interface promises beyond the
// contents: an enzyme's sites are made once and kept, and a site past either
// end of an enzyme's list is undefined.

function site(enzyme: string, cut: number, strand: CutSite['strand'] = 'forward'): CutSite {
  return { enzyme, cut, cutBottom: cut + 4, siteStart: cut - 1, strand };
}

/** In the scan's order: by cut, ties by name. */
const SITES: readonly CutSite[] = [
  site('BsaI', 3, 'reverse'),
  site('EcoRI', 10),
  site('BsaI', 20),
  site('EcoRI', 30),
  site('NotI', 40),
  site('EcoRI', 50, 'reverse'),
];

/** `sites` as the worker packs them: four integers a site, names by first appearance. */
function packed(sites: readonly CutSite[], host?: ArrayLike<number>): PackedCutSiteSet {
  const enzymes: string[] = [];
  const data = new Int32Array(sites.length * 4);
  sites.forEach((s, i) => {
    let e = enzymes.indexOf(s.enzyme);
    if (e < 0) e = enzymes.push(s.enzyme) - 1;
    data.set([(e << 1) | (s.strand === 'reverse' ? 1 : 0), s.cut, s.cutBottom, s.siteStart], i * 4);
  });
  return new PackedCutSiteSet(data, enzymes, host);
}

describe('cutSiteSetOf', () => {
  it('counts, groups and picks the sites in the scan order', () => {
    const set = cutSiteSetOf(SITES);
    expect(set.size).toBe(6);
    expect(set.count('EcoRI')).toBe(3);
    expect(set.count('SmaI')).toBe(0);
    expect([...set.counts()]).toEqual([
      ['BsaI', 2],
      ['EcoRI', 3],
      ['NotI', 1],
    ]);
    expect(set.of('BsaI').map((s) => s.cut)).toEqual([3, 20]);
    expect(set.pick(new Set(['NotI', 'BsaI'])).map((s) => s.cut)).toEqual([3, 20, 40]);
    expect(set.pick(new Set())).toEqual([]);
    expect(set.all()).toBe(SITES);
  });

  it("keeps an enzyme's list from the first call on", () => {
    const set = cutSiteSetOf(SITES);
    expect(set.of('EcoRI')).toBe(set.of('EcoRI'));
    expect(set.of('SmaI')).toEqual([]);
  });

  it('takes a set as it is and an array as a new set', () => {
    const set = cutSiteSetOf(SITES);
    expect(toCutSiteSet(set)).toBe(set);
    expect(toCutSiteSet(SITES).all()).toBe(SITES);
  });
});

describe('PackedCutSiteSet', () => {
  it('reads as the sites it was packed from', () => {
    const set = packed(SITES);
    expect(set.size).toBe(6);
    expect(set.all()).toEqual(SITES);
    expect(set.of('EcoRI')).toEqual(SITES.filter((s) => s.enzyme === 'EcoRI'));
    expect(set.count('SmaI')).toBe(0);
    expect(set.of('SmaI')).toEqual([]);
    expect(set.pick(new Set(['EcoRI', 'SmaI']))).toEqual(set.of('EcoRI'));
  });

  it("gives each enzyme's view its cuts and host marks in order", () => {
    const set = packed(SITES, [1, 0, 2, 0, 3, 1]);
    const eco = set.groups().get('EcoRI');
    expect(eco?.count).toBe(3);
    expect([...(eco?.cuts ?? [])]).toEqual([10, 30, 50]);
    expect([...(eco?.host ?? [])]).toEqual([0, 0, 1]);
    expect([...set.groups().keys()]).toEqual(['BsaI', 'EcoRI', 'NotI']);
  });

  it('makes a site once, the object the full list later holds', () => {
    const set = packed(SITES);
    const eco = set.groups().get('EcoRI');
    const second = eco?.site(1);
    expect(second).toEqual(SITES[3]);
    expect(eco?.site(1)).toBe(second);
    expect(set.of('EcoRI')[1]).toBe(second);
    expect(eco?.sites()).toBe(set.of('EcoRI'));
    expect(eco?.site(1)).toBe(second);
    expect(set.all()[3]).toBe(second);
  });

  it("has no site before an enzyme's first or past its last, made or not", () => {
    const set = packed(SITES);
    // EcoRI sits between BsaI and NotI in the grouped order, so a site read
    // one past either end would be a neighbour's.
    const eco = set.groups().get('EcoRI');
    expect(eco?.site(-1)).toBeUndefined();
    expect(eco?.site(3)).toBeUndefined();
    expect(set.groups().get('BsaI')?.site(-1)).toBeUndefined();
    expect(set.groups().get('NotI')?.site(1)).toBeUndefined();
    set.of('EcoRI');
    expect(eco?.site(-1)).toBeUndefined();
    expect(eco?.site(3)).toBeUndefined();
  });
});
