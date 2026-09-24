import { type Feature, rangePieces, rangesOverlap } from '@/core';

/**
 * Features worth drawing. `source` spans the whole molecule and carries
 * organism metadata rather than annotation, so maps and sequence views hide
 * it (the feature list still shows it).
 *
 * A `gene` with a `CDS` of the same name on exactly the same bases and
 * strand is one thing drawn twice, and is drawn once, as the CDS (#28):
 * it is the one with a translation and a reading frame. SnapGene does the
 * same. It is display only: the feature list shows both, and both are
 * written back out.
 */
export function drawableFeatures(features: readonly Feature[]): Feature[] {
  const shape = (f: Feature): string =>
    `${f.name}\u0000${f.strand}\u0000${f.segments
      .map((s) =>
        s.kind === 'range' ? `${String(s.start)}-${String(s.end)}` : `@${String(s.position)}`,
      )
      .join(',')}`;
  const cds = new Set(
    features.filter((f) => f.type === 'CDS' && f.name !== '').map((f) => shape(f)),
  );
  return features.filter(
    (f) => f.type !== 'source' && !(f.type === 'gene' && cds.size > 0 && cds.has(shape(f))),
  );
}

function featureLength(f: Feature): number {
  let n = 0;
  for (const s of f.segments) if (s.kind === 'range') n += s.end - s.start;
  return n;
}

function overlapsAny(a: Feature, others: readonly Feature[], seqLength: number): boolean {
  const pieces = a.segments.flatMap((s) => (s.kind === 'range' ? rangePieces(s, seqLength) : []));
  return others.some((b) =>
    b.segments.some(
      (s) => s.kind === 'range' && pieces.some((p) => rangesOverlap(p, s, seqLength)),
    ),
  );
}

/**
 * Picks which features get a label on the map: the longest feature of each
 * name, plus any same-named feature that does not overlap one already
 * labelled. This collapses gene + CDS + binding sites that all carry the
 * same /gene into a single label.
 */
export function featuresToLabel(features: readonly Feature[], seqLength: number): Feature[] {
  const byName = new Map<string, Feature[]>();
  for (const f of features) {
    if (f.name === '') continue;
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }
  const out: Feature[] = [];
  for (const group of byName.values()) {
    group.sort((a, b) => featureLength(b) - featureLength(a));
    const kept: Feature[] = [];
    for (const f of group) {
      if (kept.length === 0 || !overlapsAny(f, kept, seqLength)) kept.push(f);
    }
    out.push(...kept);
  }
  return out;
}
