import { type Topology } from '../range';
import { hostMarksBits, hostMethylationAt, isHostMethylationSensitive } from './methylation';
import { type CutSite, getEnzyme } from './restriction';

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
 * are `hostMethylationAt`'s and the lengths are `digestFragments`' (as
 * `fragmentLengths` takes them).
 */
export function enzymeDigest(
  sites: readonly CutSite[],
  sequence: string,
  topology: Topology,
): EnzymeDigest {
  const host = new Uint8Array(sites.length);
  const cuts = new Map<string, number[]>();
  // Per name, once (#275): the site's length, or -1 for a name no table
  // knows, and whether Dam or Dcm can touch it at all. Most sites are of
  // enzymes neither can, which `hostMethylationAt` would only look up.
  const known = new Map<string, { readonly siteLength: number; readonly sensitive: boolean }>();
  sites.forEach((site, i) => {
    let entry = known.get(site.enzyme);
    if (entry === undefined) {
      const enzyme = getEnzyme(site.enzyme);
      entry = {
        siteLength: enzyme?.site.length ?? -1,
        sensitive: isHostMethylationSensitive(site.enzyme),
      };
      known.set(site.enzyme, entry);
    }
    if (entry.siteLength < 0) return;
    if (entry.sensitive) {
      host[i] = hostMarksBits(hostMethylationAt(sequence, topology, site, entry.siteLength));
    }
    const list = cuts.get(site.enzyme);
    if (list === undefined) cuts.set(site.enzyme, [site.cut]);
    else list.push(site.cut);
  });
  const lengths = new Map<string, readonly number[]>();
  const counts = new Map<string, number>();
  for (const [name, list] of cuts) {
    lengths.set(name, fragmentLengths(list, sequence.length, topology));
    counts.set(name, list.length);
  }
  return { host, lengths, counts };
}

/**
 * `digestFragments(cuts, seqLength, topology)`'s lengths, longest first,
 * without a fragment object per piece or a comparator per sort (#275): the
 * cuts and the lengths are sorted as typed arrays. A tested twin of
 * `digestFragments`, which stays what everything else cuts with.
 */
export function fragmentLengths(
  cuts: readonly number[],
  seqLength: number,
  topology: Topology,
): number[] {
  if (seqLength === 0) return [];
  const sorted = Float64Array.from(cuts).sort();
  const lengths: number[] = [];
  if (topology === 'linear') {
    let previous = 0;
    for (const c of sorted) {
      if (c <= previous || c >= seqLength) continue;
      lengths.push(c - previous);
      previous = c;
    }
    lengths.push(seqLength - previous);
  } else {
    // A cut at the end is a cut at the origin; outside 0..length, none.
    const points: number[] = [];
    let origin = false;
    for (const c of sorted) {
      if (c < 0 || c > seqLength) continue;
      if (c === 0 || c === seqLength) origin = true;
      else if (points.length === 0 || points[points.length - 1] !== c) points.push(c);
    }
    if (origin) points.unshift(0);
    if (points.length <= 1) return [seqLength];
    for (let i = 1; i < points.length; i++) lengths.push((points[i] ?? 0) - (points[i - 1] ?? 0));
    lengths.push((points[0] ?? 0) + seqLength - (points[points.length - 1] ?? 0));
  }
  return Array.from(Float64Array.from(lengths).sort().reverse());
}
