import { type Feature, type Range, rangePieces } from '@/core';

export interface LaneAssignment {
  /** Lane index per feature id (0 = closest to the sequence). */
  readonly laneOf: ReadonlyMap<string, number>;
  readonly laneCount: number;
}

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

function overlaps(a: Occupied, b: Occupied): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Greedy interval colouring: each feature gets the lowest lane where none of
 * its real pieces overlaps a piece already in that lane. Features are
 * processed longest-first so big features hug the sequence and small ones
 * stack above them, and a feature keeps one lane across all rows.
 */
export function assignLanes(features: readonly Feature[], seqLength: number): LaneAssignment {
  const laneOf = new Map<string, number>();
  const lanes: Occupied[][] = [];
  const items = features
    .map((feature) => ({ feature, pieces: realPieces(feature, seqLength) }))
    .filter((item) => item.pieces.length > 0);
  items.sort((a, b) => {
    const la = a.pieces.reduce((n, p) => n + p.end - p.start, 0);
    const lb = b.pieces.reduce((n, p) => n + p.end - p.start, 0);
    return lb - la || (a.pieces[0]?.start ?? 0) - (b.pieces[0]?.start ?? 0);
  });

  for (const { feature, pieces } of items) {
    let lane = 0;
    for (; lane < lanes.length; lane++) {
      const occupied = lanes[lane] ?? [];
      if (!pieces.some((p) => occupied.some((o) => overlaps(o, p)))) break;
    }
    const target = lanes[lane] ?? [];
    if (lane === lanes.length) lanes.push(target);
    target.push(...pieces);
    laneOf.set(feature.id, lane);
  }
  return { laneOf, laneCount: lanes.length };
}

/**
 * For each row of `basesPerRow` bases, the number of lanes needed to draw the
 * features that touch it (0 when none do).
 */
export function lanesPerRow(
  features: readonly Feature[],
  lanes: LaneAssignment,
  seqLength: number,
  basesPerRow: number,
): number[] {
  const rowCount = Math.max(1, Math.ceil(seqLength / basesPerRow));
  const counts = new Array<number>(rowCount).fill(0);
  for (const feature of features) {
    const lane = lanes.laneOf.get(feature.id);
    if (lane === undefined) continue;
    for (const piece of realPieces(feature, seqLength)) {
      if (piece.end <= piece.start) continue;
      const firstRow = Math.floor(piece.start / basesPerRow);
      const lastRow = Math.floor((piece.end - 1) / basesPerRow);
      for (let r = firstRow; r <= lastRow && r < rowCount; r++) {
        if ((counts[r] ?? 0) < lane + 1) counts[r] = lane + 1;
      }
    }
  }
  return counts;
}
