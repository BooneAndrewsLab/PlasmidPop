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
 * How many bases of a CDS's reading a deletion takes off the end of it: the
 * mirror of `basesLostFromReadingStart`, counted from the last base read.
 */
export function basesLostFromReadingEnd(
  feature: Feature,
  deletion: Range,
  seqLength: number,
): number {
  const mirrored = { ...feature, strand: feature.strand === 'reverse' ? 'forward' : 'reverse' };
  return basesLostFromReadingStart(mirrored as Feature, deletion, seqLength);
}

/**
 * `feature` with its 3' end marked partial (#176) when `lost` bases went off
 * the end of its reading: what is left has no stop of its own, and the
 * mark that a dropped last segment carried must not go with it. The feature
 * itself when nothing was lost or it is not a CDS.
 */
export function markReadingEndLost(feature: Feature, lost: number): Feature {
  if (lost <= 0 || feature.type !== 'CDS') return feature;
  const reverse = feature.strand === 'reverse';
  let at = -1;
  feature.segments.forEach((s, i) => {
    if (s.kind === 'range' && (!reverse || at < 0)) at = i;
  });
  return {
    ...feature,
    segments: feature.segments.map((s, i) =>
      i === at && s.kind === 'range'
        ? reverse
          ? { ...s, partialStart: true }
          : { ...s, partialEnd: true }
        : s,
    ),
  };
}

/**
 * `feature` with `/codon_start` moved past `lost` bases taken off the front
 * of its reading, to the first whole codon that is left. A frame of 1 is
 * the default and is not written, so the qualifier goes rather than reading
 * `1`. The 5' end is marked partial too (#163): what is left has no start
 * codon of its own, so its first codon must not read as `M`, as in
 * `extractRange`. Unless only skipped bases went (#186): they are not read, so
 * the first codon is whole and the end is as `original` (the feature before
 * the cut, which the cut's own partial marks must not overrule) had it, as when
 * a fragment is turned over and its overhang takes the skip base off. The
 * feature itself when nothing was lost or it is not a CDS.
 */
export function advanceCodonStart(
  feature: Feature,
  lost: number,
  original: Feature = feature,
): Feature {
  if (lost <= 0 || feature.type !== 'CDS') return feature;
  const q = feature.qualifiers.find((x) => x.name === 'codon_start')?.value;
  const skip = q === '2' ? 1 : q === '3' ? 2 : 0;
  const remaining = lost <= skip ? skip - lost : (3 - ((lost - skip) % 3)) % 3;
  const qualifiers = feature.qualifiers.filter((x) => x.name !== 'codon_start');
  if (remaining > 0) qualifiers.push({ name: 'codon_start', value: String(remaining + 1) });
  const segments =
    lost <= skip
      ? setFivePrimePartial(feature, fivePrimePartial(original))
      : setFivePrimePartial(feature, true);
  return { ...feature, qualifiers, segments };
}

/** Whether the biological 5' end (low coordinate forward, high reverse) is marked partial. */
function fivePrimePartial(feature: Feature): boolean {
  const ranges = feature.segments.filter((s) => s.kind === 'range');
  const seg = feature.strand === 'reverse' ? ranges[ranges.length - 1] : ranges[0];
  if (seg === undefined) return false;
  return feature.strand === 'reverse' ? seg.partialEnd : seg.partialStart;
}

/** The segments with the biological 5' end marked partial or not as given. */
function setFivePrimePartial(feature: Feature, partial: boolean): Feature['segments'] {
  const reverse = feature.strand === 'reverse';
  let at = -1;
  feature.segments.forEach((s, i) => {
    if (s.kind === 'range' && (reverse || at < 0)) at = i;
  });
  return feature.segments.map((s, i) =>
    i === at && s.kind === 'range'
      ? reverse
        ? { ...s, partialEnd: partial }
        : { ...s, partialStart: partial }
      : s,
  );
}
