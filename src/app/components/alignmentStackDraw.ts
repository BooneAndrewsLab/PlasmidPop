import type { DrawingContext } from '@/view/drawingContext';
import { sansFontOf } from '@/view/linear';
import { drawTrace, type TraceBaseAt } from '@/view/trace';
import { contrastingText } from '@/view/featureColors';

import {
  Change,
  codonSpan,
  residueOf,
  type ChangeValue,
  type ResidueFrame,
} from '../alignmentResidues';
import { Cell, columnPosition, isDifference, type Stack, type StackRow } from '../alignmentStack';
import { ColumnClass, type Track } from '../alignmentTrack';
import { readLinearTheme } from './linearTheme';

export const FONT_SIZE = 13;
export const ROW_HEIGHT = 20;
export const RULER_HEIGHT = 18;
/** One lane of the feature track. */
export const LANE_HEIGHT = 16;
export const NAME_WIDTH = 168;
export const OVERVIEW_HEIGHT = 44;
/** The coverage band under the overview's marks (#120). */
export const COVERAGE_HEIGHT = 6;
/** The chromatogram under a read's row (#110). */
export const TRACE_HEIGHT = 40;
/** The amino-acid strip under the reference's row and under each sample's. */
export const AA_HEIGHT = 16;

/**
 * What the stack's drawing needs of a context: the shared drawing subset and
 * the canvas's alpha and clipping, which `SvgContext` also provides, so the
 * window and the SVG export go through one drawing path (#126).
 */
export interface StackContext extends DrawingContext {
  globalAlpha: number;
  rect(x: number, y: number, w: number, h: number): void;
  clip(): void;
}

export interface Colours {
  readonly ink: string;
  readonly muted: string;
  readonly line: string;
  readonly background: string;
  readonly bases: Readonly<Record<string, string>>;
  readonly other: string;
  /** Difference colours by `ColumnClass`. */
  readonly byClass: readonly [string, string, string];
  readonly accent: string;
  readonly trace: {
    readonly a: string;
    readonly c: string;
    readonly g: string;
    readonly t: string;
    readonly quality: string;
  };
}

export function readColours(el: HTMLElement): Colours {
  const t = readLinearTheme(el);
  const css = getComputedStyle(el);
  return {
    ink: t.ink,
    muted: t.inkMuted,
    line: t.rulerLine,
    background: t.background,
    bases: {
      A: t.baseColors.a,
      C: t.baseColors.c,
      G: t.baseColors.g,
      T: t.baseColors.t,
      U: t.baseColors.t,
    },
    other: t.baseColors.other,
    byClass: [
      css.getPropertyValue('--diff-none').trim() || '#6b7280',
      css.getPropertyValue('--diff-feature').trim() || '#1f5fd0',
      css.getPropertyValue('--diff-cds').trim() || '#d81b3c',
    ],
    accent: css.getPropertyValue('--accent').trim() || t.caret,
    trace: { ...t.baseColors, quality: t.traceQuality },
  };
}

/** The colour of a column's class. */
export function classColour(c: Colours, k: number): string {
  return c.byClass[k] ?? c.byClass[ColumnClass.None];
}

/**
 * Paints a cell that differs: the class colour behind it, and a mark that
 * tells the kinds apart without it. A mismatch is a plain block, a deletion
 * has a bar along its foot, an insertion one along its head; an ambiguity
 * match is the lightest block.  */
function paintDifference(
  ctx: StackContext,
  cell: number,
  colour: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  if (cell === Cell.Ambiguous) {
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, width, height);
  } else if (isDifference(cell)) {
    ctx.globalAlpha = 0.34;
    ctx.fillStyle = colour;
    ctx.fillRect(x, y, width, height);
    if (cell !== Cell.Mismatch) {
      ctx.globalAlpha = 1;
      ctx.fillRect(x, cell === Cell.Deletion ? y + height - 3 : y, width, 3);
    }
  }
  ctx.globalAlpha = 1;
}

