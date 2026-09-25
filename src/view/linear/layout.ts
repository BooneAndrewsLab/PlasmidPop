import { type RowBreaks, type SizedRun, rowBreaksOf } from './rowBreaks';

/**
 * Geometry of the linear sequence view: the sequence is broken into rows of
 * `basesPerRow` bases; every row shows a ruler, a sequencing read's trace
 * when the document has one, the forward strand,
 * optionally the complement, one translation line per coding feature that
 * touches it, and as many feature lanes as it needs. Pure functions so the
 * maths is unit-testable without a canvas.
 *
 * Bases drawn larger (#91) take more of a row's width, so such a row holds
 * fewer bases (`RowBreaks`), and its strands are as much taller as its
 * largest base. Every horizontal position in a row therefore comes from
 * `xOf(row, position)`, never from a column times `charWidth`.
 */

export interface LinearMetrics {
  readonly basesPerRow: number;
  readonly charWidth: number;
  /** Height of one text line (forward or complement strand). */
  readonly lineHeight: number;
  readonly showComplement: boolean;
  readonly rulerHeight: number;
  /** Height of the chromatogram above the strands; 0 without one. */
  readonly traceHeight: number;
  readonly laneHeight: number;
  /** Height of one amino-acid line drawn under the strands. */
  readonly translationHeight: number;
  /** Height of one preview-overlay lane, drawn outside the feature lanes. */
  readonly overlayHeight: number;
  /** Vertical space after the last lane of a row. */
  readonly rowGap: number;
  /** Space reserved on the left for position numbers. */
  readonly leftGutter: number;
  /**
   * Space reserved after the last column, for the bottom-strand overhang of
   * a sticky end and so the last base is not against the edge.
   */
  readonly rightGutter: number;
  readonly topPadding: number;
}

export interface RowLayout {
  readonly index: number;
  /** First base (0-based) of the row. */
  readonly start: number;
  /** One past the last base of the row. */
  readonly end: number;
  readonly top: number;
  readonly height: number;
  /** Translation lines drawn between the strands and the feature lanes. */
  readonly translations: number;
  readonly lanes: number;
  /** Preview lanes drawn outside the feature lanes. */
  readonly overlays: number;
  /** How much taller than ordinary the strands are: the size of the row's largest base. */
  readonly scale: number;
  /** The row's larger bases; empty in a row of ordinary ones. */
  readonly sized: readonly SizedRun[];
}

export type Hit =
  | { readonly kind: 'boundary'; readonly position: number; readonly row: RowLayout }
  | {
      readonly kind: 'lane';
      readonly row: RowLayout;
      readonly lane: number;
      readonly position: number;
    }
  | {
      readonly kind: 'translation';
      readonly row: RowLayout;
      readonly line: number;
      readonly position: number;
    }
  | {
      readonly kind: 'overlay';
      readonly row: RowLayout;
      readonly lane: number;
      readonly position: number;
    }
  | { readonly kind: 'none' };

export class LinearLayout {
  readonly rows: readonly RowLayout[];
  readonly totalHeight: number;

  constructor(
    readonly seqLength: number,
    readonly metrics: LinearMetrics,
    lanesPerRow: readonly number[],
    translationsPerRow: readonly number[] = [],
    overlaysPerRow: readonly number[] = [],
    breaks: RowBreaks = rowBreaksOf(seqLength, metrics.basesPerRow),
  ) {
    this.breaks = breaks;
    const rows: RowLayout[] = [];
    let y = metrics.topPadding;
    for (let i = 0; i < breaks.rows.length; i++) {
      const span = breaks.rows[i];
      if (span === undefined) break;
      const lanes = lanesPerRow[i] ?? 0;
      const translations = translationsPerRow[i] ?? 0;
      const overlays = overlaysPerRow[i] ?? 0;
      const height =
        this.baseBlockHeight(span) +
        translations * metrics.translationHeight +
        lanes * metrics.laneHeight +
        overlays * metrics.overlayHeight +
        metrics.rowGap;
      rows.push({
        index: i,
        start: span.start,
        end: span.end,
        top: y,
        height,
        translations,
        lanes,
        overlays,
        scale: span.scale,
        sized: span.sized,
      });
      y += height;
    }
    this.rows = rows;
    this.totalHeight = y;
  }

  /** Ruler, trace and strands, before any feature lane. */
  baseBlockHeight(row?: { readonly scale: number }): number {
    const m = this.metrics;
    return m.rulerHeight + m.traceHeight + this.strandsHeight(row);
  }

  /** Height of one strand's line of bases in `row`: taller where its bases are larger. */
  lineHeight(row?: { readonly scale: number }): number {
    return Math.round(this.metrics.lineHeight * (row?.scale ?? 1));
  }

