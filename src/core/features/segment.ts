import {
  type Range,
  type Topology,
  assertValidRange,
  flipPosition,
  flipRange,
  isEmptyRange,
  isValidPosition,
  isValidRange,
  rangeLength,
  rangePieces,
  rotatePosition,
  rotateRange,
  shiftPositionForDelete,
  shiftRangeForDelete,
  shiftRangeForInsert,
} from '../range';

/**
 * One piece of a feature location. A GenBank `join(...)` becomes several
 * segments; a plain location is one segment.
 *
 * - `range`: a run of bases `[start, end)` (unrolled, may wrap on circular
 *   sequences). `partialStart`/`partialEnd` carry GenBank's `<` and `>`
 *   markers, which mean the true boundary lies beyond the sequence.
 * - `site`: a zero-width location between two bases (GenBank `a^b`), stored
 *   as the 0-based insertion index, i.e. the site sits between
 *   `position - 1` and `position`.
 */
export type Segment = RangeSegment | SiteSegment;

export interface RangeSegment extends Range {
  readonly kind: 'range';
  readonly partialStart: boolean;
  readonly partialEnd: boolean;
}

export interface SiteSegment {
  readonly kind: 'site';
  readonly position: number;
}

export interface RangeSegmentOptions {
  readonly partialStart?: boolean;
  readonly partialEnd?: boolean;
}

export function rangeSegment(
  start: number,
  end: number,
  opts: RangeSegmentOptions = {},
): RangeSegment {
  return {
    kind: 'range',
    start,
    end,
    partialStart: opts.partialStart ?? false,
    partialEnd: opts.partialEnd ?? false,
  };
}

export function siteSegment(position: number): SiteSegment {
  return { kind: 'site', position };
}

export function segmentLength(seg: Segment): number {
  return seg.kind === 'range' ? rangeLength(seg) : 0;
}

export function isValidSegment(seg: Segment, seqLength: number, topology: Topology): boolean {
  switch (seg.kind) {
    case 'range':
      return !isEmptyRange(seg) && isValidRange(seg, seqLength, topology);
    case 'site':
      // Linear: anywhere from before the first base to after the last one.
      // Circular: position `length` is position 0, so only the latter is valid.
      return (
        isValidPosition(seg.position, seqLength, topology) &&
        !(topology === 'circular' && seqLength > 0 && seg.position === seqLength)
      );
  }
}

export function assertValidSegment(seg: Segment, seqLength: number, topology: Topology): void {
  if (seg.kind === 'range') {
    assertValidRange(seg, seqLength, topology);
    if (isEmptyRange(seg))
      throw new RangeError(`Feature segment [${seg.start}, ${seg.end}) is empty`);
    return;
  }
  if (!isValidSegment(seg, seqLength, topology)) {
    throw new RangeError(
      `Invalid site position ${seg.position} for ${topology} sequence of length ${seqLength}`,
    );
  }
}

function withRange(seg: RangeSegment, r: Range): RangeSegment {
  return r.start === seg.start && r.end === seg.end ? seg : { ...seg, start: r.start, end: r.end };
}

export function shiftSegmentForInsert(
  seg: Segment,
  position: number,
  count: number,
  seqLength: number,
  topology: Topology,
): Segment {
  switch (seg.kind) {
    case 'range':
      return withRange(seg, shiftRangeForInsert(seg, position, count, seqLength, topology));
    case 'site':
      return seg.position >= position && count > 0 ? siteSegment(seg.position + count) : seg;
  }
}

/** `null` when every base of a range segment was deleted. Sites survive. */
export function shiftSegmentForDelete(
  seg: Segment,
  deletion: Range,
  seqLength: number,
): Segment | null {
  switch (seg.kind) {
    case 'range': {
      const shifted = shiftRangeForDelete(seg, deletion, seqLength);
      return shifted === null ? null : withRange(seg, shifted);
    }
    case 'site': {
      const p = shiftPositionForDelete(seg.position, deletion, seqLength);
      return p === seg.position ? seg : siteSegment(p);
    }
  }
}

/**
 * On a circle the gap after the last base is the gap before the first, and
 * only position 0 names it (see `isValidSegment`). A site an edit leaves at
 * `seqLength` — the end it collapsed onto, or the end a linear sequence had
 * before it was closed — is moved there.
 */
export function closeSiteOnCircle(seg: Segment, seqLength: number): Segment {
  return seg.kind === 'site' && seqLength > 0 && seg.position === seqLength ? siteSegment(0) : seg;
}

/** Moves a segment by `offset` bases, e.g. from fragment to document coordinates. */
export function shiftSegmentBy(seg: Segment, offset: number): Segment {
  if (offset === 0) return seg;
  switch (seg.kind) {
    case 'range':
      return { ...seg, start: seg.start + offset, end: seg.end + offset };
    case 'site':
      return siteSegment(seg.position + offset);
  }
}

export function rotateSegment(seg: Segment, origin: number, seqLength: number): Segment {
  switch (seg.kind) {
    case 'range':
      return withRange(seg, rotateRange(seg, origin, seqLength));
    case 'site':
      return siteSegment(rotatePosition(seg.position, origin, seqLength));
  }
}

/** Segment after reverse-complementing the whole sequence. Partial markers swap ends. */
export function flipSegment(seg: Segment, seqLength: number, topology: Topology): Segment {
  switch (seg.kind) {
    case 'range': {
      const r = flipRange(seg, seqLength, topology);
      return {
        kind: 'range',
        start: r.start,
        end: r.end,
        partialStart: seg.partialEnd,
        partialEnd: seg.partialStart,
      };
    }
    case 'site':
      return siteSegment(flipPosition(seg.position, seqLength, topology));
  }
}

/**
 * Splits a segment that wraps the origin into its two real pieces (head,
 * then tail). Non-wrapping segments and sites come back as a single item.
 * Used when a circular sequence is made linear.
 */
export function splitWrappedSegment(seg: Segment, seqLength: number): readonly Segment[] {
  if (seg.kind !== 'range') return [seg];
  const pieces = rangePieces(seg, seqLength);
  const head = pieces[0];
  const tail = pieces[1];
  if (head === undefined || tail === undefined) return [seg];
  return [
    rangeSegment(head.start, head.end, { partialStart: seg.partialStart }),
    rangeSegment(tail.start, tail.end, { partialEnd: seg.partialEnd }),
  ];
}