/** The feature track: bars with arrows for strand, names kept in view, ORFs outlined. */
function drawTrack(
  g: StackContext,
  t: Track,
  colours: Colours,
  monoFont: string,
  firstColumn: number,
  lastColumn: number,
  xOf: (column: number) => number,
): void {
  g.font = sansFontOf(FONT_SIZE - 1);
  g.textBaseline = 'middle';
  const barHeight = LANE_HEIGHT - 3;
  for (const item of t.items) {
    if (item.end <= firstColumn || item.start >= lastColumn) continue;
    const { annotation: a } = item;
    const y = RULER_HEIGHT + item.lane * LANE_HEIGHT + 1;
    let labelled = false;
    // The pieces of a join are tied by a line through the gaps.
    for (let k = 1; k < item.spans.length; k++) {
      const before = item.spans[k - 1];
      const after = item.spans[k];
      if (before === undefined || after === undefined) continue;
      g.strokeStyle = a.colour;
      g.beginPath();
      g.moveTo(xOf(before.end), y + barHeight / 2);
      g.lineTo(xOf(after.start), y + barHeight / 2);
      g.stroke();
    }
    for (const span of item.spans) {
      if (span.end <= firstColumn || span.start >= lastColumn) continue;
      const left = xOf(span.start);
      const right = xOf(span.end);
      const point = Math.min(6, (right - left) / 2);
      g.beginPath();
      if (a.strand === 'forward') {
        g.moveTo(left, y);
        g.lineTo(right - point, y);
        g.lineTo(right, y + barHeight / 2);
        g.lineTo(right - point, y + barHeight);
        g.lineTo(left, y + barHeight);
      } else {
        g.moveTo(right, y);
        g.lineTo(left + point, y);
        g.lineTo(left, y + barHeight / 2);
        g.lineTo(left + point, y + barHeight);
        g.lineTo(right, y + barHeight);
      }
      g.closePath();
      if (a.orf) {
        g.globalAlpha = 0.16;
        g.fillStyle = a.colour;
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = a.colour;
        g.lineWidth = 1.5;
        g.setLineDash([4, 2]);
        g.stroke();
        g.setLineDash([]);
        g.lineWidth = 1;
      } else {
        g.fillStyle = a.colour;
        g.fill();
      }
      // The name starts at the visible edge, so a long feature stays labelled while scrolled.
      const from = Math.max(left, NAME_WIDTH) + 4;
      const room = right - from - point;
      if (!labelled && room > 24) {
        g.save();
        g.beginPath();
        g.rect(from, y, room, barHeight);
        g.clip();
        g.fillStyle = a.orf ? colours.ink : contrastingText(a.colour);
        g.fillText(a.name, from, y + barHeight / 2 + 0.5);
        g.restore();
        labelled = true;
      }
    }
  }
  g.font = monoFont;
}

/**
 * The stacked alignment (#103): a ruler and the reference pinned at the top,
 * each sample a row under it, names pinned at the left, one scroller for all.
 * Canvas 2D, and only the columns and rows in view are drawn, so a 10 kb
 * reference with 96 reads costs what fits the window. Above it an overview
 * spans every column in one width, marking each difference and the stretch
 * now in view; a click or drag on it moves the view.
 */
/**
 * The amino acids of each CDS frame in view, one letter centred over its
 * codon's columns: the reference's own when `row` is null, else what the
 * sample's bases make of the codon, tinted by how it differs.
 */
