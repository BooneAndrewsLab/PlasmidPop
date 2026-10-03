import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { measureCharWidth, monoFontOf, sansFontOf } from '@/view/linear';
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
import { ColumnClass, itemAt, type Track } from '../alignmentTrack';
import { coverageBand, type Coverage } from '../alignmentVerdict';
import { readLinearTheme } from './linearTheme';

const FONT_SIZE = 13;
const ROW_HEIGHT = 20;
const RULER_HEIGHT = 18;
/** One lane of the feature track. */
const LANE_HEIGHT = 16;
const NAME_WIDTH = 168;
const OVERVIEW_HEIGHT = 44;
/** The coverage band under the overview's marks (#120). */
const COVERAGE_HEIGHT = 6;
/** The chromatogram under a read's row (#110). */
const TRACE_HEIGHT = 40;
/** The amino-acid strip under the reference's row and under each sample's. */
const AA_HEIGHT = 16;

interface Props {
  readonly stack: Stack;
  /** The reference's name, for the pinned row. */
  readonly referenceName: string;
  /** A base counts as poor below this quality. */
  readonly confidentFrom: number;
  /** The row picked, an index into `stack.rows`. */
  readonly selectedRow: number | null;
  /** The reference's features and ORFs, drawn between the ruler and the reference row; null for none. */
  readonly track: Track | null;
  /**
   * Per column, a `ColumnClass`: where it falls in the reference document,
   * which colours a difference (#104); null when the reference has no
   * document, and every difference is then coloured as outside a feature.
   */
  readonly classes: Uint8Array | null;
  /** Reads covering each column at good quality; drawn as a band under the overview (#120). */
  readonly coverage: Coverage | null;
  /** Columns where samples carry different bases from each other, ascending (#124). */
  readonly disagreement: readonly number[];
  /** Draw each AB1 read's chromatogram under its row (#110). */
  readonly showTrace: boolean;
  /** The CDS frames to draw residues for, under the reference and each sample; null for none. */
  readonly residues: readonly ResidueFrame[] | null;
  readonly onSelectRow: (row: number) => void;
  /** A run of columns to bring to the middle of the view and mark, with a nonce to do it again. */
  readonly focus: { readonly start: number; readonly end: number; readonly nonce: number } | null;
}

