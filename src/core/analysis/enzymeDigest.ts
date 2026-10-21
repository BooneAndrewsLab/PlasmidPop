import { type Topology } from '../range';
import { hostMarksBits, hostMethylationAt } from './methylation';
import { type CutSite, digestFragments, getEnzyme } from './restriction';

/**
 * What the Enzymes tab needs of a scan beyond the sites themselves, taken
 * once per scan where the scan is (item 98, #271): in the analysis worker
 * for a document the worker scanned, inline for a carried result. Over a
 * 1 Mb sequence these were 120 ms of the 300 ms the list took to draw on
 * the main thread (docs/perf-notes.md).
 */
export interface EnzymeDigest {
  /**
   * Per site of the scan, in its order: the Dam and Dcm methylation inside
   * the site as `hostMarksBits`, whatever host the DNA came from.
   */
  readonly host: Uint8Array;
  /**
   * Per enzyme that cuts, by name: the lengths its own digest gives,
   * longest first, which is the order `gelProfile` wants them in.
   */
  readonly lengths: ReadonlyMap<string, readonly number[]>;
  /** Per enzyme that cuts, by name: how many of the sites are its. */
  readonly counts: ReadonlyMap<string, number>;
}

/**
 * The digest of `sites`, the result of `findCutSites` over `sequence`.
 * The same arithmetic the Enzymes tab used to do per render, so the marks
 * are `hostMethylationAt`'s and the lengths are `digestFragments`'.
 */
export function enzymeDigest(
  sites: readonly CutSite[],
  sequence: string,
  topology: Topology,
): EnzymeDigest {
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
