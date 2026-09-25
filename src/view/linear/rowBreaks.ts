import { type BaseStyles } from '@/core';

/**
 * Where the rows of the linear view break (#91).
 *
 * Every row holds `basesPerRow` bases, except where bases are drawn larger
 * than the rest: a larger base takes more of the row's width, so a row
 * holding some holds fewer bases and the rows after it start where it
 * stopped. Rows are filled like the lines of a paragraph, never wider than
 * `basesPerRow` ordinary bases, and always with at least one base.
 *
 * Kept apart from the layout because everything that counts per row — the
 * feature lanes, translation lines and preview lanes a row needs — has to
 * know the rows before the layout can be built from those counts.
 */

/** A stretch of bases drawn `size` times as wide as an ordinary one. */
export interface SizedRun {
  readonly start: number;
  readonly end: number;
  readonly size: number;
}

export interface RowSpan {
  readonly start: number;
  readonly end: number;
  /** The largest size in the row, 1 when all its bases are ordinary. */
  readonly scale: number;
  /** The row's larger bases, clipped to it; empty when there are none. */
  readonly sized: readonly SizedRun[];
}

const NONE: readonly SizedRun[] = [];

/** The runs of `styles` that change a base's size, for `RowBreaks`. */
export function sizedRuns(styles: BaseStyles): SizedRun[] {
  const out: SizedRun[] = [];
  for (const run of styles.runs) {
    const size = run.style.size;
    if (size === undefined) continue;
    const last = out[out.length - 1];
    if (last?.end === run.start && last.size === size) {
      out[out.length - 1] = { start: last.start, end: run.end, size };
    } else out.push({ start: run.start, end: run.end, size });
  }
  return out;
}

export class RowBreaks {
  readonly rows: readonly RowSpan[];
  /** True when every row is `basesPerRow` long, so a position's row is a division away. */
  private readonly uniform: boolean;

  constructor(
    readonly seqLength: number,
    readonly basesPerRow: number,
    sized: readonly SizedRun[] = NONE,
  ) {
    this.uniform = sized.length === 0;
    const rows: RowSpan[] = [];
    if (this.uniform) {
      const count = Math.max(1, Math.ceil(seqLength / basesPerRow));
      for (let i = 0; i < count; i++) {
        rows.push({
          start: i * basesPerRow,
          end: Math.min(seqLength, (i + 1) * basesPerRow),
          scale: 1,
          sized: NONE,
        });
      }
    } else {
      let next = 0; // first sized run that may still reach the current row
      let start = 0;
      do {
        while ((sized[next]?.end ?? Infinity) <= start) next++;
        const plainEnd = Math.min(seqLength, start + basesPerRow);
        const first = sized[next];
        if (first === undefined || first.start >= plainEnd) {
          rows.push({ start, end: plainEnd, scale: 1, sized: NONE });
          start = plainEnd;
          continue;
        }
        // Base by base from here: the row takes bases while they fit.
        const inRow: SizedRun[] = [];
        let used = 0;
        let p = start;
        let r = next;
        while (p < seqLength) {
          while ((sized[r]?.end ?? Infinity) <= p) r++;
          const run = sized[r];
          const inside = run !== undefined && run.start <= p;
          const width = inside ? run.size : 1;
          if (p > start && used + width > basesPerRow + 1e-9) break;
          used += width;
          if (inside) {
            const last = inRow[inRow.length - 1];
            if (last?.end === p && last.size === width) {
              inRow[inRow.length - 1] = { start: last.start, end: p + 1, size: width };
            } else inRow.push({ start: p, end: p + 1, size: width });
          }
          p++;
        }
        const scale = inRow.reduce((m, s) => Math.max(m, s.size), 1);
        rows.push({ start, end: p, scale, sized: inRow });
        start = p;
      } while (start < seqLength);
    }
    this.rows = rows;
  }

  /** Index of the row holding base `position` (the last row for the end). */
  rowOf(position: number): number {
    const last = this.rows.length - 1;
    if (position <= 0) return 0;
    if (this.uniform) return Math.min(last, Math.floor(position / this.basesPerRow));
    let lo = 0;
    let hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((this.rows[mid]?.start ?? 0) <= position) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

/** Breaks for plain rows of `basesPerRow`, or the ones given. */
export function rowBreaksOf(seqLength: number, breaks: number | RowBreaks): RowBreaks {
  return typeof breaks === 'number' ? new RowBreaks(seqLength, breaks) : breaks;
}