function drawResidues(
  ctx: StackContext,
  frames: readonly ResidueFrame[],
  colours: Colours,
  font: string,
  first: number,
  last: number,
  x: (column: number) => number,
  charWidth: number,
  top: number,
  row: StackRow | null,
): void {
  ctx.font = font;
  ctx.textAlign = 'center';
  for (const frame of frames) {
    if (frame.end <= first || frame.start >= last) continue;
    for (const codon of frame.codons) {
      const { start, end } = codonSpan(codon);
      if (end <= first || start >= last) continue;
      const residue =
        row === null
          ? { letter: codon.reference, change: Change.Same as ChangeValue }
          : residueOf(frame, codon, row);
      if (residue.change === Change.Blank) continue;
      const left = x(start);
      const width = (end - start) * charWidth;
      const loud = residue.change >= Change.Missense;
      ctx.globalAlpha = loud ? 0.35 : residue.change === Change.Synonymous ? 0.14 : 0.07;
      ctx.fillStyle = loud ? colours.byClass[2] : colours.accent;
      ctx.fillRect(left + 1, top + 1, width - 2, AA_HEIGHT - 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = loud ? colours.ink : colours.muted;
      ctx.fillText(residue.letter, left + width / 2, top + AA_HEIGHT / 2);
    }
  }
  ctx.textAlign = 'left';
}

/** The vertical layout of the stack: pinned header, then each row with its strips. */
export interface StackLayout {
  readonly trackHeight: number;
  readonly aaHeight: number;
  readonly headerHeight: number;
  /** Each row's top below the header, and a last entry for the total. */
  readonly tops: readonly number[];
  readonly rowsHeight: number;
  readonly contentHeight: number;
}

export function stackLayout(
  stack: Stack,
  track: Track | null,
  hasResidues: boolean,
  showTrace: boolean,
): StackLayout {
  const trackHeight = track === null ? 0 : track.lanes * LANE_HEIGHT + (track.lanes > 0 ? 4 : 0);
  const aaHeight = hasResidues ? AA_HEIGHT : 0;
  const headerHeight = RULER_HEIGHT + trackHeight + ROW_HEIGHT + aaHeight;
  const tops = new Array<number>(stack.rows.length + 1);
  let y = 0;
  stack.rows.forEach((row, r) => {
    tops[r] = y;
    y += ROW_HEIGHT + aaHeight + (showTrace && row.readIndex !== null ? TRACE_HEIGHT : 0);
  });
  tops[stack.rows.length] = y;
  return {
    trackHeight,
    aaHeight,
    headerHeight,
    tops,
    rowsHeight: y,
    contentHeight: headerHeight + y,
  };
}

/** The row under `y` below the header, or -1. */
export function rowAtOffset(layout: StackLayout, rows: number, y: number): number {
  if (y < 0 || y >= layout.rowsHeight) return -1;
  let lo = 0;
  let hi = rows - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((layout.tops[mid] ?? 0) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface StackDrawing {
  readonly stack: Stack;
  readonly referenceName: string;
  readonly confidentFrom: number;
  readonly selectedRow: number | null;
  readonly track: Track | null;
  readonly classes: Uint8Array | null;
  readonly disagreement: readonly number[];
  readonly disagreeing: ReadonlySet<number>;
  readonly showTrace: boolean;
  readonly residues: readonly ResidueFrame[] | null;
  readonly marked: { readonly start: number; readonly end: number } | null;
  readonly colours: Colours;
  readonly charWidth: number;
  readonly monoFont: string;
  readonly layout: StackLayout;
}

/** The part of the content drawn: `left` and `top` are content offsets, `width` and `height` the size of the picture. */
export interface StackView {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Draws the stack as seen through `view`: the columns clipped to slide under
 * the names, the ruler, feature track and reference pinned above the rows,
 * the names pinned left. The window calls it for the part in view; the
 * export for a whole range, scrolled to its first column.
 */
export function drawStack(ctx: StackContext, d: StackDrawing, view: StackView): void {
  const {
    stack,
    referenceName,
    confidentFrom,
    selectedRow,
    track,
    classes,
    disagreement,
    disagreeing,
    showTrace,
    residues,
    marked,
    colours,
    charWidth,
    monoFont,
    layout,
  } = d;
  const { headerHeight, trackHeight, aaHeight, tops } = layout;
  const rowAt = (y: number): number => rowAtOffset(layout, stack.rows.length, y);
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, view.width, view.height);
  ctx.textBaseline = 'middle';

  const first = Math.max(0, Math.floor(view.left / charWidth + 1e-6));
  const last = Math.min(
    stack.columns,
    Math.ceil((view.left + view.width - NAME_WIDTH) / charWidth - 1e-6),
  );
  const x = (c: number): number => NAME_WIDTH + c * charWidth - view.left;
  const firstRow = Math.max(0, rowAt(view.top));
  const lastRow = Math.min(
    stack.rows.length,
    rowAt(view.top + view.height - headerHeight) + 1 || stack.rows.length,
  );
  const rowHeightOf = (r: number): number => (tops[r + 1] ?? 0) - (tops[r] ?? 0);

  // The columns, clipped so they slide under the names.
  ctx.save();
  ctx.beginPath();
  ctx.rect(NAME_WIDTH, 0, view.width - NAME_WIDTH, view.height);
  ctx.clip();

  if (marked !== null && marked.end > first && marked.start < last) {
    ctx.fillStyle = colours.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x(marked.start), 0, (marked.end - marked.start) * charWidth, view.height);
    ctx.globalAlpha = 1;
  }

  // Columns where samples disagree with each other: a faint tint down the column (#124).
  if (disagreement.length > 0) {
    ctx.fillStyle = colours.ink;
    ctx.globalAlpha = 0.08;
    for (let c = first; c < last; c++) {
      if (disagreeing.has(c)) ctx.fillRect(x(c), 0, charWidth, view.height);
    }
    ctx.globalAlpha = 1;
  }

  ctx.font = monoFont;
  const drawText = (text: string, c: number, y: number, fill: string, alpha = 1): void => {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    ctx.fillText(text, x(c), y);
  };
  const baseColour = (ch: string): string => colours.bases[ch] ?? colours.other;

  for (let r = firstRow; r < lastRow; r++) {
    const row = stack.rows[r];
    if (row === undefined) continue;
    const y = headerHeight + (tops[r] ?? 0) - view.top;
    if (y + rowHeightOf(r) < headerHeight) continue;
    if (r === selectedRow) {
      ctx.fillStyle = colours.accent;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(NAME_WIDTH, y, view.width - NAME_WIDTH, rowHeightOf(r));
      ctx.globalAlpha = 1;
    }
    const from = Math.max(first, row.firstColumn);
    const to = Math.min(last, row.endColumn);
    for (let c = from; c < to; c++) {
      const cell = row.cells[c] ?? Cell.Blank;
      paintDifference(
        ctx,
        cell,
        classColour(colours, classes?.[c] ?? ColumnClass.None),
        x(c),
        y,
        charWidth,
        ROW_HEIGHT,
      );
      const ch = row.bases.charAt(c);
      const q = row.qualities?.[c];
      const poor = q !== undefined && !Number.isNaN(q) && q < confidentFrom;
      if (poor && ch !== '-') {
        // A poor base sits on a grey block, whatever else is behind it.
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = colours.muted;
        ctx.fillRect(x(c), y, charWidth, ROW_HEIGHT);
        ctx.globalAlpha = 1;
      }
      drawText(
        ch,
        c,
        y + ROW_HEIGHT / 2,
        ch === '-' ? colours.muted : baseColour(ch),
        cell === Cell.Padding ? 0.3 : poor ? 0.4 : 1,
      );
    }
    ctx.globalAlpha = 1;
    if (residues !== null && aaHeight > 0) {
      drawResidues(
        ctx,
        residues,
        colours,
        monoFont,
        first,
        last,
        x,
        charWidth,
        y + ROW_HEIGHT,
        row,
      );
    }
    if (showTrace && row.readIndex !== null && row.result.trace !== null) {
      // The chromatogram under the row: each base's peak under its letter.
      const bases: TraceBaseAt[] = [];
      for (
        let c = Math.max(row.firstColumn, first - 1);
        c < Math.min(row.endColumn, last + 1);
        c++
      ) {
        const index = row.readIndex[c] ?? -1;
        if (index >= 0) bases.push({ index, x: x(c) + charWidth / 2 });
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(NAME_WIDTH, y + ROW_HEIGHT + aaHeight, view.width - NAME_WIDTH, TRACE_HEIGHT);
      ctx.clip();
      drawTrace(ctx, {
        read: row.result.trace,
        bases,
        top: y + ROW_HEIGHT + aaHeight + 2,
        height: TRACE_HEIGHT - 4,
        charWidth,
        colors: colours.trace,
      });
      ctx.restore();
    }
  }

  // The pinned top over anything scrolled beneath it.
  ctx.fillStyle = colours.background;
  ctx.fillRect(NAME_WIDTH, 0, view.width - NAME_WIDTH, headerHeight);
  ctx.strokeStyle = colours.line;
  ctx.beginPath();
  ctx.moveTo(NAME_WIDTH, headerHeight - 0.5);
  ctx.lineTo(view.width, headerHeight - 0.5);
  ctx.stroke();
  if (marked !== null && marked.end > first && marked.start < last) {
    ctx.fillStyle = colours.accent;
    ctx.globalAlpha = 0.16;
    ctx.fillRect(x(marked.start), 0, (marked.end - marked.start) * charWidth, headerHeight);
    ctx.globalAlpha = 1;
  }
  ctx.font = sansFontOf(FONT_SIZE);
  for (let c = first; c < last; c++) {
    const position = columnPosition(stack, c);
    if (position === null || position % 10 !== 0) continue;
    ctx.fillStyle = colours.muted;
    ctx.textAlign = 'center';
    ctx.fillText(position.toLocaleString(), x(c) + charWidth / 2, RULER_HEIGHT / 2);
    ctx.beginPath();
    ctx.moveTo(x(c) + charWidth / 2, RULER_HEIGHT - 3);
    ctx.lineTo(x(c) + charWidth / 2, RULER_HEIGHT);
    ctx.stroke();
  }
  // A mark under the ruler where samples disagree (#124).
  ctx.fillStyle = colours.ink;
  for (let c = first; c < last; c++) {
    if (!disagreeing.has(c)) continue;
    const mid = x(c) + charWidth / 2;
    ctx.beginPath();
    ctx.moveTo(mid - 3, RULER_HEIGHT - 6);
    ctx.lineTo(mid + 3, RULER_HEIGHT - 6);
    ctx.lineTo(mid, RULER_HEIGHT);
    ctx.closePath();
    ctx.fill();
  }
  ctx.textAlign = 'left';
  ctx.font = monoFont;
  for (let c = first; c < last; c++) {
    const ch = stack.reference.charAt(c);
    drawText(
      ch,
      c,
      RULER_HEIGHT + trackHeight + ROW_HEIGHT / 2,
      ch === '-' ? colours.muted : baseColour(ch),
    );
  }
  ctx.globalAlpha = 1;
  if (residues !== null && aaHeight > 0) {
    const top = RULER_HEIGHT + trackHeight + ROW_HEIGHT;
    drawResidues(ctx, residues, colours, monoFont, first, last, x, charWidth, top, null);
  }
  if (track !== null) drawTrack(ctx, track, colours, monoFont, first, last, x);
  ctx.restore();

  // The names, pinned.
  ctx.fillStyle = colours.background;
  ctx.fillRect(0, 0, NAME_WIDTH, view.height);
  ctx.font = sansFontOf(FONT_SIZE + 1);
  ctx.textAlign = 'left';
  const clip = (text: string): string => {
    let s = text;
    while (s.length > 1 && ctx.measureText(s).width > NAME_WIDTH - 14) s = s.slice(0, -1);
    return s === text ? s : `${s.slice(0, -1)}…`;
  };
  ctx.fillStyle = colours.ink;
  ctx.font = `600 ${sansFontOf(FONT_SIZE + 1)}`;
  ctx.fillText(clip(referenceName), 8, RULER_HEIGHT + trackHeight + ROW_HEIGHT / 2);
  if (track !== null && track.lanes > 0) {
    ctx.fillStyle = colours.muted;
    ctx.font = sansFontOf(FONT_SIZE - 1);
    if (track.orfLane > 0) ctx.fillText('Features', 8, RULER_HEIGHT + LANE_HEIGHT / 2 + 2);
    if (track.orfLane < track.lanes) {
      ctx.fillText('ORFs', 8, RULER_HEIGHT + track.orfLane * LANE_HEIGHT + LANE_HEIGHT / 2 + 2);
    }
    ctx.font = `600 ${sansFontOf(FONT_SIZE + 1)}`;
    ctx.fillStyle = colours.ink;
  }
  ctx.font = sansFontOf(FONT_SIZE + 1);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, headerHeight, NAME_WIDTH, view.height - headerHeight);
  ctx.clip();
  for (let r = firstRow; r < lastRow; r++) {
    const y = headerHeight + (tops[r] ?? 0) - view.top;
    ctx.fillStyle = r === selectedRow ? colours.accent : colours.ink;
    ctx.fillText(clip(stack.rows[r]?.name ?? ''), 8, y + ROW_HEIGHT / 2);
  }
  ctx.restore();
  ctx.strokeStyle = colours.line;
  ctx.beginPath();
  ctx.moveTo(NAME_WIDTH - 0.5, 0);
  ctx.lineTo(NAME_WIDTH - 0.5, view.height);
  ctx.moveTo(0, headerHeight - 0.5);
  ctx.lineTo(NAME_WIDTH, headerHeight - 0.5);
  ctx.stroke();
}
