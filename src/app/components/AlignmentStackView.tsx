import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
} from 'react';

import { measureCharWidth, monoFontOf } from '@/view/linear';

import { AlignmentCopyPanel } from './AlignmentCopyPanel';
import { AlignmentSelectionBar } from './AlignmentSelectionBar';
import { CopyNote } from './CopyNote';
import { followTooltip, hideFollowTooltip } from './tooltip';

import { residueTitle, sampleChanges } from '../alignmentChanges';
import {
  REFERENCE_ROW,
  cellHasLetter,
  copiedNote,
  extendSelection,
  rowName,
  selectionColumns,
  selectionText,
  selectionValid,
  startSelection,
  type AlignmentSelection,
  type CopyMode,
  type SelectionTrack,
} from '../alignmentSelection';
import { type Stack } from '../alignmentStack';
import {
  barWanted,
  gestureMove,
  gesturePress,
  gestureRelease,
  idleGesture,
  type Gesture,
  type GestureCell,
  type GestureOps,
} from '../selectionGesture';
import { copyText } from '../clipboard';
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
  selectionTargetAt,
  stackLayout,
  type Colours,
  type StackDrawing,
} from './alignmentStackDraw';

/** No difference reviewed: one set, so a render without the prop is not a new one each time. */
const NONE_REVIEWED: ReadonlySet<number> = new Set();

/** The selection bar's size, for keeping it inside the view (#366): two small buttons and a count. */
const BAR_HEIGHT = 30;
const BAR_WIDTH = 280;
/** Room between the bar and the row it belongs to. */
const BAR_GAP = 4;

/** A row and strip a selection is on, as `selectionTargetAt` finds it. */
interface StripKey {
  readonly row: number;
  readonly track: SelectionTrack;
}
type StackGesture = Gesture<StripKey, AlignmentSelection>;
const GESTURE_OPS: GestureOps<StripKey, AlignmentSelection> = {
  start: (key, column) => startSelection(key.row, key.track, column),
  extend: extendSelection,
};

