/**
 * Coordinate primitives shared by the whole document model.
 *
 * All positions are 0-based. A `Range` is half-open `[start, end)` in
 * *unrolled* coordinates:
 *
 * - `start` is always a real position: `0 <= start < length` on a circular
 *   sequence, `0 <= start <= length` on a linear one (the latter only for an
 *   empty range at the very end).
 * - `end` may exceed `length` by up to `start` to express a range that wraps
 *   past the origin of a circular sequence. A range wraps iff `end > length`.
 * - `end - start` is always the number of bases covered, so a full-circle
 *   range is `[s, s + length)` and is never confused with the empty range
 *   `[s, s)`.
 *
 * GenBank I/O converts to and from 1-based inclusive coordinates at the
 * parser/writer boundary only. Nothing in here knows about 1-based indexing.
 */

export interface Range {
  readonly start: number;
  readonly end: number;
}

export type Topology = 'linear' | 'circular';

export function range(start: number, end: number): Range {
  return { start, end };
}

export function rangeLength(r: Range): number {
  return r.end - r.start;
}

export function isEmptyRange(r: Range): boolean {
  return r.end === r.start;
}

export function rangeWraps(r: Range, seqLength: number): boolean {
  return r.end > seqLength;
}

export function rangesEqual(a: Range, b: Range): boolean {
  return a.start === b.start && a.end === b.end;
}

export function isValidRange(r: Range, seqLength: number, topology: Topology): boolean {
  if (!Number.isInteger(r.start) || !Number.isInteger(r.end)) return false;
  if (r.start < 0 || r.end < r.start) return false;
  if (topology === 'linear') return r.end <= seqLength;
  if (seqLength === 0) return r.start === 0 && r.end === 0;
  return r.start < seqLength && r.end - r.start <= seqLength;
}

export function assertValidRange(r: Range, seqLength: number, topology: Topology): void {
  if (!isValidRange(r, seqLength, topology)) {
    throw new RangeError(
      `Invalid range [${r.start}, ${r.end}) for ${topology} sequence of length ${seqLength}`,
    );
  }
}

export function isValidPosition(position: number, seqLength: number, _topology: Topology): boolean {
  if (!Number.isInteger(position) || position < 0) return false;
  // Both topologies accept `seqLength`: for circular sequences it is the same
  // point as 0 (see normalizePosition); for linear ones it means "append".
  return position <= seqLength;
}

export function assertValidPosition(position: number, seqLength: number, topology: Topology): void {
  if (!isValidPosition(position, seqLength, topology)) {
    throw new RangeError(
      `Invalid position ${position} for ${topology} sequence of length ${seqLength}`,
    );
  }
}

/**
 * Canonical form of an insertion point. On a circular sequence position
 * `length` is the same point as position 0.
 */
export function normalizePosition(position: number, seqLength: number, topology: Topology): number {
  return topology === 'circular' && position === seqLength ? 0 : position;
}

/**
 * Splits a range into one or two non-wrapping pieces in real coordinates.
 * The pieces are returned in forward order: the head `[start, length)`
 * first, then the tail `[0, end - length)`.
 */
export function rangePieces(r: Range, seqLength: number): readonly Range[] {
  if (r.end <= seqLength) return [r];
  return [range(r.start, seqLength), range(0, r.end - seqLength)];
}

/**
 * Builds an unrolled range from real start and *exclusive* real end. If the
 * end is before the start the range wraps. `start === endExclusive` yields an
 * empty range; callers that mean "full circle" must say so explicitly by
 * using `range(start, start + seqLength)`.
 */
export function unrollRange(start: number, endExclusive: number, seqLength: number): Range {
  return endExclusive < start ? range(start, endExclusive + seqLength) : range(start, endExclusive);
}

/** Whether the real position `position` is one of the bases covered by `r`. */
export function rangeContains(r: Range, position: number, seqLength: number): boolean {
  if (position < 0 || position >= seqLength) return false;
  if (r.start <= position && position < r.end) return true;
  const shifted = position + seqLength;
  return r.start <= shifted && shifted < r.end;
}

