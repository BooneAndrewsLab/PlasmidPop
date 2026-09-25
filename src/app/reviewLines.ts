import { type DiffHunk, type DocumentDiff } from '@/core';
import { type ChangeTarget } from '@/view/circular';

/**
 * How many neighbourhoods a review draws. A review is meant to be read, and
 * past a dozen pieces of sequence nobody reads it; the rest are counted.
 */
export const MAX_STRIPS = 12;

/** Key of the line that counts the places not drawn. */
export const MORE_PLACES = 'more-places';

/** Key of a drawn neighbourhood's line. */
export function hunkKey(hunk: DiffHunk): string {
  return `hunk:${hunk.start}-${hunk.end}`;
}

/**
 * The line of a review a change on its map stands for (#27): the drawn
 * neighbourhood a mark or a deletion is in, or the line counting the rest
 * when it is past the dozen drawn; a ghost's own line in Features, or the
 * line counting the removals not listed. `rowKeys` are the Features lines'
 * keys (`featureChangeRows`). Null when there is no such line.
 */
export function reviewKeyFor(
  target: ChangeTarget,
  diff: DocumentDiff,
  hunks: readonly DiffHunk[],
  rowKeys: ReadonlySet<string>,
): string | null {
  if (target.kind === 'removed') {
    const own = `-${target.featureId}`;
    if (rowKeys.has(own)) return own;
    return rowKeys.has('more-removed') ? 'more-removed' : null;
  }
  // A hunk carries the very marks and deletions of the diff it was cut from.
  const index =
    target.kind === 'mark'
      ? hunks.findIndex((h) => h.marks.some((m) => m === diff.marks[target.index]))
      : hunks.findIndex((h) => h.deletions.some((d) => d === diff.deletions[target.index]));
  const hunk = hunks[index];
  if (hunk === undefined) return null;
  return index < MAX_STRIPS ? hunkKey(hunk) : MORE_PLACES;
}