/** What the window lets its owner reach: the columns in view, the drawing to export, and the selection to clear. */
export interface StackHandle {
  /** The columns now in view, half-open. */
  visibleColumns(): ColumnRange;
  /** Everything needed to draw the stack elsewhere (an export): nothing picked or marked. Null until the theme is read. */
  drawing(): StackDrawing | null;
  /** Clear the selection (Esc, #370): whether there was one to clear. */
  clearSelection(): boolean;
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
  /** Whether the residues carry their protein ruler's numbers; on by default. */
  readonly residueNumbers?: boolean;
  /** Whether a sample's changes are named in tags under its residues; on by default. */
  readonly showChanges?: boolean;
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
  residueNumbers = true,
  showChanges = true,
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
  /**
   * The columns a tool brought into view (Go to, Find, Prev and Next, the
   * List): a band through every row and the overview, apart from the
   * selection, which is one row's and the pointer's (#370). Only `focus`
   * sets it; a click does not.
   */
  const [marked, setMarked] = useState<{ start: number; end: number } | null>(null);
  const [colours, setColours] = useState<Colours | null>(null);
  /** The selection and the press making it (#366, #370). */
  const [gesture, setGesture] = useState<StackGesture>(idleGesture);
  const [copyNote, setCopyNote] = useState('');
  /** Where the Advanced copy panel hangs from, in the `.astack`'s coordinates; null when closed. */
  const [panelAt, setPanelAt] = useState<{ left: number; top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  // A different stack (a sample hidden, a new alignment) puts the columns elsewhere.
  const [seenStack, setSeenStack] = useState(stack);
  if (stack !== seenStack) {
    setSeenStack(stack);
    setGesture(idleGesture());
    setCopyNote('');
    setPanelAt(null);
  }
  const selection =
    gesture.selection !== null && selectionValid(stack, gesture.selection)
      ? gesture.selection
      : null;
  const closePanel = useCallback(() => {
    setPanelAt(null);
  }, []);

  const monoFont = monoFontOf(FONT_SIZE);
  const charWidth = useMemo(() => measureCharWidth(monoFont), [monoFont]);
  /** Each sample's named changes, for its tags (#261); null without residues or with the tags off. */
  const changes = useMemo(
    () =>
      residues === null || residues.length === 0 || !showChanges
        ? null
        : stack.rows.map((row) => sampleChanges(residues, row)),
    [stack, residues, showChanges],
  );
  const layout = useMemo(
    () =>
      stackLayout(
        stack,
        track,
        residues !== null && residues.length > 0,
        showTrace,
        sampleTracks,
        changes,
        residueNumbers,
      ),
    [stack, track, residues, showTrace, sampleTracks, changes, residueNumbers],
  );
  const { headerHeight, tops, contentHeight } = layout;
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
    const strips = layout.aaHeight + (layout.tagHeights[r] ?? 0);
    const below = y - headerHeight + scroll.top - (tops[r] ?? 0) - ROW_HEIGHT - strips - 1;
    const lane = Math.floor(below / LANE_HEIGHT);
    const item = lane >= 0 && lane < own.lanes ? itemAt(own, lane, column) : null;
    return item === null ? null : { item, own: true };
  };
  /** What the pointer says over an amino-acid strip (or its tags) at `y` and `column` (#261). */
  const residueAt = (y: number, column: number): string | null => {
    if (residues === null || residues.length === 0) return null;
    if (y < headerHeight) {
      const top = RULER_HEIGHT + layout.trackHeight + ROW_HEIGHT;
      return y >= top && y < top + layout.aaHeight
        ? residueTitle(residues, stack, null, column)
        : null;
    }
    const r = rowAt(y - headerHeight + scroll.top);
    if (r < 0) return null;
    const below = y - headerHeight + scroll.top - (tops[r] ?? 0) - ROW_HEIGHT;
    if (below < 0 || below >= layout.aaHeight + (layout.tagHeights[r] ?? 0)) return null;
    return residueTitle(residues, stack, r, column);
  };
  /** What the pointer at a canvas event is on: a residue, a track feature or a sample's own, or nothing. */
  const tipAt = (e: ReactMouseEvent<HTMLCanvasElement>): string | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < NAME_WIDTH) return null;
    const column = Math.floor((x - NAME_WIDTH + scroll.left) / charWidth);
    const item = trackItemAt(y, column);
    return item === null
      ? residueAt(y, column)
      : `${item.own ? 'Sample feature: ' : ''}${item.item.annotation.name} (${item.item.annotation.type}, ${item.item.annotation.strand} strand)`;
  };
  const drawing = useCallback(
    (
      c: Colours,
      picked: number | null,
      mark: { start: number; end: number } | null,
      faded: ReadonlySet<number>,
      range: AlignmentSelection | null = null,
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
        changes,
        marked: mark,
        selection: range,
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
      changes,
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
      clearSelection: () => {
        if (selection === null) return false;
        setGesture(idleGesture());
        setPanelAt(null);
        return true;
      },
    }),
    [scroll.left, size.width, charWidth, stack.columns, colours, drawing, selection],
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
    drawStack(ctx, drawing(colours, selectedRow, marked, reviewed, selection), {
      left: scroll.left,
      top: scroll.top,
      width: size.width,
      height: size.height,
    });
  }, [size, scroll, marked, selectedRow, colours, drawing, reviewed, selection]);

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
  /** The column under a pointer event on the canvas, past the stack's ends included. */
  const columnUnder = (e: { clientX: number; currentTarget: HTMLCanvasElement }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.floor((e.clientX - rect.left - NAME_WIDTH + scroll.left) / charWidth);
  };
  /** The column under a pointer event on the canvas, kept inside the stack. */
  const columnAtEvent = (e: { clientX: number; currentTarget: HTMLCanvasElement }): number =>
    Math.min(stack.columns - 1, Math.max(0, columnUnder(e)));
  /** The cell a press on the canvas lands on, for the selection gesture (#370): null off every row and strip. */
  const cellAtEvent = (e: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLCanvasElement;
  }): GestureCell<StripKey> | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    const key = selectionTargetAt(layout, stack.rows.length, e.clientY - rect.top, scroll.top);
    if (key === null) return null;
    const under = columnUnder(e);
    return {
      key,
      column: columnAtEvent(e),
      letter: cellHasLetter(stack, residues, key.row, key.track, under),
    };
  };
  /** Ctrl+C copies the selection; with Shift, the row as drawn with its gaps (#366). */
  const copySelection = (mode: CopyMode): boolean => {
    if (selection === null) return false;
    const text = selectionText(stack, residues, selection, mode);
    if (text === '') return false;
    copyText(text);
    setCopyNote(
      copiedNote(rowName(stack, referenceName, selection.row), selection.track, text, mode),
    );
    return true;
  };

  /**
   * The bar beside the selection (#366), in the scroller's content space:
   * above the row where there is room under the pinned header, else under
   * it (always under the reference, which is pinned at the top: there the
   * bar sits just below the header, over the first sample rather than over
   * the reference's own strips). Kept inside the view sideways; null for one
   * clicked cell, while dragging, or when the row has scrolled under the
   * header or out of view.
   */
  const barAt = (() => {
    if (selection === null) return null;
    const cols = selectionColumns(stack, selection);
    if (cols === null || !barWanted(gesture, cols)) return null;
    const reference = selection.row === REFERENCE_ROW;
    const strip = selection.track === 'aa' ? ROW_HEIGHT : 0;
    const height = selection.track === 'aa' ? layout.aaHeight : ROW_HEIGHT;
    // The reference is pinned; a sample's strip scrolls under the header.
    const canvasTop = reference
      ? RULER_HEIGHT + layout.trackHeight + strip
      : headerHeight + (tops[selection.row] ?? 0) - scroll.top + strip;
    const above = canvasTop - BAR_HEIGHT - BAR_GAP;
    const below =
      (reference ? Math.max(headerHeight, canvasTop + height) : canvasTop + height) + BAR_GAP;
    const y = !reference && above >= headerHeight ? above : below;
    if (y + BAR_HEIGHT > size.height || (!reference && canvasTop + height < headerHeight)) {
      return null;
    }
    const x = Math.max(
      NAME_WIDTH + BAR_GAP,
      Math.min(NAME_WIDTH + cols.start * charWidth - scroll.left, size.width - BAR_WIDTH),
    );
    return { left: scroll.left + x, top: scroll.top + y, columns: cols.end - cols.start };
  })();
  /** Open the Advanced copy panel under the bar, or close it when it is open. */
  const togglePanel = (bar: HTMLElement): void => {
    if (panelAt !== null) {
      setPanelAt(null);
      return;
    }
    const box = root.current?.getBoundingClientRect();
    const at = bar.getBoundingClientRect();
    if (box === undefined) return;
    setPanelAt({ left: at.left - box.left, top: at.bottom - box.top });
  };

  return (
    <div className="astack" ref={root}>
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
        aria-label="Alignment, all sequences; Up and Down pick a sample; drag over bases or amino acids to select, Ctrl+C copies"
        onKeyDown={(e) => {
          // Ctrl+Shift+C is the browser's inspector, so the aligned row is Ctrl+Alt+C.
          if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyC') {
            if (copySelection(e.altKey ? 'aligned' : 'residues')) e.preventDefault();
            return;
          }
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
        <div style={{ width: contentWidth, height: contentHeight, position: 'relative' }}>
          <canvas
            ref={canvas}
            className="astack__canvas"
            style={{ width: size.width, height: size.height }}
            onPointerMove={(e) => {
              // A finger scrolling the view is not asking what is under it;
              // a tap is (`onClick`).
              if (e.pointerType === 'touch') return;
              const column = columnAtEvent(e);
              setGesture((g) => gestureMove(g, column, GESTURE_OPS));
              const text = tipAt(e);
              if (text === null) hideFollowTooltip();
              else followTooltip(text, e.clientX, e.clientY);
            }}
            onPointerLeave={() => {
              hideFollowTooltip();
            }}
            onPointerDown={(e) => {
              // Click a letter, drag over a row's bases or amino acids, or
              // shift-click the far end, to select; a press on blank space
              // clears (#366, #370). A press on the names is a row pick only.
              if (e.button !== 0 || e.pointerType === 'touch') return;
              const rect = e.currentTarget.getBoundingClientRect();
              if (e.clientX - rect.left < NAME_WIDTH) return;
              const cell = cellAtEvent(e);
              const shift = e.shiftKey;
              setPanelAt(null);
              setCopyNote('');
              setGesture((g) => gesturePress(g, cell, shift, GESTURE_OPS));
              if (cell !== null) e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerUp={() => {
              setGesture(gestureRelease);
            }}
            onPointerCancel={() => {
              setGesture(gestureRelease);
            }}
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const y = e.clientY - rect.top;
              if (y >= headerHeight) {
                const row = rowAt(y - headerHeight + scroll.top);
                if (row >= 0) onSelectRow(row);
              }
              // A finger has no hover: a tap names the residue or feature
              // under it, and the tip stays until the next tap or scroll.
              if ('pointerType' in e.nativeEvent && e.nativeEvent.pointerType === 'touch') {
                const text = tipAt(e);
                if (text !== null) followTooltip(text, e.clientX, e.clientY);
              }
            }}
          />
          {barAt !== null && (
            <AlignmentSelectionBar
              left={barAt.left}
              top={barAt.top}
              columns={barAt.columns}
              advancedOpen={panelAt !== null}
              onCopy={() => {
                copySelection('residues');
                // The keys work from the scroller, so hand it the focus back.
                scroller.current?.focus();
              }}
              onAdvanced={togglePanel}
            />
          )}
        </div>
      </div>
      {panelAt !== null && selection !== null && (
        <AlignmentCopyPanel
          stack={stack}
          frames={residues}
          referenceName={referenceName}
          selection={selection}
          left={panelAt.left}
          top={panelAt.top}
          onCopied={(note) => {
            setCopyNote(note);
            scroller.current?.focus();
          }}
          onClose={closePanel}
        />
      )}
      <CopyNote note={copyNote} />
    </div>
  );
}
