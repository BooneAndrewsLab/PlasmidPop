import type { Feature, Orf, Strand } from '@/core';
import { featureColor } from '@/view/featureColors';

import type { Stack } from './alignmentStack';

/**
 * The reference's features, and the ORFs found in it, laid on the columns of
 * a stacked alignment (#102) so a difference can be read against what it
 * falls in. Everything here is about columns: a gap in the reference (another
 * sample's insertion) belongs to a feature when the feature runs on both
 * sides of it.
 */

/** A thing to draw on the track, in the reference document's coordinates. */
export interface TrackAnnotation {
  readonly name: string;
  /** GenBank key, or 'ORF'. */
  readonly type: string;
  readonly strand: Strand;
  readonly colour: string;
  /** Bases covered, half-open, unrolled: a circular document's may run past its length. */
  readonly ranges: readonly { readonly start: number; readonly end: number }[];
  readonly orf: boolean;
}

/** Columns `[start, end)`. */
export interface ColumnSpan {
  readonly start: number;
  readonly end: number;
}

export interface TrackItem {
  readonly annotation: TrackAnnotation;
  /** Where it falls, ascending; several for a join or when a read runs through a circle's origin. */
  readonly spans: readonly ColumnSpan[];
  /** First and last column it touches. */
  readonly start: number;
  readonly end: number;
  /** The row of the track it is drawn in, from 0. */
  readonly lane: number;
}

export interface Track {
  readonly items: readonly TrackItem[];
  /** Lanes drawn: features first, then ORFs. */
  readonly lanes: number;
  /** Lane where the ORFs begin, equal to `lanes` when there are none. */
  readonly orfLane: number;
  /** Annotations that fell in the alignment but did not fit in `maxLanes`. */
  readonly hidden: number;
}

/** For each reference index (position along the reference), the column it sits in. */
function columnsOfIndex(stack: Stack): Int32Array {
  let top = 0;
  for (const i of stack.refIndex) if (i + 1 > top) top = i + 1;
  const columns = new Int32Array(top).fill(-1);
  stack.refIndex.forEach((i, c) => {
    if (i >= 0) columns[i] = c;
  });
  return columns;
}

/**
 * The column runs a set of document ranges covers in `stack`. `period` is the
 * document's length when it is circular (a range may then be written past
 * its end, and a read that runs through the origin sees a feature twice),
 * else 0.
 */
function spansOf(
  stack: Stack,
  columns: Int32Array,
  ranges: TrackAnnotation['ranges'],
  period: number,
): ColumnSpan[] {
  const spans: ColumnSpan[] = [];
  const shifts = period > 0 ? [-period, 0, period] : [0];
  for (const range of ranges) {
    for (const shift of shifts) {
      // Reference index i stands at document position offset + i (mod wrap).
      const from = Math.max(0, range.start - stack.offset + shift);
      const to = Math.min(columns.length, range.end - stack.offset + shift);
      if (to <= from) continue;
      const first = columns[from] ?? -1;
      const last = columns[to - 1] ?? -1;
      if (first < 0 || last < 0) continue;
      spans.push({ start: first, end: last + 1 });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

/** Lanes by first fit, in order of start; a lane's next item starts a column after the last ended. */
function packLanes(extents: readonly ColumnSpan[]): { lane: number[]; lanes: number } {
  const order = extents
    .map((_, i) => i)
    .sort((a, b) => (extents[a]?.start ?? 0) - (extents[b]?.start ?? 0));
  const ends: number[] = [];
  const lane = new Array<number>(extents.length).fill(0);
  for (const i of order) {
    const e = extents[i];
    if (e === undefined) continue;
    let k = ends.findIndex((end) => end < e.start);
    if (k < 0) {
      k = ends.length;
      ends.push(0);
    }
    ends[k] = e.end;
    lane[i] = k;
  }
  return { lane, lanes: ends.length };
}

/**
 * The annotations that fall in the alignment, packed into lanes: the
 * features in the first ones, the ORFs under them. Past `maxLanes` an
 * annotation is left out and counted in `hidden`.
 */
export function buildTrack(
  stack: Stack,
  annotations: readonly TrackAnnotation[],
  period: number,
  maxLanes: number,
): Track {
  const columns = columnsOfIndex(stack);
  const placed = annotations.flatMap((annotation) => {
    const spans = spansOf(stack, columns, annotation.ranges, period);
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (first === undefined || last === undefined) return [];
    return [{ annotation, spans, start: first.start, end: Math.max(...spans.map((s) => s.end)) }];
  });
  const items: TrackItem[] = [];
  let lanes = 0;
  let orfLane = 0;
  let hidden = 0;
  for (const orf of [false, true]) {
    const group = placed.filter((p) => p.annotation.orf === orf);
    const { lane, lanes: used } = packLanes(group);
    const room = Math.max(0, maxLanes - lanes);
    group.forEach((p, i) => {
      const k = lane[i] ?? 0;
      if (k >= room) hidden++;
      else items.push({ ...p, lane: lanes + k });
    });
    lanes += Math.min(used, room);
    if (!orf) orfLane = lanes;
  }
  return { items, lanes, orfLane, hidden };
}

/** The items drawn at a column of a lane, for a tooltip. */
export function itemAt(track: Track, lane: number, column: number): TrackItem | null {
  return (
    track.items.find(
      (t) => t.lane === lane && t.spans.some((s) => column >= s.start && column < s.end),
    ) ?? null
  );
}

/** The colour ORFs are drawn in, whatever the theme. */
const ORF_COLOUR = '#b455a8';

/**
 * A document's features and ORFs as things to draw. `source` is left out: it
 * spans the whole record and says nothing about where a difference falls.
 */
export function annotationsOf(
  features: readonly Feature[],
  orfs: readonly Orf[],
): TrackAnnotation[] {
  const out: TrackAnnotation[] = [];
  for (const f of features) {
    if (f.type === 'source') continue;
    const ranges = f.segments.flatMap((s) =>
      s.kind === 'range' ? [{ start: s.start, end: s.end }] : [],
    );
    if (ranges.length === 0) continue;
    out.push({
      name: f.name === '' ? f.type : f.name,
      type: f.type,
      strand: f.strand,
      colour: featureColor(f),
      ranges,
      orf: false,
    });
  }
  for (const o of orfs) {
    out.push({
      name: `ORF ${o.codons.toLocaleString()} aa`,
      type: 'ORF',
      strand: o.strand,
      colour: ORF_COLOUR,
      ranges: [{ start: o.range.start, end: o.range.end }],
      orf: true,
    });
  }
  return out;
}
