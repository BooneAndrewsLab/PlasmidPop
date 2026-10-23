import fc from 'fast-check';

import {
  type CutSite,
  type CutSiteSet,
  type EnzymeSites,
  type HostMethylationState,
  type Topology,
  activeEnzymes,
  cutSiteSetOf,
  cuttableSites,
  enzymeDigest,
  findCutSites,
  getEnzyme,
  hostStateBits,
  sitesByEnzyme,
} from '@/core';

import { handleAnalysisRequest } from './analysis.worker';
import { AnalysisClient } from './analysisClient';
import { packCutSites, unpackScan } from './analysisProtocol';

// #281: the main thread keeps the worker's scan packed and makes an
// enzyme's site objects when asked. Whatever is asked, and in whatever
// order, it must read as `findCutSites` and the digest of item 98 do.

const names = activeEnzymes().map((e) => e.name);

/** Random bases with Dam's GATC, Dcm's CCWGG and a few enzymes' sites planted. */
const sequenceArb = fc
  .tuple(
    fc.array(
      fc.oneof(
        { weight: 6, arbitrary: fc.constantFrom('A', 'C', 'G', 'T') },
        {
          weight: 1,
          arbitrary: fc.constantFrom(
            'GATC',
            'CCAGG',
            'CCTGG',
            'TGATCA',
            'GAATTC',
            'GGTCTC',
            'GCGGCCGC',
            'ATCGAT',
            'N',
          ),
        },
      ),
      { maxLength: 300 },
    ),
    fc.nat(),
  )
  // Turned by a random amount, so a planted site often straddles the origin.
  .map(([parts, turn]) => {
    const s = parts.join('');
    const at = s.length === 0 ? 0 : turn % s.length;
    return s.slice(at) + s.slice(0, at);
  });
const topologyArb = fc.constantFrom<Topology>('linear', 'circular');
/** All the bundled enzymes, or a few of them, as a request may ask. */
const enzymesArb = fc.option(fc.uniqueArray(fc.constantFrom(...names), { maxLength: 12 }), {
  nil: undefined,
});
const hostArb = fc.record<HostMethylationState>({ dam: fc.boolean(), dcm: fc.boolean() });

/** The worker's answer, unpacked as the client does it. */
async function scanOf(sequence: string, topology: Topology, enzymes?: readonly string[]) {
  const res = handleAnalysisRequest({
    id: 1,
    kind: 'cutSites',
    sequence,
    topology,
    digest: true,
    ...(enzymes === undefined ? {} : { enzymes }),
  });
  if (res.kind !== 'cutSites' || res.digest === undefined) throw new Error('no scan');
  return unpackScan(res.sites, res.digest);
}

function plainGroup(g: EnzymeSites | undefined) {
  if (g === undefined) return undefined;
  return {
    count: g.count,
    cuts: Array.from(g.cuts),
    host: Array.from(g.host),
    sites: g.sites(),
  };
}

/** What a set reads as, asked in the order `order` picks. */
function readSet(set: CutSiteSet, ticked: ReadonlySet<string>, order: number) {
  const ops: (() => readonly [string, unknown])[] = [
    () => ['pick', set.pick(ticked)],
    () => ['of', [...ticked].map((n) => set.of(n))],
    () => ['count', [...ticked].map((n) => set.count(n))],
    () => ['counts', set.counts()],
    () => ['all', set.all()],
  ];
  const turned = [...ops.slice(order % ops.length), ...ops.slice(0, order % ops.length)];
  return new Map<string, unknown>(turned.map((op) => op()));
}

