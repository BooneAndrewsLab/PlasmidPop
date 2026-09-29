import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { measureCharWidth, monoFontOf, sansFontOf } from '@/view/linear';

import { Cell, columnPosition, type Stack } from '../alignmentStack';
import { readLinearTheme } from './linearTheme';

const FONT_SIZE = 13;
const ROW_HEIGHT = 20;
const RULER_HEIGHT = 18;
/** The pinned top: ruler and the reference row. */
const HEADER_HEIGHT = RULER_HEIGHT + ROW_HEIGHT;
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
  readonly mismatch: string;
  readonly deletion: string;
  readonly insertion: string;
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
    mismatch: t.editChange,
    deletion: t.editDelete,
    insertion: t.editInsert,
    accent: css.getPropertyValue('--accent').trim() || t.caret,
  };
}

/** A fill for a cell that differs, or null. */
function differenceFill(cell: number, c: Colours): string | null {
  switch (cell) {
    case Cell.Mismatch:
      return c.mismatch;
    case Cell.Deletion:
      return c.deletion;
    case Cell.Insertion:
      return c.insertion;
    default:
      return null;
  }
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
  const contentWidth = NAME_WIDTH + stack.columns * charWidth;
  const contentHeight = HEADER_HEIGHT + stack.rows.length * ROW_HEIGHT;

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
      Math.ceil((scroll.top + size.height - HEADER_HEIGHT) / ROW_HEIGHT),
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
      const y = HEADER_HEIGHT + r * ROW_HEIGHT - scroll.top;
      if (y + ROW_HEIGHT < HEADER_HEIGHT) continue;
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
        const fill = differenceFill(cell, colours);
        if (fill !== null) {
          ctx.globalAlpha = 0.28;
          ctx.fillStyle = fill;
          ctx.fillRect(x(c), y, charWidth, ROW_HEIGHT);
        }
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
    ctx.fillRect(NAME_WIDTH, 0, size.width - NAME_WIDTH, HEADER_HEIGHT);
    ctx.strokeStyle = colours.line;
    ctx.beginPath();
    ctx.moveTo(NAME_WIDTH, HEADER_HEIGHT - 0.5);
    ctx.lineTo(size.width, HEADER_HEIGHT - 0.5);
    ctx.stroke();
    if (marked !== null && marked.end > first && marked.start < last) {
      ctx.fillStyle = colours.accent;
      ctx.globalAlpha = 0.16;
      ctx.fillRect(x(marked.start), 0, (marked.end - marked.start) * charWidth, HEADER_HEIGHT);
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
      drawText(ch, c, RULER_HEIGHT + ROW_HEIGHT / 2, ch === '-' ? colours.muted : baseColour(ch));
    }
    ctx.globalAlpha = 1;
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
    ctx.fillText(clip(referenceName), 8, RULER_HEIGHT + ROW_HEIGHT / 2);
    ctx.font = sansFontOf(FONT_SIZE + 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, HEADER_HEIGHT, NAME_WIDTH, size.height - HEADER_HEIGHT);
    ctx.clip();
    for (let r = firstRow; r < lastRow; r++) {
      const y = HEADER_HEIGHT + r * ROW_HEIGHT - scroll.top;
      ctx.fillStyle = r === selectedRow ? colours.accent : colours.ink;
      ctx.fillText(clip(stack.rows[r]?.name ?? ''), 8, y + ROW_HEIGHT / 2);
    }
    ctx.restore();
    ctx.strokeStyle = colours.line;
    ctx.beginPath();
    ctx.moveTo(NAME_WIDTH - 0.5, 0);
    ctx.lineTo(NAME_WIDTH - 0.5, size.height);
    ctx.moveTo(0, HEADER_HEIGHT - 0.5);
    ctx.lineTo(NAME_WIDTH, HEADER_HEIGHT - 0.5);
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
      let fill = colours.insertion;
      for (const row of stack.rows) {
        const cell = row.cells[c] ?? Cell.Blank;
        if (cell === Cell.Mismatch) {
          fill = colours.mismatch;
          break;
        }
        if (cell === Cell.Deletion) fill = colours.deletion;
      }
      ctx.fillStyle = fill;
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
  }, [stack, overviewWidth, size.width, scroll.left, marked, colours, charWidth, contentWidth]);

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
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              const x = e.clientX - rect.left;
              if (y >= HEADER_HEIGHT) {
                const row = Math.floor((y - HEADER_HEIGHT + scroll.top) / ROW_HEIGHT);
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
