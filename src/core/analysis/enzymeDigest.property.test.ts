import fc from 'fast-check';

import { type Topology } from '../range';
import { enzymeDigest, fragmentLengths } from './enzymeDigest';
import { hostMarksBits, hostMethylationAt } from './methylation';
import {
  type CutSite,
  activeEnzymes,
  digestFragments,
  findCutSites,
  getEnzyme,
} from './restriction';

// #275: `enzymeDigest` skips `hostMethylationAt` for enzymes Dam and Dcm
// cannot touch and takes its lengths from `fragmentLengths`. The oracle is
// the digest as item 98 wrote it, per site and through `digestFragments`.

function digestAsBefore(sites: readonly CutSite[], sequence: string, topology: Topology) {
  const host = new Uint8Array(sites.length);
  const cuts = new Map<string, number[]>();
  sites.forEach((site, i) => {
    const enzyme = getEnzyme(site.enzyme);
    if (enzyme === undefined) return;
    host[i] = hostMarksBits(hostMethylationAt(sequence, topology, site, enzyme.site.length));
    const list = cuts.get(site.enzyme);
    if (list === undefined) cuts.set(site.enzyme, [site.cut]);
    else list.push(site.cut);
  });
  const lengths = new Map<string, readonly number[]>();
  const counts = new Map<string, number>();
  for (const [name, list] of cuts) {
    lengths.set(
      name,
      digestFragments(list, sequence.length, topology)
        .map((f) => f.length)
        .sort((a, b) => b - a),
    );
    counts.set(name, list.length);
  }
  return { host, lengths, counts };
}

const topologyArb = fc.constantFrom<Topology>('linear', 'circular');

describe('fragmentLengths (#275)', () => {
  it("is digestFragments' lengths, longest first", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 60 }),
        fc.array(fc.integer({ min: -5, max: 65 }), { maxLength: 20 }),
        topologyArb,
        (length, cuts, topology) => {
          expect(fragmentLengths(cuts, length, topology)).toEqual(
            digestFragments(cuts, length, topology)
              .map((f) => f.length)
              .sort((a, b) => b - a),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe('enzymeDigest against the digest of item 98 (#275)', () => {
  // Dam's GATC and Dcm's CCWGG planted among random bases, so the
  // sensitive enzymes' sites meet the methylases now and then.
  const sequenceArb = fc
    .array(
      fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom('A', 'C', 'G', 'T') },
        { weight: 1, arbitrary: fc.constantFrom('GATC', 'CCAGG', 'CCTGG', 'TGATCA', 'N') },
      ),
      { maxLength: 400 },
    )
    .map((parts) => parts.join(''));

  it('gives the same marks, lengths and counts with the bundled enzymes', () => {
    const enzymes = activeEnzymes();
    fc.assert(
      fc.property(sequenceArb, topologyArb, (sequence, topology) => {
        const sites = findCutSites(sequence, topology, enzymes);
        expect(enzymeDigest(sites, sequence, topology)).toEqual(
          digestAsBefore(sites, sequence, topology),
        );
      }),
      { numRuns: 150 },
    );
  }, 60_000);

  it('skips a site of an enzyme no table knows, as before', () => {
    const sites: CutSite[] = [
      { enzyme: 'NoSuchI', cut: 3, cutBottom: 3, siteStart: 1, strand: 'forward' },
      { enzyme: 'MboI', cut: 4, cutBottom: 8, siteStart: 4, strand: 'forward' },
    ];
    const digest = enzymeDigest(sites, 'AAAAGATCAAAA', 'linear');
    expect(digest).toEqual(digestAsBefore(sites, 'AAAAGATCAAAA', 'linear'));
    expect([...digest.counts.keys()]).toEqual(['MboI']);
  });
});
