import { type Feature } from '../features';
import { type DocumentDiff } from './documentDiff';

/** Outer extent of a feature, half-open, over all of its segments, sites included. */
export function outerExtent(feature: Feature): { start: number; end: number } {
  let start = Infinity;
  let end = -Infinity;
  for (const seg of feature.segments) {
    const from = seg.kind === 'site' ? seg.position : seg.start;
    const to = seg.kind === 'site' ? seg.position : seg.end;
    start = Math.min(start, from);
    end = Math.max(end, to);
  }
  return { start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) ? end : 0 };
}

/**
 * The deletion that took a removed feature, as its boundary, or null if none
 * did (item 27). A feature inside a deleted stretch has all of its bases
 * mapped onto the boundary the deletion left behind, so it comes back from
 * the diff covering a base or none at all. The deletion has to be there: a
 * 1 bp feature deleted by hand also comes back covering one base, and
 * nothing swallowed it.
 *
 * The review groups the features one deletion took into one line, and the
 * map leaves them to the deletion's wedge rather than drawing a ghost of a
 * base (item 25).
 */
export function deletionThatTook(feature: Feature, diff: DocumentDiff): number | null {
  const { start, end } = outerExtent(feature);
  if (end - start > 1) return null;
  for (const deletion of diff.deletions) {
    if (deletion.position >= start && deletion.position <= end) return deletion.position;
  }
  return null;
}
