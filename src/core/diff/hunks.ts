import { type DeletionMark, type DocumentDiff, type EditMark } from './documentDiff';

/**
 * Bases of unchanged sequence kept on either side of a change, so a hunk
 * reads as a piece of the molecule rather than as a bare edit.
 */
export const DEFAULT_HUNK_PAD = 30;

/**
 * One neighbourhood of changes: a span of the newer document to draw, with
 * the marks that fall inside it.
 *
 * A review of a whole plasmid is mostly unchanged bases, so the save review
 * draws these rather than the sequence end to end. Spans are half-open and
 * in the coordinates of the newer document, like the marks themselves.
 */
export interface DiffHunk {
  /** Span to draw, the changes plus their padding, clamped to the document. */
  readonly start: number;
  readonly end: number;
  /** Span of the changes alone, for naming the hunk ("around 1,204"). */
  readonly changeStart: number;
  readonly changeEnd: number;
  readonly marks: readonly EditMark[];
  readonly deletions: readonly DeletionMark[];
  /** Bases in this hunk that the older version did not have. */
  readonly basesInserted: number;
  /** Bases standing where other bases used to be. */
  readonly basesChanged: number;
  /** Bases the older version had here that are gone. */
  readonly basesDeleted: number;
}

/** A change as it comes in, before neighbours are merged: a mark or a deletion. */
interface Change {
  readonly start: number;
  readonly end: number;
  readonly mark: EditMark | null;
  readonly deletion: DeletionMark | null;
}

/**
 * The changes in `diff` grouped into neighbourhoods, ascending.
 *
 * Two changes join one hunk when their padded spans touch, so a handful of
 * substitutions a few bases apart is one piece of sequence to read instead
 * of five. Padding is clamped to the document rather than wrapped: a hunk is
 * a contiguous run of rows to draw, and the origin is where rows stop.
 */
export function diffHunks(
  diff: DocumentDiff,
  length: number,
  pad: number = DEFAULT_HUNK_PAD,
): readonly DiffHunk[] {
  const changes: Change[] = [
    ...diff.marks.map((mark) => ({ start: mark.start, end: mark.end, mark, deletion: null })),
    // Bases that are gone leave no span behind, only the boundary they left.
    ...diff.deletions.map((deletion) => ({
      start: deletion.position,
      end: deletion.position,
      mark: null,
      deletion,
    })),
  ];
  changes.sort((a, b) => a.start - b.start || a.end - b.end);

  const hunks: DiffHunk[] = [];
  let group: Change[] = [];
  const flush = (): void => {
    const first = group[0];
    const last = group[group.length - 1];
    if (first === undefined || last === undefined) return;
    // Sorting by start does not order the ends, so take the furthest.
    const changeEnd = group.reduce((end, c) => Math.max(end, c.end), last.end);
    const marks = group.flatMap((c) => (c.mark === null ? [] : [c.mark]));
    const deletions = group.flatMap((c) => (c.deletion === null ? [] : [c.deletion]));
    const bases = (kind: EditMark['kind']): number =>
      marks.reduce((n, m) => (m.kind === kind ? n + (m.end - m.start) : n), 0);
    hunks.push({
      start: Math.max(0, first.start - pad),
      end: Math.min(length, changeEnd + pad),
      changeStart: first.start,
      changeEnd,
      marks,
      deletions,
      basesInserted: bases('inserted'),
      basesChanged: bases('changed'),
      basesDeleted: deletions.reduce((n, d) => n + d.count, 0),
    });
    group = [];
  };

  let reach = 0;
  for (const change of changes) {
    // The padded spans touch when the gap between the changes is under twice
    // the padding; `reach` carries the furthest end the group has got to, so
    // a long mark keeps the group open for what follows it.
    if (group.length > 0 && change.start - reach > pad * 2) flush();
    group.push(change);
    reach = Math.max(reach, change.end);
  }
  flush();
  return hunks;
}