  /** The forward strand, and the complement under it when shown. */
  strandsHeight(row?: { readonly scale: number }): number {
    const m = this.metrics;
    return this.lineHeight(row) * (m.showComplement ? 2 : 1);
  }

  /** Top of the chromatogram, between the ruler and the strands. */
  traceTop(row: RowLayout): number {
    return row.top + this.metrics.rulerHeight;
  }

  forwardTextTop(row: RowLayout): number {
    return row.top + this.metrics.rulerHeight + this.metrics.traceHeight;
  }

  complementTextTop(row: RowLayout): number {
    return this.forwardTextTop(row) + this.lineHeight(row);
  }

  /** Where the letters of a strand line starting at `top` sit, whatever their size. */
  textBaseline(row: RowLayout, top: number): number {
    return top + this.lineHeight(row) * 0.75;
  }

  /** Top of translation line `line` (0 = directly under the strands). */
  translationTop(row: RowLayout, line: number): number {
    return row.top + this.baseBlockHeight(row) + line * this.metrics.translationHeight;
  }

  laneTop(row: RowLayout, lane: number): number {
    return this.translationTop(row, row.translations) + lane * this.metrics.laneHeight;
  }

  /** Top of preview lane `lane`, beyond the last feature lane of the row. */
  overlayTop(row: RowLayout, lane: number): number {
    return this.laneTop(row, row.lanes) + lane * this.metrics.overlayHeight;
  }

  /** Where the rows break, which the per-row counts were made from. */
  readonly breaks: RowBreaks;

  /**
   * Left edge of column `column` of a row of ordinary bases. Only for rows
   * known to have no larger base (and for the gutter to the left of a row);
   * anything in a row of the document uses `xOf`.
   */
  xOfColumn(column: number): number {
    return this.metrics.leftGutter + column * this.metrics.charWidth;
  }

  /**
   * Left edge of base `position` in `row` — the boundary before it, so
   * `row.end` is the right edge of the row's last base. Positions outside
   * the row carry on at the ordinary width, for a sticky end drawn past it.
   */
  xOf(row: RowLayout, position: number): number {
    let columns = position - row.start;
    for (const run of row.sized) {
      if (run.start >= position) break;
      columns += (Math.min(position, run.end) - run.start) * (run.size - 1);
    }
    return this.metrics.leftGutter + columns * this.metrics.charWidth;
  }

  /** How wide base `position` of `row` is drawn. */
  widthOf(row: RowLayout, position: number): number {
    for (const run of row.sized) {
      if (run.start > position) break;
      if (position < run.end) return run.size * this.metrics.charWidth;
    }
    return this.metrics.charWidth;
  }

  /**
   * The base boundary nearest `x` in `row` as a fractional offset from
   * `row.start`: the inverse of `xOf`, for hit testing. Clamped to the row.
   */
  offsetAtX(row: RowLayout, x: number): number {
    const m = this.metrics;
    const target = (x - m.leftGutter) / m.charWidth;
    if (row.sized.length === 0) return target;
    let columns = 0;
    let position = row.start;
    for (const run of row.sized) {
      const plain = run.start - position;
      if (target < columns + plain) return position - row.start + (target - columns);
      columns += plain;
      const wide = (run.end - run.start) * run.size;
      if (target < columns + wide) {
        return run.start - row.start + (target - columns) / run.size;
      }
      columns += wide;
      position = run.end;
    }
    return position - row.start + (target - columns);
  }

  /**
   * The position straight above (`-1`) or below (`1`) `position`, in the
   * row before or after its own: where the caret goes on an arrow key.
   * Past the first or last row it is a row's worth of bases on, for the
   * caller to clamp.
   */
  positionInRowBeside(position: number, direction: -1 | 1): number {
    const row = this.rowOfPosition(position);
    const target = row === undefined ? undefined : this.rows[row.index + direction];
    if (row === undefined || target === undefined) {
      return position + direction * this.metrics.basesPerRow;
    }
    const offset = Math.round(this.offsetAtX(target, this.xOf(row, position)));
    return target.start + Math.min(target.end - target.start, Math.max(0, offset));
  }

  rowOfPosition(position: number): RowLayout | undefined {
    if (position < 0) return undefined;
    return this.rows[this.breaks.rowOf(position)];
  }

