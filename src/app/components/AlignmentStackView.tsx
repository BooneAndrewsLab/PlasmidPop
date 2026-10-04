import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Ref,
} from 'react';

import { measureCharWidth, monoFontOf } from '@/view/linear';

import { type Stack } from '../alignmentStack';
import { ColumnClass, itemAt, type Track, type TrackItem } from '../alignmentTrack';
import { coverageBand, type Coverage } from '../alignmentVerdict';
import type { ResidueFrame } from '../alignmentResidues';
import type { ColumnRange } from '../alignmentText';
import {
  COVERAGE_HEIGHT,
  FONT_SIZE,
  LANE_HEIGHT,
  NAME_WIDTH,
  OVERVIEW_HEIGHT,
  REVIEWED_DIM,
  ROW_HEIGHT,
  RULER_HEIGHT,
  classColour,
  drawStack,
  readColours,
  rowAtOffset,
  stackLayout,
  type Colours,
  type StackDrawing,
} from './alignmentStackDraw';

/** No difference reviewed: one set, so a render without the prop is not a new one each time. */
const NONE_REVIEWED: ReadonlySet<number> = new Set();

/** What the window lets its owner reach: the columns in view, and the drawing to export. */
export interface StackHandle {
  /** The columns now in view, half-open. */
  visibleColumns(): ColumnRange;
  /** Everything needed to draw the stack elsewhere (an export): nothing picked or marked. Null until the theme is read. */
  drawing(): StackDrawing | null;
}

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
  /** Each row's sample's own features, drawn under its row (#128); null for none. */
  readonly sampleTracks?: readonly (Track | null)[] | null;
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
  readonly handle?: Ref<StackHandle>;
  /** A run of columns to bring to the middle of the view and mark, with a nonce to do it again. */
  readonly focus: { readonly start: number; readonly end: number; readonly nonce: number } | null;
  /** Columns of differences marked reviewed or taken, drawn faded here and in the overview (#123). */
  readonly reviewed?: ReadonlySet<number>;
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
  sampleTracks = null,
  classes,
  coverage,
  disagreement,
  showTrace,
  residues,
  onSelectRow,
  focus,
  handle,
  reviewed = NONE_REVIEWED,
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
  const layout = useMemo(
    () =>
      stackLayout(stack, track, residues !== null && residues.length > 0, showTrace, sampleTracks),
    [stack, track, residues, showTrace, sampleTracks],
  );
  const { headerHeight, tops, contentHeight } = layout;
  const [hover, setHover] = useState<string | null>(null);
  const contentWidth = NAME_WIDTH + stack.columns * charWidth;
  /** The row under `y` below the header, or -1. */
  const rowAt = useCallback(
    (y: number): number => rowAtOffset(layout, stack.rows.length, y),
    [layout, stack.rows.length],
  );
  /** The feature under `y` (on the canvas) at `column`: the reference's track, or a row's own lanes (#128). */
  const trackItemAt = (y: number, column: number): { item: TrackItem; own: boolean } | null => {
    if (y < headerHeight) {
      if (track === null) return null;
      const lane = Math.floor((y - RULER_HEIGHT) / LANE_HEIGHT);
      const item = lane >= 0 && lane < track.lanes ? itemAt(track, lane, column) : null;
      return item === null ? null : { item, own: false };
    }
    const r = rowAt(y - headerHeight + scroll.top);
    const own = r < 0 ? null : (sampleTracks?.[r] ?? null);
    if (own === null) return null;
    const below = y - headerHeight + scroll.top - (tops[r] ?? 0) - ROW_HEIGHT - layout.aaHeight - 1;
    const lane = Math.floor(below / LANE_HEIGHT);
    const item = lane >= 0 && lane < own.lanes ? itemAt(own, lane, column) : null;
    return item === null ? null : { item, own: true };
  };
  const drawing = useCallback(
    (
      c: Colours,
      picked: number | null,
      mark: { start: number; end: number } | null,
      faded: ReadonlySet<number>,
    ) =>
      ({
        stack,
        referenceName,
        confidentFrom,
        selectedRow: picked,
        track,
        sampleTracks,
        classes,
        disagreement,
        disagreeing,
        showTrace,
        residues,
        marked: mark,
        reviewed: faded,
        colours: c,
        charWidth,
        monoFont,
        layout,
      }) satisfies StackDrawing,
    [
      stack,
      referenceName,
      confidentFrom,
      track,
      sampleTracks,
      classes,
      disagreement,
      disagreeing,
      showTrace,
      residues,
      charWidth,
      monoFont,
      layout,
    ],
  );
  useImperativeHandle(
    handle,
    () => ({
      visibleColumns: () => {
        const left = scroll.left / charWidth;
        const width = Math.max(0, size.width - NAME_WIDTH) / charWidth;
        return {
          start: Math.min(stack.columns, Math.max(0, Math.floor(left + 1e-6))),
          end: Math.min(stack.columns, Math.max(1, Math.ceil(left + width - 1e-6))),
        };
      },
      drawing: () => (colours === null ? null : drawing(colours, null, null, NONE_REVIEWED)),
    }),
    [scroll.left, size.width, charWidth, stack.columns, colours, drawing],
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
    drawStack(ctx, drawing(colours, selectedRow, marked, reviewed), {
      left: scroll.left,
      top: scroll.top,
      width: size.width,
      height: size.height,
    });
  }, [size, scroll, marked, selectedRow, colours, drawing, reviewed]);

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
      ctx.globalAlpha = reviewed.has(c) ? REVIEWED_DIM : 1;
      ctx.fillRect(c * perColumn, 0, tick, OVERVIEW_HEIGHT);
    }
    ctx.globalAlpha = 1;
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
    reviewed,
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
              const rect = e.currentTarget.getBoundingClientRect();
              const x = e.clientX - rect.left;
              const y = e.clientY - rect.top;
              const column = Math.floor((x - NAME_WIDTH + scroll.left) / charWidth);
              const item = x < NAME_WIDTH ? null : trackItemAt(y, column);
              const text =
                item === null
                  ? null
                  : `${item.own ? 'Sample feature: ' : ''}${item.item.annotation.name} (${item.item.annotation.type}, ${item.item.annotation.strand} strand)`;
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
