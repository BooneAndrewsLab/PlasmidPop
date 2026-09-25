import {
  type Feature,
  type Qualifier,
  createFeature,
  featureExtent,
  rangeSegment,
} from '../features';
import { type Topology } from '../range';
import { type FeatureHit, overlapLength } from './detect';
import { type LibraryPart } from './library';

/**
 * Whether a document already has the feature a hit found: one on the same
 * strand of the same type or the same name, sharing at least 90% of the
 * bases of each — a CDS annotated without its stop codon still counts as
 * the one found with it.
 */
export function duplicatesExisting(
  hit: FeatureHit,
  part: Pick<LibraryPart, 'name' | 'type'>,
  existing: Iterable<Feature>,
  length: number,
  topology: Topology,
): boolean {
  const size = hit.range.end - hit.range.start;
  const name = part.name.toLowerCase();
  for (const f of existing) {
    if (f.strand !== hit.strand) continue;
    if (f.type !== part.type && f.name.toLowerCase() !== name) continue;
    const extent = featureExtent(f);
    if (extent === null) continue;
    const shared = overlapLength(extent, hit.range, length, topology);
    if (shared >= 0.9 * size && shared >= 0.9 * (extent.end - extent.start)) return true;
  }
  return false;
}

/** "100%" or "98.6%": one decimal only when it is not a whole number. */
export function formatIdentity(identity: number): string {
  const percent = Math.floor(identity * 1000) / 10;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

/** What a hit is, in words: "exact", "2 mismatches, 99.8%", "1 ambiguous base, 99.9%". */
export function describeMatch(hit: FeatureHit): string {
  if (hit.mismatches === 0 && hit.ambiguous === 0) return 'exact';
  const parts: string[] = [];
  if (hit.mismatches > 0) {
    parts.push(hit.mismatches === 1 ? '1 mismatch' : `${hit.mismatches} mismatches`);
  }
  if (hit.ambiguous > 0) {
    parts.push(hit.ambiguous === 1 ? '1 ambiguous base' : `${hit.ambiguous} ambiguous bases`);
  }
  return `${parts.join(', ')}, ${formatIdentity(hit.identity)}`;
}

/**
 * The feature a hit becomes: the part's type and name, a note of what it is
 * when the library has one, and a note saying it was detected, how well it
 * matched and which record it was matched against, so an annotation made by
 * the app is never mistaken for one the file came with.
 */
export function featureFromHit(hit: FeatureHit, part: Omit<LibraryPart, 'sequence'>): Feature {
  const qualifiers: Qualifier[] = [{ name: 'label', value: part.name }];
  if (part.note !== undefined) qualifiers.push({ name: 'note', value: part.note });
  const via = part.fpbase === undefined ? '' : ` via FPbase ${part.fpbase}`;
  qualifiers.push({
    name: 'note',
    value: `Detected by PlasmidPop: ${describeMatch(hit)} to ${part.accession} ${part.location}${via}`,
  });
  return createFeature({
    type: part.type,
    name: part.name,
    strand: hit.strand,
    segments: [rangeSegment(hit.range.start, hit.range.end)],
    qualifiers,
  });
}
