import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { measureCharWidth, monoFontOf, sansFontOf } from '@/view/linear';

import { contrastingText } from '@/view/featureColors';

import { Cell, columnPosition, isDifference, type Stack } from '../alignmentStack';
import { ColumnClass, itemAt, type Track } from '../alignmentTrack';
import { readLinearTheme } from './linearTheme';

const FONT_SIZE = 13;
const ROW_HEIGHT = 20;
const RULER_HEIGHT = 18;
/** One lane of the feature track. */
const LANE_HEIGHT = 16;
const NAME_WIDTH = 168;
const OVERVIEW_HEIGHT = 44;

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
export function AlignmentStackView({
  stack,
  referenceName,
  confidentFrom,
  selectedRow,
  track,
  classes,
  onSelectRow,
  focus,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
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
  const headerHeight = RULER_HEIGHT + trackHeight + ROW_HEIGHT;
  const [hover, setHover] = useState<string | null>(null);
  const contentWidth = NAME_WIDTH + stack.columns * charWidth;
  const contentHeight = headerHeight + stack.rows.length * ROW_HEIGHT;

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
    const firstRow = Math.max(0, Math.floor((scroll.top - 0) / ROW_HEIGHT));
    const lastRow = Math.min(
      stack.rows.length,
      Math.ceil((scroll.top + size.height - headerHeight) / ROW_HEIGHT),
    );

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
      const y = headerHeight + r * ROW_HEIGHT - scroll.top;
      if (y + ROW_HEIGHT < headerHeight) continue;
      if (r === selectedRow) {
        ctx.fillStyle = colours.accent;
        ctx.globalAlpha = 0.08;
        ctx.fillRect(NAME_WIDTH, y, size.width - NAME_WIDTH, ROW_HEIGHT);
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
        drawText(
          ch,
          c,
          y + ROW_HEIGHT / 2,
          ch === '-' ? colours.muted : baseColour(ch),
          cell === Cell.Padding ? 0.3 : poor ? 0.4 : 1,
        );
      }
      ctx.globalAlpha = 1;
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
      const y = headerHeight + r * ROW_HEIGHT - scroll.top;
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
  ]);

  // The overview.
  useEffect(() => {
    const el = overview.current;
    const ctx = el?.getContext('2d') ?? null;
    if (el === null || ctx === null || colours === null) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.max(1, Math.floor(overviewWidth * dpr));
    el.height = Math.floor(OVERVIEW_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colours.background;
    ctx.fillRect(0, 0, overviewWidth, OVERVIEW_HEIGHT);
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
        style={{ width: '100%', height: OVERVIEW_HEIGHT }}
        role="img"
        aria-label={`Overview of the alignment: ${stack.differences.length.toLocaleString()} differing columns. Click or drag to move.`}
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
        aria-label="Alignment, all sequences"
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
                const row = Math.floor((y - headerHeight + scroll.top) / ROW_HEIGHT);
                if (row >= 0 && row < stack.rows.length) onSelectRow(row);
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
