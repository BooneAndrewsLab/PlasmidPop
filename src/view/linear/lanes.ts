import { type Feature, type Range, rangePieces } from '@/core';

import { type RowBreaks, rowBreaksOf } from './rowBreaks';

export interface LaneAssignment {
  /** Lane index per feature id (0 = closest to the sequence). */
  readonly laneOf: ReadonlyMap<string, number>;
  readonly laneCount: number;
}

/**
 * Anything that can be stacked in lanes: an id and the stretches of sequence
 * it covers, already unrolled so nothing wraps the origin. Features are the
 * usual case; the preview overlay stacks its own spans the same way.
 */
export interface LaneItem {
  readonly id: string;
  readonly pieces: readonly Range[];
}

/** Nothing in any lane; what a view with no preview hands the renderers. */
export const NO_LANES: LaneAssignment = { laneOf: new Map(), laneCount: 0 };

interface Occupied {
  readonly start: number;
  readonly end: number;
}

function realPieces(feature: Feature, seqLength: number): Range[] {
  const out: Range[] = [];
  for (const seg of feature.segments) {
    if (seg.kind === 'range') out.push(...rangePieces(seg, seqLength));
    else
      out.push({
        start: Math.max(0, seg.position - 1),
        end: Math.min(seqLength, seg.position + 1),
      });
  }
  return out;
}

function laneItems(features: readonly Feature[], seqLength: number): LaneItem[] {
  return features.map((feature) => ({ id: feature.id, pieces: realPieces(feature, seqLength) }));
}

function overlaps(a: Occupied, b: Occupied): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Items with something to place, longest first, then by where they start. */
function longestFirst(items: readonly LaneItem[]): LaneItem[] {
  const ordered = items.filter((item) => item.pieces.length > 0);
  ordered.sort((a, b) => {
    const la = a.pieces.reduce((n, p) => n + p.end - p.start, 0);
    const lb = b.pieces.reduce((n, p) => n + p.end - p.start, 0);
    return lb - la || (a.pieces[0]?.start ?? 0) - (b.pieces[0]?.start ?? 0);
  });
  return ordered;
}

/**
 * Greedy interval colouring: each item gets the lowest lane where none of
 * its pieces overlaps a piece already in that lane. Items are processed
 * longest-first so big ones hug the sequence and small ones stack above
 * them, and an item keeps one lane across all rows.
 */
export function packLanes(items: readonly LaneItem[]): LaneAssignment {
  const laneOf = new Map<string, number>();
  const lanes: Occupied[][] = [];
  const ordered = longestFirst(items);

  for (const { id, pieces } of ordered) {
    let lane = 0;
    for (; lane < lanes.length; lane++) {
      const occupied = lanes[lane] ?? [];
      if (!pieces.some((p) => occupied.some((o) => overlaps(o, p)))) break;
    }
    const target = lanes[lane] ?? [];
    if (lane === lanes.length) lanes.push(target);
    target.push(...pieces);
    laneOf.set(id, lane);
  }
  return { laneOf, laneCount: lanes.length };
}

/**
 * `lanes` with `extra` items stacked after everything already in it: each
 * gets the lowest lane where it overlaps nothing, placed or extra, and a new
 * lane past the last only when none has room. What was in `lanes` keeps the
 * lane it had, so adding the extras cannot move anything. `placed` are the
 * items `lanes` was packed from, for where each one lies.
 */
export function packAfter(
  lanes: LaneAssignment,
  placed: readonly LaneItem[],
  extra: readonly LaneItem[],
): LaneAssignment {
  if (extra.length === 0) return lanes;
  const occupied: Occupied[][] = Array.from({ length: lanes.laneCount }, () => []);
  for (const item of placed) {
    const lane = lanes.laneOf.get(item.id);
    if (lane !== undefined) occupied[lane]?.push(...item.pieces);
  }
  const laneOf = new Map(lanes.laneOf);
  for (const { id, pieces } of longestFirst(extra)) {
    let lane = 0;
    for (; lane < occupied.length; lane++) {
      const taken = occupied[lane] ?? [];
      if (!pieces.some((p) => taken.some((o) => overlaps(o, p)))) break;
    }
    const target = occupied[lane] ?? [];
    if (lane === occupied.length) occupied.push(target);
    target.push(...pieces);
    laneOf.set(id, lane);
  }
  return { laneOf, laneCount: occupied.length };
}

/** The lane items of a set of features: each one's id and the extent it really covers. */
export function featureLaneItems(features: readonly Feature[], seqLength: number): LaneItem[] {
  return laneItems(features, seqLength);
}

/** Lanes for a set of features, by the extent each one really covers. */
export function assignLanes(features: readonly Feature[], seqLength: number): LaneAssignment {
  return packLanes(laneItems(features, seqLength));
}

/**
 * For each row — of `basesPerRow` bases, or as `RowBreaks` has them — the
 * number of lanes needed to draw the items that touch it (0 when none do).
 */
export function itemLanesPerRow(
  items: readonly LaneItem[],
  lanes: LaneAssignment,
  seqLength: number,
  rows: number | RowBreaks,
): number[] {
  const breaks = rowBreaksOf(seqLength, rows);
  const rowCount = breaks.rows.length;
  const counts = new Array<number>(rowCount).fill(0);
  for (const item of items) {
    const lane = lanes.laneOf.get(item.id);
    if (lane === undefined) continue;
    for (const piece of item.pieces) {
      if (piece.end <= piece.start) continue;
      const firstRow = breaks.rowOf(piece.start);
      const lastRow = breaks.rowOf(piece.end - 1);
      for (let r = firstRow; r <= lastRow && r < rowCount; r++) {
        if ((counts[r] ?? 0) < lane + 1) counts[r] = lane + 1;
      }
    }
  }
  return counts;
}

/**
 * For each row, the number of lanes needed to draw the features that touch
 * it (0 when none do).
 */
export function lanesPerRow(
  features: readonly Feature[],
  lanes: LaneAssignment,
  seqLength: number,
  rows: number | RowBreaks,
): number[] {
  return itemLanesPerRow(laneItems(features, seqLength), lanes, seqLength, rows);
}
