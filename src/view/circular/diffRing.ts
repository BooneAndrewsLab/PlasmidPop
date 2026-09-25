import { type DocumentDiff, type Feature, deletionThatTook } from '@/core';

import { type LaneAssignment, featureLaneItems, packAfter } from '../linear/lanes';
import { drawableFeatures } from '../visibleFeatures';

/**
 * What on the ring stands for a change, for the pointer to land on (#27): an
 * edit mark by its index in `DocumentDiff.marks`, a deletion by its index in
 * `deletions`, or a removed feature's ghost by its id in `featuresRemoved`.
 */
export type ChangeTarget =
  | { readonly kind: 'mark'; readonly index: number }
  | { readonly kind: 'deletion'; readonly index: number }
  | { readonly kind: 'removed'; readonly featureId: string };

/** Whether two targets are the same change. */
export function sameChange(a: ChangeTarget | null, b: ChangeTarget | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'removed') return b.kind === 'removed' && a.featureId === b.featureId;
  return b.kind === a.kind && b.index === a.index;
}

/**
 * A ghost's key in a `LaneAssignment`. A removed feature is in neither
 * document, and one paired across two files keeps the other file's id, so
 * the prefix keeps it from ever answering for a live feature's lane.
 */
export const GHOST_PREFIX = 'ghost:';

export function ghostLaneKey(featureId: string): string {
  return `${GHOST_PREFIX}${featureId}`;
}

/**
 * The removed features the map draws as ghosts: those it would draw were
 * they still there, less those a deletion took whole. A feature inside a
 * deleted stretch maps to at most one base beside the deletion's wedge, and
 * the wedge already points there; a stub of a ghost under it would add
 * nothing, and the seven a long deletion takes would stack seven lanes deep
 * for it (item 27's rule, `deletionThatTook`).
 */
export function ghostFeatures(edits: DocumentDiff | null): readonly Feature[] {
  if (edits === null || edits.featuresRemoved.size === 0) return [];
  return drawableFeatures([...edits.featuresRemoved.values()]).filter(
    (f) => deletionThatTook(f, edits) === null,
  );
}

/**
 * The live features' lanes with the ghosts stacked after them: a ghost takes
 * the first lane with room where it was, and a lane of its own past the last
 * only when none has. No live feature moves for one, so turning the marks on
 * never reshuffles the map's own annotation; `live` must be the features
 * `lanes` was packed from.
 */
export function lanesWithGhosts(
  live: readonly Feature[],
  lanes: LaneAssignment,
  ghosts: readonly Feature[],
  seqLength: number,
): LaneAssignment {
  if (ghosts.length === 0) return lanes;
  const extra = featureLaneItems(ghosts, seqLength).map((item) => ({
    ...item,
    id: ghostLaneKey(item.id),
  }));
  return packAfter(lanes, featureLaneItems(live, seqLength), extra);
}
