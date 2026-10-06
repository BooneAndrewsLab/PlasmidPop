import type { Range } from '../range';
import type { Feature } from './feature';

/**
 * How many bases of a CDS's reading a deletion takes off the front of it
 * (#160): the left end of the first segment for a forward CDS, the right end
 * of the last for a reverse one, running on through each segment the
 * deletion removes whole. Losses in the middle or at the far end do not
 * move where the reading starts. `range` is the deletion as `delete` takes
 * it, unrolled so it may run past `seqLength` on a circle.
 */
export function basesLostFromReadingStart(
  feature: Feature,
  deletion: Range,
  seqLength: number,
): number {
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  if (feature.strand === 'reverse') ranges.reverse();
  let lost = 0;
  for (const seg of ranges) {
    const length = seg.end - seg.start;
    let here = 0;
    // The deletion and the segment may each be unrolled past the origin, so
    // try the deletion one turn either way too.
    for (const turn of [0, -seqLength, seqLength]) {
      const from = deletion.start + turn;
      const to = deletion.end + turn;
      if (feature.strand === 'reverse') {
        if (from < seg.end && seg.end - 1 < to)
          here = Math.max(here, Math.min(length, seg.end - from));
      } else if (from <= seg.start && seg.start < to) {
        here = Math.max(here, Math.min(length, to - seg.start));
      }
    }
    lost += here;
    if (here < length) break;
  }
  return lost;
}

/**
 * `feature` with `/codon_start` moved past `lost` bases taken off the front
 * of its reading, to the first whole codon that is left. A frame of 1 is
 * the default and is not written, so the qualifier goes rather than reading
 * `1`. The feature itself when nothing was lost or it is not a CDS.
 */
export function advanceCodonStart(feature: Feature, lost: number): Feature {
  if (lost <= 0 || feature.type !== 'CDS') return feature;
  const q = feature.qualifiers.find((x) => x.name === 'codon_start')?.value;
  const skip = q === '2' ? 1 : q === '3' ? 2 : 0;
  const remaining = lost <= skip ? skip - lost : (3 - ((lost - skip) % 3)) % 3;
  const qualifiers = feature.qualifiers.filter((x) => x.name !== 'codon_start');
  if (remaining > 0) qualifiers.push({ name: 'codon_start', value: String(remaining + 1) });
  return { ...feature, qualifiers };
}
