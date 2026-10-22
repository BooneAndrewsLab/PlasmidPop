import { enzymeDigest } from './enzymeDigest';
import { enzymeProfile, gelProfile } from './gel';
import { hostMarksBits, hostMethylationAt } from './methylation';
import { activeEnzymes, findCutSites, getEnzyme } from './restriction';

/** MscI's TGGCCA inside a Dcm CCWGG, a ClaI site behind a G (Dam), and a plain ClaI site. */
const sequence = `${'A'.repeat(20)}CCTGGCCA${'A'.repeat(20)}GATCGAT${'A'.repeat(20)}CATCGATA${'A'.repeat(20)}`;

function enzymes(...names: string[]) {
  return names.map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(n);
    return e;
  });
}

describe('enzymeDigest (item 98)', () => {
  it("marks every site with hostMethylationAt's marks, in the scan's order", () => {
    for (const topology of ['linear', 'circular'] as const) {
      const sites = findCutSites(sequence, topology, enzymes('MscI', 'ClaI', 'EcoRV'));
      const { host } = enzymeDigest(sites, sequence, topology);
      expect(host).toHaveLength(sites.length);
      sites.forEach((site, i) => {
        const e = getEnzyme(site.enzyme);
        if (e === undefined) throw new Error(site.enzyme);
        expect(host[i]).toBe(
          hostMarksBits(hostMethylationAt(sequence, topology, site, e.site.length)),
        );
      });
      // One Dcm mark on MscI, one Dam mark on the first ClaI site, nothing on the second.
      expect([...host].filter((b) => b !== 0)).toHaveLength(2);
    }
  });

  it('gives each cutting enzyme the lengths its own profile sorts, and nothing to one that does not cut', () => {
    const sites = findCutSites(sequence, 'circular', activeEnzymes());
    const { lengths, counts } = enzymeDigest(sites, sequence, 'circular');
    const cutting = new Set(sites.map((s) => s.enzyme));
    expect(cutting.size).toBeGreaterThan(2);
    expect(new Set(lengths.keys())).toEqual(cutting);
    expect(new Set(counts.keys())).toEqual(cutting);
    for (const name of cutting) {
      const own = sites.filter((s) => s.enzyme === name);
      expect(counts.get(name)).toBe(own.length);
      const fromDigest = lengths.get(name) ?? [];
      expect(gelProfile(fromDigest)).toEqual(enzymeProfile(own, sequence.length, 'circular'));
      expect(Array.from(fromDigest)).toEqual(Array.from(fromDigest).sort((a, b) => b - a));
    }
  });

  it('reads a cut across the origin of a circle as the wrap it is', () => {
    // GA…TC: the second GATC is the end of the circle read into its start.
    const circular = `TC${'A'.repeat(30)}GATC${'A'.repeat(30)}GA`;
    const sites = findCutSites(circular, 'circular', enzymes('MboI'));
    expect(sites.map((s) => s.siteStart).sort((a, b) => a - b)).toEqual([32, circular.length - 2]);
    const { lengths } = enzymeDigest(sites, circular, 'circular');
    expect(lengths.get('MboI')).toEqual(
      enzymeProfile(sites, circular.length, 'circular').fragments,
    );
  });
});