interface Colours {
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

function readColours(el: HTMLElement): Colours {
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
function classColour(c: Colours, k: number): string {
  return c.byClass[k] ?? c.byClass[ColumnClass.None];
}

/**
 * Paints a cell that differs: the class colour behind it, and a mark that
 * tells the kinds apart without it. A mismatch is a plain block, a deletion
 * has a bar along its foot, an insertion one along its head; an ambiguity
 * match is the lightest block.  */
function paintDifference(
  ctx: CanvasRenderingContext2D,
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
  g: CanvasRenderingContext2D,
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
  ctx: CanvasRenderingContext2D,
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

export function AlignmentStackView({
  stack,
  referenceName,
  confidentFrom,
  selectedRow,
  track,
  classes,
  coverage,
  disagreement,
  showTrace,
  residues,
  onSelectRow,
  focus,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const disagreeing = useMemo(() => new Set(disagreement), [disagreement]);
  const overview = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 300 });
  const [overviewWidth, setOverviewWidth] = useState(600);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [marked, setMarked] = useState<{ start: number; end: number } | null>(null);
  const [colours, setColours] = useState<Colours | null>(null);

  const monoFont = monoFontOf(FONT_SIZE);
  const charWidth = useMemo(() => measureCharWidth(monoFont), [monoFont]);
  const trackHeight = track === null ? 0 : track.lanes * LANE_HEIGHT + (track.lanes > 0 ? 4 : 0);
  /** The pinned top: ruler, the feature track, and the reference row. */
  const aaHeight = residues !== null && residues.length > 0 ? AA_HEIGHT : 0;
  const headerHeight = RULER_HEIGHT + trackHeight + ROW_HEIGHT + aaHeight;
  const [hover, setHover] = useState<string | null>(null);
  const contentWidth = NAME_WIDTH + stack.columns * charWidth;
  // Each row's top below the header; a read with a trace is taller by the trace's strip.
  const tops = useMemo(() => {
    const out = new Array<number>(stack.rows.length + 1);
    let y = 0;
    stack.rows.forEach((row, r) => {
      out[r] = y;
      y += ROW_HEIGHT + aaHeight + (showTrace && row.readIndex !== null ? TRACE_HEIGHT : 0);
    });
    out[stack.rows.length] = y;
    return out;
  }, [stack, showTrace, aaHeight]);
  const rowsHeight = tops[stack.rows.length] ?? 0;
  const contentHeight = headerHeight + rowsHeight;
  /** The row under `y` below the header, or -1. */
  const rowAt = useCallback(
    (y: number): number => {
      if (y < 0 || y >= rowsHeight) return -1;
      let lo = 0;
      let hi = stack.rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if ((tops[mid] ?? 0) <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [tops, rowsHeight, stack.rows.length],
  );

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    setColours(readColours(el));
    const measure = (): void => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
      setOverviewWidth(el.clientWidth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const scrollToColumn = useCallback(
    (start: number, end: number): void => {
      const column = (start + end - 1) / 2;
      const el = scroller.current;
      if (el === null) return;
      const view = el.clientWidth - NAME_WIDTH;
      el.scrollLeft = Math.max(0, column * charWidth + charWidth / 2 - view / 2);
    },
    [charWidth],
  );

  // A new column to go to marks it here, in the render that gets it.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (focus !== seenFocus) {
    setSeenFocus(focus);
    if (focus !== null) setMarked({ start: focus.start, end: focus.end });
  }
  useEffect(() => {
    if (focus !== null) scrollToColumn(focus.start, focus.end);
  }, [focus, scrollToColumn]);

  // The main canvas.
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null || colours === null) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.floor(size.width * dpr));
    el.height = Math.max(1, Math.floor(size.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colours.background;
    ctx.fillRect(0, 0, size.width, size.height);
    ctx.textBaseline = 'middle';

    const first = Math.max(0, Math.floor(scroll.left / charWidth));
    const last = Math.min(stack.columns, Math.ceil((scroll.left + size.width) / charWidth));
    const x = (c: number): number => NAME_WIDTH + c * charWidth - scroll.left;
    const firstRow = Math.max(0, rowAt(scroll.top));
    const lastRow = Math.min(
      stack.rows.length,
      rowAt(scroll.top + size.height - headerHeight) + 1 || stack.rows.length,
    );
    const rowHeightOf = (r: number): number => (tops[r + 1] ?? 0) - (tops[r] ?? 0);

    // The columns, clipped so they slide under the names.
    ctx.save();
    ctx.beginPath();
    ctx.rect(NAME_WIDTH, 0, size.width - NAME_WIDTH, size.height);
    ctx.clip();

    if (marked !== null && marked.end > first && marked.start < last) {
      ctx.fillStyle = colours.accent;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x(marked.start), 0, (marked.end - marked.start) * charWidth, size.height);
      ctx.globalAlpha = 1;
    }

    // Columns where samples disagree with each other: a faint tint down the column (#124).
    if (disagreement.length > 0) {
      ctx.fillStyle = colours.ink;
      ctx.globalAlpha = 0.08;
      for (let c = first; c < last; c++) {
        if (disagreeing.has(c)) ctx.fillRect(x(c), 0, charWidth, size.height);
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
      const y = headerHeight + (tops[r] ?? 0) - scroll.top;
      if (y + rowHeightOf(r) < headerHeight) continue;
      if (r === selectedRow) {
        ctx.fillStyle = colours.accent;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(NAME_WIDTH, y, size.width - NAME_WIDTH, rowHeightOf(r));
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
        ctx.rect(NAME_WIDTH, y + ROW_HEIGHT + aaHeight, size.width - NAME_WIDTH, TRACE_HEIGHT);
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
    ctx.fillRect(NAME_WIDTH, 0, size.width - NAME_WIDTH, headerHeight);
    ctx.strokeStyle = colours.line;
    ctx.beginPath();
    ctx.moveTo(NAME_WIDTH, headerHeight - 0.5);
    ctx.lineTo(size.width, headerHeight - 0.5);
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
    ctx.fillRect(0, 0, NAME_WIDTH, size.height);
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
    ctx.rect(0, headerHeight, NAME_WIDTH, size.height - headerHeight);
    ctx.clip();
    for (let r = firstRow; r < lastRow; r++) {
      const y = headerHeight + (tops[r] ?? 0) - scroll.top;
      ctx.fillStyle = r === selectedRow ? colours.accent : colours.ink;
      ctx.fillText(clip(stack.rows[r]?.name ?? ''), 8, y + ROW_HEIGHT / 2);
    }
    ctx.restore();
    ctx.strokeStyle = colours.line;
    ctx.beginPath();
    ctx.moveTo(NAME_WIDTH - 0.5, 0);
    ctx.lineTo(NAME_WIDTH - 0.5, size.height);
    ctx.moveTo(0, headerHeight - 0.5);
    ctx.lineTo(NAME_WIDTH, headerHeight - 0.5);
    ctx.stroke();
  }, [
    stack,
    size,
    scroll,
    marked,
    selectedRow,
    colours,
    charWidth,
    monoFont,
    referenceName,
    confidentFrom,
    track,
    classes,
    headerHeight,
    trackHeight,
    showTrace,
    residues,
    aaHeight,
    disagreement,
    disagreeing,
    tops,
    rowAt,
  ]);

  // The overview.
  useEffect(() => {
    const el = overview.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null || colours === null) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.floor(overviewWidth * dpr));
    el.height = Math.floor((OVERVIEW_HEIGHT + COVERAGE_HEIGHT) * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colours.background;
    ctx.fillRect(0, 0, overviewWidth, OVERVIEW_HEIGHT + COVERAGE_HEIGHT);
    const perColumn = overviewWidth / Math.max(1, stack.columns);
    // The stretch each sample covers, as a faint bar behind the marks.
    const barHeight = Math.max(
      1,
      Math.min(3, (OVERVIEW_HEIGHT - 8) / Math.max(1, stack.rows.length)),
    );
    ctx.fillStyle = colours.line;
    stack.rows.forEach((row, r) => {
      const y = 4 + (r * (OVERVIEW_HEIGHT - 8)) / Math.max(1, stack.rows.length);
      ctx.fillRect(
        row.firstColumn * perColumn,
        y,
        Math.max(1, (row.endColumn - row.firstColumn) * perColumn),
        barHeight,
      );
    });
    // Every difference, at least a pixel wide, by the worst cell in that column.
    const tick = Math.max(1, perColumn);
    for (const c of stack.differences) {
      ctx.fillStyle = classColour(colours, classes?.[c] ?? ColumnClass.None);
      ctx.fillRect(c * perColumn, 0, tick, OVERVIEW_HEIGHT);
    }
    // Columns where samples disagree: a solid foot under the differences (#124).
    ctx.fillStyle = colours.ink;
    for (const c of disagreement) {
      ctx.fillRect(c * perColumn, OVERVIEW_HEIGHT - 5, Math.max(2, perColumn), 5);
    }
    // Coverage: none stays bare, one read is light, two or more dark.
    if (coverage !== null) {
      ctx.fillStyle = colours.line;
      ctx.fillRect(0, OVERVIEW_HEIGHT + COVERAGE_HEIGHT - 1, overviewWidth, 1);
      ctx.fillStyle = colours.ink;
      let from = 0;
      for (let c = 1; c <= stack.columns; c++) {
        const band = c < stack.columns ? coverageBand(coverage, c) : -1;
        if (c < stack.columns && band === coverageBand(coverage, from)) continue;
        const level = coverageBand(coverage, from);
        if (level > 0) {
          ctx.globalAlpha = level === 1 ? 0.3 : 0.75;
          ctx.fillRect(
            from * perColumn,
            OVERVIEW_HEIGHT + 1,
            Math.max(1, (c - from) * perColumn),
            COVERAGE_HEIGHT - 2,
          );
        }
        from = c;
      }
      ctx.globalAlpha = 1;
    }
    if (marked !== null) {
      ctx.fillStyle = colours.accent;
      ctx.fillRect(
        marked.start * perColumn - 1,
        0,
        Math.max(2, (marked.end - marked.start) * perColumn + 2),
        OVERVIEW_HEIGHT,
      );
    }
    // The stretch in view.
    const view = Math.max(0, size.width - NAME_WIDTH);
    const left = (scroll.left / Math.max(1, contentWidth - NAME_WIDTH)) * overviewWidth;
    const width = Math.min(
      overviewWidth,
      (view / Math.max(1, stack.columns * charWidth)) * overviewWidth,
    );
    ctx.fillStyle = colours.accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(left, 0, width, OVERVIEW_HEIGHT);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colours.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(left + 0.75, 0.75, Math.max(1, width - 1.5), OVERVIEW_HEIGHT - 1.5);
    ctx.lineWidth = 1;
  }, [
    stack,
    classes,
    coverage,
    disagreement,
    overviewWidth,
    size.width,
    scroll.left,
    marked,
    colours,
    charWidth,
    contentWidth,
  ]);

  const jumpFromOverview = (clientX: number): void => {
    const el = overview.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const column = ((clientX - rect.left) / Math.max(1, rect.width)) * stack.columns;
    const at = Math.min(stack.columns - 1, Math.max(0, Math.floor(column)));
    scrollToColumn(at, at + 1);
  };
  const dragging = useRef(false);

  return (
    <div className="astack">
      <canvas
        ref={overview}
        className="astack__overview"
        style={{ width: '100%', height: OVERVIEW_HEIGHT + COVERAGE_HEIGHT }}
        role="img"
        aria-label={`Overview of the alignment: ${stack.differences.length.toLocaleString()} differing columns${disagreement.length === 0 ? '' : `, ${disagreement.length.toLocaleString()} where samples disagree with each other (marked at the foot)`}${coverage === null ? '' : ', and a band of how many reads cover each column at good quality'}. Click or drag to move.`}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpFromOverview(e.clientX);
        }}
        onPointerMove={(e) => {
          if (dragging.current) jumpFromOverview(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      />
      <div
        ref={scroller}
        className="astack__scroller"
        tabIndex={0}
        aria-label="Alignment, all sequences; Up and Down pick a sample"
        onKeyDown={(e) => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
          if (e.altKey || e.ctrlKey || e.metaKey || stack.rows.length === 0) return;
          e.preventDefault();
          const last = stack.rows.length - 1;
          const up = e.key === 'ArrowUp';
          const row =
            selectedRow === null
              ? up
                ? last
                : 0
              : Math.min(last, Math.max(0, selectedRow + (up ? -1 : 1)));
          onSelectRow(row);
          // Keep the picked row in the part below the pinned header.
          const el = e.currentTarget;
          const top = tops[row] ?? 0;
          const bottom = tops[row + 1] ?? top;
          const visible = el.clientHeight - headerHeight;
          if (top < el.scrollTop) el.scrollTop = top;
          else if (bottom > el.scrollTop + visible) el.scrollTop = bottom - visible;
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          setScroll({ left: el.scrollLeft, top: el.scrollTop });
        }}
      >
        <div style={{ width: contentWidth, height: contentHeight }}>
          <canvas
            ref={canvas}
            className="astack__canvas"
            style={{ width: size.width, height: size.height }}
            title={hover ?? undefined}
            onPointerMove={(e) => {
              if (track === null) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const lane = Math.floor((e.clientY - rect.top - RULER_HEIGHT) / LANE_HEIGHT);
              const x = e.clientX - rect.left;
              const item =
                lane >= 0 && lane < track.lanes && x >= NAME_WIDTH
                  ? itemAt(track, lane, Math.floor((x - NAME_WIDTH + scroll.left) / charWidth))
                  : null;
              const text =
                item === null
                  ? null
                  : `${item.annotation.name} (${item.annotation.type}, ${item.annotation.strand} strand)`;
              if (text !== hover) setHover(text);
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const x = e.clientX - rect.left;
              if (y >= headerHeight) {
                const row = rowAt(y - headerHeight + scroll.top);
                if (row >= 0) onSelectRow(row);
              }
              if (x >= NAME_WIDTH) {
                const at = Math.floor((x - NAME_WIDTH + scroll.left) / charWidth);
                setMarked({ start: at, end: at + 1 });
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