  /** Row containing vertical coordinate `y` (document space), by binary search. */
  rowAtY(y: number): RowLayout | undefined {
    let lo = 0;
    let hi = this.rows.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const row = this.rows[mid];
      if (row === undefined) return undefined;
      if (y < row.top) hi = mid - 1;
      else if (y >= row.top + row.height) lo = mid + 1;
      else return row;
    }
    return undefined;
  }

  /** Rows that intersect the vertical window `[top, bottom)`. */
  rowsInWindow(top: number, bottom: number): RowLayout[] {
    const out: RowLayout[] = [];
    let index = this.rowAtY(Math.max(top, this.metrics.topPadding))?.index;
    if (index === undefined) {
      if (top < this.metrics.topPadding) index = 0;
      else return out;
    }
    for (let i = index; i < this.rows.length; i++) {
      const row = this.rows[i];
      if (row === undefined || row.top >= bottom) break;
      out.push(row);
    }
    return out;
  }

  /**
   * What is under document-space point (x, y): a base boundary (the nearest
   * gap between bases, for placing a caret or a selection edge), a
   * translation line, a feature lane, or nothing.
   */
  hitTest(x: number, y: number): Hit {
    const row = this.rowAtY(y);
    if (row === undefined) return { kind: 'none' };
    const m = this.metrics;
    const column = this.offsetAtX(row, x);
    const rowLength = row.end - row.start;
    const baseAt = row.start + Math.min(rowLength - 1, Math.max(0, Math.floor(column)));
    const translationsTop = this.translationTop(row, 0);
    if (row.translations > 0 && y >= translationsTop && y < this.laneTop(row, 0)) {
      const line = Math.floor((y - translationsTop) / m.translationHeight);
      return { kind: 'translation', row, line, position: baseAt };
    }
    const inLanes = y >= this.laneTop(row, 0) && row.lanes > 0 && y < this.laneTop(row, row.lanes);
    if (inLanes) {
      const lane = Math.floor((y - this.laneTop(row, 0)) / m.laneHeight);
      return { kind: 'lane', row, lane, position: baseAt };
    }
    const overlayTop = this.overlayTop(row, 0);
    if (row.overlays > 0 && y >= overlayTop && y < this.overlayTop(row, row.overlays)) {
      const lane = Math.floor((y - overlayTop) / m.overlayHeight);
      return { kind: 'overlay', row, lane, position: baseAt };
    }
    const boundary = Math.min(rowLength, Math.max(0, Math.round(column)));
    return { kind: 'boundary', position: row.start + boundary, row };
  }
}

/** Largest multiple of 10 (at least 10) that fits in `availableWidth`. */
export function basesPerRowFor(availableWidth: number, charWidth: number): number {
  const raw = Math.floor(availableWidth / charWidth);
  return Math.max(10, Math.floor(raw / 10) * 10);
}

/** The sizes the view offers, in px of the monospace strand text. */
export const FONT_SIZES = [11, 13, 16] as const;
export type FontSize = (typeof FONT_SIZES)[number];
/** The size every other measurement below is expressed as a fraction of. */
export const DEFAULT_FONT_SIZE: FontSize = 13;

export function isFontSize(n: unknown): n is FontSize {
  return typeof n === 'number' && (FONT_SIZES as readonly number[]).includes(n);
}

export interface MetricsOptions {
  /** Size of the strand text; every other dimension scales with it. */
  readonly fontSize: number;
  readonly basesPerRow: number;
  /** Advance width of one character, measured by the caller in its own context. */
  readonly charWidth: number;
  readonly showComplement: boolean;
  /** Whether room is kept above the strands for enzyme labels. */
  readonly cutSiteLabels: boolean;
  /**
   * How much room is kept above the strands for a sequencing read's trace:
   * none, the 64 px it has always had at the default size, or twice that (#55).
   */
  readonly trace?: 'short' | 'tall' | false;
  /** Extra space before the first column, for a sticky end hanging off the left. */
  readonly extraLeftGutter?: number;
  /** Extra space after the last column, for a sticky end hanging off the right. */
  readonly extraRightGutter?: number;
}

/**
 * The row geometry for a font size. All the vertical measurements and the
 * gutter are proportional to the text, so a larger size gives a roomier view
 * rather than crowded lanes; at the default size they are the numbers the
 * view has always used.
 */
export function linearMetrics(o: MetricsOptions): LinearMetrics {
  const scale = o.fontSize / DEFAULT_FONT_SIZE;
  const at = (atDefault: number): number => Math.round(atDefault * scale);
  return {
    basesPerRow: o.basesPerRow,
    charWidth: o.charWidth,
    lineHeight: at(18),
    showComplement: o.showComplement,
    rulerHeight: o.cutSiteLabels ? at(30) : at(16),
    traceHeight: o.trace === 'tall' ? at(128) : o.trace === 'short' ? at(64) : 0,
    laneHeight: at(20),
    translationHeight: at(16),
    overlayHeight: at(18),
    rowGap: at(14),
    leftGutter: at(72) + (o.extraLeftGutter ?? 0),
    rightGutter: at(24) + (o.extraRightGutter ?? 0),
    topPadding: 12,
  };
}

/** Width of the whole view: gutter, columns, gutter. */
export function linearWidth(m: LinearMetrics): number {
  return m.leftGutter + m.basesPerRow * m.charWidth + m.rightGutter;
}
