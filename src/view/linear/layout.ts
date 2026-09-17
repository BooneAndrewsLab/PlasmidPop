/**
 * Geometry of the linear sequence view: the sequence is broken into rows of
 * `basesPerRow` bases; every row shows a ruler, the forward strand,
 * optionally the complement, and as many feature lanes as it needs. Pure
 * functions so the maths is unit-testable without a canvas.
 */

export interface LinearMetrics {
  readonly basesPerRow: number;
  readonly charWidth: number;
  /** Height of one text line (forward or complement strand). */
  readonly lineHeight: number;
  readonly showComplement: boolean;
  readonly rulerHeight: number;
  readonly laneHeight: number;
  /** Vertical space after the last lane of a row. */
  readonly rowGap: number;
  /** Space reserved on the left for position numbers. */
  readonly leftGutter: number;
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
  readonly lanes: number;
}

export type Hit =
  | { readonly kind: 'boundary'; readonly position: number; readonly row: RowLayout }
  | {
      readonly kind: 'lane';
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
  ) {
    const rows: RowLayout[] = [];
    const rowCount = Math.max(1, Math.ceil(seqLength / metrics.basesPerRow));
    let y = metrics.topPadding;
    for (let i = 0; i < rowCount; i++) {
      const lanes = lanesPerRow[i] ?? 0;
      const height = this.baseBlockHeight() + lanes * metrics.laneHeight + metrics.rowGap;
      rows.push({
        index: i,
        start: i * metrics.basesPerRow,
        end: Math.min(seqLength, (i + 1) * metrics.basesPerRow),
        top: y,
        height,
        lanes,
      });
      y += height;
    }
    this.rows = rows;
    this.totalHeight = y;
  }

  /** Ruler + strands, before any feature lane. */
  baseBlockHeight(): number {
    const m = this.metrics;
    return m.rulerHeight + m.lineHeight * (m.showComplement ? 2 : 1);
  }

  forwardTextTop(row: RowLayout): number {
    return row.top + this.metrics.rulerHeight;
  }

  complementTextTop(row: RowLayout): number {
    return row.top + this.metrics.rulerHeight + this.metrics.lineHeight;
  }

  laneTop(row: RowLayout, lane: number): number {
    return row.top + this.baseBlockHeight() + lane * this.metrics.laneHeight;
  }

  xOfColumn(column: number): number {
    return this.metrics.leftGutter + column * this.metrics.charWidth;
  }

  rowOfPosition(position: number): RowLayout | undefined {
    if (position < 0) return undefined;
    const index = Math.min(this.rows.length - 1, Math.floor(position / this.metrics.basesPerRow));
    return this.rows[index];
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
   * gap between bases, for placing a caret or a selection edge), a feature
   * lane, or nothing.
   */
  hitTest(x: number, y: number): Hit {
    const row = this.rowAtY(y);
    if (row === undefined) return { kind: 'none' };
    const m = this.metrics;
    const column = (x - m.leftGutter) / m.charWidth;
    const rowLength = row.end - row.start;
    const inLanes = y >= this.laneTop(row, 0) && row.lanes > 0 && y < this.laneTop(row, row.lanes);
    if (inLanes) {
      const lane = Math.floor((y - this.laneTop(row, 0)) / m.laneHeight);
      const position = row.start + Math.min(rowLength - 1, Math.max(0, Math.floor(column)));
      return { kind: 'lane', row, lane, position };
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