describe('the packed sites against findCutSites (#281)', () => {
  it('reads the same per enzyme, picked, counted and whole, in any order of asking', async () => {
    await fc.assert(
      fc.asyncProperty(
        sequenceArb,
        topologyArb,
        enzymesArb,
        fc.uniqueArray(fc.constantFrom(...names, 'NoSuchI'), { maxLength: 6 }),
        fc.nat({ max: 4 }),
        fc.array(fc.tuple(fc.constantFrom(...names), fc.nat({ max: 8 })), { maxLength: 6 }),
        async (sequence, topology, enzymes, tickedList, order, early) => {
          const wanted = enzymes === undefined ? undefined : new Set(enzymes);
          const scanned = activeEnzymes().filter((e) => wanted?.has(e.name) ?? true);
          const expected = findCutSites(sequence, topology, scanned);
          const { sites, digest } = await scanOf(sequence, topology, enzymes);
          // A row on screen asks for an odd site before anything wants them all.
          for (const [name, i] of early) {
            expect(digest.byEnzyme?.get(name)?.site(i)).toEqual(
              expected.filter((s) => s.enzyme === name)[i],
            );
          }
          const ticked = new Set(tickedList);
          const read = readSet(sites, ticked, order);
          expect(read.get('pick')).toEqual(expected.filter((s) => ticked.has(s.enzyme)));
          expect(read.get('of')).toEqual(
            [...ticked].map((n) => expected.filter((s) => s.enzyme === n)),
          );
          expect(read.get('count')).toEqual(
            [...ticked].map((n) => expected.filter((s) => s.enzyme === n).length),
          );
          expect(read.get('all')).toEqual(expected);
          expect(sites.size).toBe(expected.length);
          // The same reading as the set over objects a carried result is.
          const array = cutSiteSetOf(expected);
          expect(read.get('counts')).toEqual(array.counts());
          expect(read).toEqual(readSet(array, ticked, order));
          // The objects are made once: whichever way they are asked for, one site is one object.
          const all = sites.all();
          for (const s of sites.pick(ticked)) expect(all).toContain(s);
          for (const n of ticked) {
            const own = sites.of(n);
            expect(sites.of(n)).toBe(own);
            expect(digest.byEnzyme?.get(n)?.sites()).toBe(own.length === 0 ? undefined : own);
          }
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  it("groups as sitesByEnzyme groups findCutSites' sites with the digest's marks", async () => {
    await fc.assert(
      fc.asyncProperty(
        sequenceArb,
        topologyArb,
        enzymesArb,
        async (sequence, topology, enzymes) => {
          const wanted = enzymes === undefined ? undefined : new Set(enzymes);
          const scanned = activeEnzymes().filter((e) => wanted?.has(e.name) ?? true);
          const expected = findCutSites(sequence, topology, scanned);
          const inline = enzymeDigest(expected, sequence, topology);
          const { digest } = await scanOf(sequence, topology, enzymes);
          const groups = digest.byEnzyme ?? new Map<string, EnzymeSites>();
          const oracle = sitesByEnzyme(expected, inline.host);
          expect([...groups.keys()].sort()).toEqual([...oracle.keys()].sort());
          for (const [name, g] of oracle)
            expect(plainGroup(groups.get(name))).toEqual(plainGroup(g));
          expect(Array.from(digest.host)).toEqual(Array.from(inline.host));
        },
      ),
      { numRuns: 150 },
    );
  }, 60_000);

  it("leaves out the cuts a host's methylation blocks, as cuttableSites does", async () => {
    await fc.assert(
      fc.asyncProperty(sequenceArb, topologyArb, hostArb, async (sequence, topology, host) => {
        const { sites, digest } = await scanOf(sequence, topology);
        const mask = hostStateBits(host);
        for (const [name, g] of digest.byEnzyme ?? []) {
          // The Enzymes tab's open cuts, read off the packed cuts and marks.
          const open: number[] = [];
          for (let i = 0; i < g.count; i++)
            if (((g.host[i] ?? 0) & mask) === 0) open.push(g.cuts[i] ?? 0);
          const tube = cuttableSites(
            sequence,
            topology,
            host,
            sites.of(name),
            (n) => getEnzyme(n)?.site.length ?? 0,
          );
          expect(open).toEqual(tube.map((s) => s.cut));
        }
      }),
      { numRuns: 100 },
    );
  }, 60_000);

  it('reads a site across the origin and a blocked one as findCutSites marks them', async () => {
    // EcoRI's GAATTC split by the origin, and a ClaI site (ATCGAT) inside Dam's GATC.
    const sequence = `ATTC${'A'.repeat(12)}TCGATC${'A'.repeat(12)}GA`;
    const expected = findCutSites(sequence, 'circular');
    const { sites, digest } = await scanOf(sequence, 'circular');
    const ecoRI = sites.of('EcoRI');
    expect(ecoRI).toEqual(expected.filter((s) => s.enzyme === 'EcoRI'));
    expect(ecoRI[0]?.siteStart).toBe(sequence.length - 2);
    const claI = digest.byEnzyme?.get('ClaI');
    expect(claI?.count).toBe(1);
    expect(claI?.host[0]).not.toBe(0);
    expect(sites.all()).toEqual(expected);
  });

  it('gives no lengths and no count to an enzyme the digest has none for', async () => {
    // A site of a name no enzyme table knows: the digest skips it (item 98),
    // so its entries in the packed digest are empty and zero.
    const sites = [
      { enzyme: 'EcoRI', cut: 5, cutBottom: 9, siteStart: 4, strand: 'forward' as const },
      { enzyme: 'Mystery', cut: 12, cutBottom: 12, siteStart: 10, strand: 'forward' as const },
    ];
    const { digest } = await unpackScan(packCutSites(sites), {
      host: new Uint8Array(2),
      lengths: Int32Array.from([30, 10]),
      offsets: Int32Array.from([0, 2, 2]),
      counts: Int32Array.from([1, 0]),
    });
    expect([...digest.lengths]).toEqual([['EcoRI', Int32Array.from([30, 10])]]);
    expect([...digest.counts]).toEqual([['EcoRI', 1]]);
    expect(digest.byEnzyme?.get('Mystery')?.count).toBe(1);
  });

  it('is what the client gives where there is no worker', async () => {
    const sequence = `${'GAATTC'.repeat(3)}ACGTGGATCCTTGATCAA`;
    const client = new AnalysisClient(null);
    for (const topology of ['linear', 'circular'] as const) {
      const { sites, digest } = await client.cutSitesWithDigest(sequence, topology);
      const expected = findCutSites(sequence, topology);
      expect(sites.all()).toEqual(expected);
      expect(sites.pick(new Set(['EcoRI', 'BamHI']))).toEqual(
        expected.filter((s: CutSite) => s.enzyme === 'EcoRI' || s.enzyme === 'BamHI'),
      );
      expect(digest.byEnzyme?.get('EcoRI')?.count).toBe(3);
    }
  });
});