function intersects(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Whether two non-empty ranges share at least one base. */
export function rangesOverlap(a: Range, b: Range, seqLength: number): boolean {
  if (isEmptyRange(a) || isEmptyRange(b)) return false;
  return (
    intersects(a, b) ||
    intersects(a, range(b.start + seqLength, b.end + seqLength)) ||
    intersects(range(a.start + seqLength, a.end + seqLength), b)
  );
}

/**
 * Coordinates of `r` after inserting `count` bases at `position`.
 *
 * Rules (they match what a scientist expects from a sequence editor):
 * - Insertion strictly inside the range grows it.
 * - Insertion at the range's first base pushes the whole range right.
 * - Insertion at the base just past the range leaves it alone.
 * - On a circular sequence "inside" is judged circularly, so inserting at
 *   the origin grows a range that spans the origin, and grows a full-circle
 *   range.
 * - An empty range (a cursor) moves past the inserted text when it sits at
 *   the insertion point.
 */
export function shiftRangeForInsert(
  r: Range,
  position: number,
  count: number,
  seqLength: number,
  topology: Topology,
): Range {
  if (count === 0) return r;
  const p = normalizePosition(position, seqLength, topology);
  const len = rangeLength(r);
  const start = r.start >= p ? r.start + count : r.start;
  if (len === 0) return range(start, start);
  const previous = topology === 'circular' && p === 0 ? seqLength - 1 : p - 1;
  const inside = rangeContains(r, previous, seqLength) && rangeContains(r, p, seqLength);
  return range(start, start + len + (inside ? count : 0));
}

/** Maps a single real position through a non-wrapping deletion `[a, b)`. */
function shiftPointForLinearDeletion(position: number, a: number, b: number): number {
  if (position <= a) return position;
  if (position >= b) return position - (b - a);
  return a;
}

function shiftRangeForLinearDeletion(
  r: Range,
  a: number,
  b: number,
  seqLength: number,
): Range | null {
  const removed = b - a;
  if (isEmptyRange(r)) {
    const s = shiftPointForLinearDeletion(r.start, a, b);
    return range(s, s);
  }
  const kept: Range[] = [];
  for (const piece of rangePieces(r, seqLength)) {
    const s = piece.start < a ? piece.start : piece.start >= b ? piece.start - removed : a;
    const e = piece.end <= a ? piece.end : piece.end >= b ? piece.end - removed : a;
    if (e > s) kept.push(range(s, e));
  }
  const head = kept[0];
  if (head === undefined) return null;
  const tail = kept[1];
  if (tail === undefined) return head;
  // A wrapped range whose head and tail both survive: the head still ends at
  // the (new) sequence end and the tail still starts at 0, so re-join them.
  return range(head.start, seqLength - removed + tail.end);
}

/**
 * Coordinates of `r` after deleting the bases in `deletion`, or `null` if
 * every base of `r` was deleted. An empty range (a cursor) is never removed:
 * it collapses onto the deletion point instead.
 *
 * `deletion` may wrap; it is applied as its two real pieces, head first.
 */
export function shiftRangeForDelete(r: Range, deletion: Range, seqLength: number): Range | null {
  if (isEmptyRange(deletion)) return r;
  const pieces = rangePieces(deletion, seqLength);
  const head = pieces[0];
  if (head === undefined) return r;
  let current: Range | null = shiftRangeForLinearDeletion(r, head.start, head.end, seqLength);
  const tail = pieces[1];
  if (tail !== undefined && current !== null) {
    const lengthAfterHead = seqLength - rangeLength(head);
    current = shiftRangeForLinearDeletion(current, tail.start, tail.end, lengthAfterHead);
  }
  return current;
}

/** Maps a single insertion point / cursor position through a deletion. */
export function shiftPositionForDelete(
  position: number,
  deletion: Range,
  seqLength: number,
): number {
  return shiftRangeForDelete(range(position, position), deletion, seqLength)?.start ?? position;
}

/**
 * Coordinates of `r` after the origin of a circular sequence is moved to
 * `origin` (the base at `origin` becomes base 0).
 */
export function rotateRange(r: Range, origin: number, seqLength: number): Range {
  if (seqLength === 0) return r;
  const start = (((r.start - origin) % seqLength) + seqLength) % seqLength;
  return range(start, start + rangeLength(r));
}

/** Maps a position through a change of origin. */
export function rotatePosition(position: number, origin: number, seqLength: number): number {
  return rotateRange(range(position, position), origin, seqLength).start;
}

/**
 * Coordinates of `r` after the whole sequence is reverse-complemented.
 * Base `i` becomes base `length - 1 - i`; the covered set of bases is mapped
 * accordingly and the result is re-unrolled.
 */
export function flipRange(r: Range, seqLength: number, topology: Topology): Range {
  if (seqLength === 0) return r;
  const len = rangeLength(r);
  let start = seqLength - r.end;
  if (topology === 'circular') start = ((start % seqLength) + seqLength) % seqLength;
  return range(start, start + len);
}

/** Maps a position through a reverse-complement of the whole sequence. */
export function flipPosition(position: number, seqLength: number, topology: Topology): number {
  return flipRange(range(position, position), seqLength, topology).start;
}
