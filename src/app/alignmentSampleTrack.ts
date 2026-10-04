import type { Feature } from '@/core';

import type { StackRow } from './alignmentStack';
import { annotationsOf, packTrack, type ColumnSpan, type Track } from './alignmentTrack';

/**
 * A sample's own features drawn under its row in the large view (#128).
 * When a sample is a document with features (an open tab, a GenBank file)
 * they are mapped through its alignment onto the stack's columns, so a
 * feature the sample carries somewhere else than the reference does, or
 * one it lacks, shows against the reference's track above.
 *
 * The features are in the sample's own coordinates, along it as given. The
 * row numbers its bases along the read as shown, which for a sample that
 * aligned reversed is its reverse complement; a feature is turned the same
 * way, its strand with it.
 */

/** What a sample brings to draw on its row. */
export interface SampleFeatures {
  readonly features: readonly Feature[];
  /** Whether the sample is a circle, so a feature may run through its origin. */
  readonly circular: boolean;
}

/** Lanes of a sample's own features under its row; more are left out and counted. */
export const MAX_SAMPLE_LANES = 3;

/**
 * For each of the sample's bases in the row, the column it sits in: entry
 * `k` is the base `start + k` in the read's numbering as shown.
 */
export function sampleColumns(row: StackRow): {
  readonly start: number;
  readonly columns: Int32Array;
} {
  const { alignment, offsetB } = row.result;
  const columns: number[] = [];
  for (let c = row.firstColumn; c < row.endColumn; c++) {
    const ch = row.bases.charAt(c);
    if (ch !== '-' && ch !== ' ') columns.push(c);
  }
  return { start: alignment.startB + offsetB, columns: Int32Array.from(columns) };
}

/**
 * The sample's features on the row's columns, packed into lanes. Only the
 * part of a feature the sample aligned over is drawn (a trimmed end or an
 * unaligned stretch has no columns); a feature with no aligned base is
 * left out, so it does not take a lane.
 */
export function buildSampleTrack(row: StackRow, sample: SampleFeatures, maxLanes: number): Track {
  const { start, columns } = sampleColumns(row);
  const length = row.result.readLength;
  const reverse = row.result.strand === 'reverse';
  const shifts = sample.circular && length > 0 ? [-length, 0, length] : [0];
  const mapped = annotationsOf(sample.features, []).map((a) => {
    const spans: ColumnSpan[] = [];
    for (const range of a.ranges) {
      // Along the reverse complement, a range is mirrored.
      const from0 = reverse ? length - range.end : range.start;
      const to0 = reverse ? length - range.start : range.end;
      for (const shift of shifts) {
        const from = Math.max(start, from0 + shift);
        const to = Math.min(start + columns.length, to0 + shift);
        if (to <= from) continue;
        const first = columns[from - start];
        const last = columns[to - 1 - start];
        if (first === undefined || last === undefined) continue;
        spans.push({ start: first, end: last + 1 });
      }
    }
    spans.sort((x, y) => x.start - y.start);
    const annotation = reverse
      ? { ...a, strand: a.strand === 'forward' ? ('reverse' as const) : ('forward' as const) }
      : a;
    return { annotation, spans };
  });
  return packTrack(mapped, maxLanes);
}
