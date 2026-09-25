import {
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type CdsTranslation,
  type Feature,
  type Range,
  type SeqDocument,
  CdsTranslations,
  InvalidSequenceError,
  codonIndexAt,
  codonSpan,
  fragmentFromRange,
  isCodingFeature,
  isEmptyRange,
} from '@/core';
import {
  type Hit,
  LinearLayout,
  RowBreaks,
  assignLanes,
  basesPerRowFor,
  endOverhangs,
  lanesPerRow,
  linearMetrics,
  linearWidth,
  measureCharWidth,
  monoFontOf,
  renderLinearView,
  sansFontOf,
  sizedRuns,
} from '@/view/linear';
import {
  type OverlaySpan,
  NO_OVERLAY,
  overlayAt,
  overlayLanes,
  overlaysPerRow,
} from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { detectFormat } from '@/io';

import { analytics } from '../analytics';
import { copyFragment, readClipboard, writeFragment } from '../clipboard';
import {
  clampPosition,
  deleteBackward,
  deleteForward,
  deleteSelection,
  pasteFragment,
  selectionBetween,
  typeText,
} from '../editing';
import { openPastedText } from '../openFile';
import { useEditDiff } from '../state/editDiff';
import { readLinearTheme } from './linearTheme';
import { SelectionBar } from './SelectionBar';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { recallView, rememberView } from '../state/viewMemory';

/** How long a notice about rejected input stays after the last rejected keystroke. */
const REJECTED_INPUT_NOTICE_MS = 5000;
/** How far a finger may drift and still have tapped rather than scrolled. */
const TOUCH_SLOP = 10;
/**
 * How long a finger has to rest before it selects instead of scrolling
 * (#43). Android's own long-press timeout is 400–500 ms; this is the upper
 * end, so a slow start to a scroll is not taken for a selection.
 */
export const LONG_PRESS_MS = 500;
/** How near the top or bottom edge a selecting finger scrolls the view. */
const EDGE_SCROLL_PX = 40;
/** How long the Copy button says "Copied" before it goes. */
const COPIED_MS = 1200;

/**
 * Follows the pointer even when it leaves the canvas mid-drag. Not every
 * environment has it (nor every pointer id, if the event was synthesized),
 * and a drag still works without it, so a refusal is not worth an error.
 */
function capturePointer(e: ReactPointerEvent<HTMLCanvasElement>): void {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // No capture; pointer events outside the canvas are simply not seen.
  }
}

function releasePointer(e: ReactPointerEvent<HTMLCanvasElement>): void {
  try {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  } catch {
    // Nothing was captured in the first place.
  }
}

interface Props {
  readonly doc: SeqDocument;
  /**
   * The phone's reader (`PhoneShell`): the bases alone, whatever the
   * Complement and Translations toggles say. The complement doubles every
   * row and a translation line adds one per CDS, and a phone has the
   * height for neither.
   */
  readonly reader?: boolean;
}

/** Room the selection bar takes, for placing it (px). */
const SELECTION_BAR_HEIGHT = 34;
const SELECTION_BAR_WIDTH = 300;
/** Height of the open Style menu, for which way it opens (px). */
const STYLE_MENU_HEIGHT = 420;

export function LinearSequenceView({ doc, reader = false }: Props) {
  const {
    selection,
    showComplement: complementPref,
    showTranslations: translationsPref,
    showCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    traceSize,
    baseColors,
    reveal,
    analysis,
    shownEnzymes,
    preview,
    documentId,
  } = useEditorState();
  const showComplement = complementPref && !reader;
  const showTranslations = translationsPref && !reader;
  const cutSites = useMemo(
    () =>
      showCutSites && analysis !== null && analysis.doc === doc
        ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme))
        : [],
    [analysis, doc, shownEnzymes, showCutSites],
  );
  const overlay = preview?.items ?? NO_OVERLAY;
  const previewLanes = useMemo(() => overlayLanes(overlay, doc.length), [overlay, doc.length]);
  const edits = useEditDiff();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  /** Whether the view has been measured, so rows are laid out at their real width. */
  // Without a ResizeObserver nothing will say the size changed, so the one
  // it has is the one to lay out at.
  const [measured, setMeasured] = useState(() => typeof ResizeObserver === 'undefined');
  /**
   * Where this tab's view was left (#33), put back once it has been measured,
   * and the scroll request standing when it came back to that row: it was
   * answered before the tab was left, so it is not answered again.
   */
  const [returning] = useState(() => {
    const topBase = recallView(documentId).topBase;
    return { topBase, answeredReveal: topBase === undefined ? undefined : reveal?.nonce };
  });
  const restoreTo = useRef(returning.topBase);
  /** Only ever non-zero when a fixed row width is wider than the viewport. */
  const [scrollLeft, setScrollLeft] = useState(0);
  /** What the pointer is over: the feature and translation tracks are click
      targets, the bases are text. */
  const [cursor, setCursor] = useState<'text' | 'pointer' | 'default'>('text');
  const dragAnchor = useRef<number | null>(null);
  /** While a mouse drag is making the selection, the selection bar waits for it to end. */
  const [dragging, setDragging] = useState(false);
  /** Where a finger came down; a tap is acted on when it lifts in place. */
  const touchTap = useRef<{ x: number; y: number } | null>(null);
  /** The long press waiting to fire while that finger rests (#43). */
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * The base a long press landed on, while the finger that made it drags
   * the selection; where that finger is now, for the edge scroll.
   */
  const touchSelect = useRef<{ anchor: number; clientX: number; clientY: number } | null>(null);
  const edgeFrame = useRef<number | null>(null);
  /** Copy, offered where a long-press selection was let go, over the bases it covers. */
  const [copyOffer, setCopyOffer] = useState<{
    readonly x: number;
    readonly y: number;
    readonly range: Range;
    readonly copied: boolean;
  } | null>(null);
  /** Codon drag on a translation line: the CDS being read and the codon it started on. */
  const codonDrag = useRef<{ translation: CdsTranslation; anchorIndex: number } | null>(null);
  /** Fixed end of the selection while extending with shift+arrows. */
  const anchor = useRef<number | null>(null);
  /** The run of codons Ctrl+Shift+arrows is extending, and where it started. */
  const codonRun = useRef<{
    translation: CdsTranslation;
    anchorIndex: number;
    index: number;
  } | null>(null);

  const monoFont = useMemo(() => monoFontOf(seqFontSize), [seqFontSize]);
  const sansFont = useMemo(() => sansFontOf(seqFontSize), [seqFontSize]);
  const charWidth = useMemo(() => measureCharWidth(monoFont), [monoFont]);
  const metrics = useMemo(() => {
    // A sticky end whose bottom strand runs past the sequence is drawn beside
    // the first or last column, so the gutter there has to hold it.
    const overhangs = endOverhangs(doc);
    const options = {
      fontSize: seqFontSize,
      basesPerRow: 10,
      charWidth,
      showComplement,
      // Tall enough for enzyme labels whenever any enzyme is shown, so rows keep
      // their height while sites are recomputed after an edit.
      cutSiteLabels: showCutSites && shownEnzymes.size > 0,
      // A read's chromatogram, above its bases (#52), as tall as Format says (#55).
      trace: doc.read?.trace == null || traceSize === 'off' ? (false as const) : traceSize,
      extraLeftGutter: overhangs.leftBottom * charWidth,
      extraRightGutter: overhangs.rightBottom * charWidth,
    };
    // The gutters scale with the text, so how many bases fit depends on the
    // font; build the metrics once to get them, then again with the answer.
    const blank = linearMetrics(options);
    const fitted = basesPerRowFor(size.width - blank.leftGutter - blank.rightGutter, charWidth);
    return { ...blank, basesPerRow: seqBasesPerRow ?? fitted };
  }, [
    doc,
    size.width,
    charWidth,
    seqFontSize,
    seqBasesPerRow,
    showComplement,
    showCutSites,
    shownEnzymes.size,
    traceSize,
  ]);
  /** How wide the rows are; more than the viewport when a fixed width overflows. */
  const contentWidth = linearWidth(metrics);
  const lanes = useMemo(() => assignLanes(drawableFeatures(doc.features.all()), doc.length), [doc]);
  const codingFeatures = useMemo(
    () => (showTranslations ? drawableFeatures(doc.features.all()).filter(isCodingFeature) : []),
    [doc, showTranslations],
  );
  const translationLanes = useMemo(
    () => assignLanes(codingFeatures, doc.length),
    [codingFeatures, doc.length],
  );
  // Every coding feature's translation, computed lazily per feature. Kept
  // whether or not the toggle is on: `translations` is what gets drawn, this
  // is what the keyboard reads to select a codon at a time.
  const allTranslations = useMemo(() => new CdsTranslations(doc), [doc]);
  const translations = showTranslations ? allTranslations : null;
  // Larger bases (#91) take more of a row, so the rows break around them.
  const breaks = useMemo(
    () => new RowBreaks(doc.length, metrics.basesPerRow, sizedRuns(doc.styles)),
    [doc.length, doc.styles, metrics.basesPerRow],
  );
  const layout = useMemo(() => {
    const perRow = lanesPerRow(drawableFeatures(doc.features.all()), lanes, doc.length, breaks);
    const translationsPerRow = lanesPerRow(codingFeatures, translationLanes, doc.length, breaks);
    const previewPerRow = overlaysPerRow(overlay, previewLanes, doc.length, breaks);
    return new LinearLayout(doc.length, metrics, perRow, translationsPerRow, previewPerRow, breaks);
  }, [doc, lanes, codingFeatures, translationLanes, metrics, overlay, previewLanes, breaks]);

  // Track the viewport size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    if (typeof ResizeObserver === 'undefined') return;
    const update = (entries?: ResizeObserverEntry[]): void => {
      // The content box excludes the scrollbars, so the canvas never overflows. The
      // observer's fractional size is floored: rounding it up (as clientHeight does)
      // can overflow by a fraction of a pixel, which pops a scrollbar in and out
      // whenever the rows are shorter than the viewport.
      const box = entries?.[0]?.contentRect;
      setSize((prev) => {
        const width = Math.max(200, Math.floor(box?.width ?? el.clientWidth));
        const height = Math.max(100, Math.floor(box?.height ?? el.clientHeight));
        return prev.width === width && prev.height === height ? prev : { width, height };
      });
      setMeasured(true);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // An empty document is there to be typed into: take the keyboard right away.
  const isEmpty = doc.length === 0;
  useEffect(() => {
    if (isEmpty) containerRef.current?.focus({ preventScroll: true });
  }, [isEmpty]);

  // Back to the row this tab was left on.
  useLayoutEffect(() => {
    const el = containerRef.current;
    const base = restoreTo.current;
    if (!measured || el === null || base === undefined) return;
    restoreTo.current = undefined;
    const row = layout.rowOfPosition(Math.min(base, Math.max(0, doc.length - 1)));
    if (row !== undefined) el.scrollTop = row.top;
    el.scrollLeft = recallView(documentId).scrollLeft ?? 0;
    setScrollTop(el.scrollTop);
    setScrollLeft(el.scrollLeft);
  }, [measured, layout, doc.length, documentId]);

  // Scroll to a requested position.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || reveal === null || reveal.nonce === returning.answeredReveal) return;
    const row = layout.rowOfPosition(reveal.position);
    if (row === undefined) return;
    const visible =
      row.top >= el.scrollTop && row.top + row.height <= el.scrollTop + el.clientHeight;
    if (!visible) el.scrollTop = Math.max(0, row.top - metrics.topPadding);
  }, [reveal, layout, metrics.topPadding, returning]);

  // A long-press selection takes the drag from the browser (#43). The only
  // way to stop a touch scroll once `touch-action` has allowed it is to
  // cancel the touchmove, and React's touch listeners are passive, so this
  // one is added by hand. It cancels nothing until a long press has fired:
  // before that a drag is the scroll it always was.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const hold = (e: Event): void => {
      if (touchSelect.current !== null && e.cancelable) e.preventDefault();
    };
    canvas.addEventListener('touchmove', hold, { passive: false });
    return () => {
      canvas.removeEventListener('touchmove', hold);
    };
  }, []);

  // A timer or a frame left running must not act on an unmounted view.
  useEffect(
    () => () => {
      if (pressTimer.current !== null) clearTimeout(pressTimer.current);
      if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    },
    [],
  );

  // The offer is for the selection it was made over; any other hides it.
  const offer =
    copyOffer !== null &&
    selection?.start === copyOffer.range.start &&
    selection.end === copyOffer.range.end
      ? copyOffer
      : null;

  // "Copied" is said for a moment, then the button goes.
  useEffect(() => {
    if (copyOffer?.copied !== true) return;
    const timer = setTimeout(() => {
      setCopyOffer(null);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copyOffer]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(size.width * dpr);
    const targetH = Math.round(size.height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
    const frame = requestAnimationFrame(() => {
      renderLinearView(ctx, {
        doc,
        layout,
        lanes,
        translations,
        translationLanes,
        selection,
        cutSites,
        overlay,
        overlayLanes: previewLanes,
        edits,
        colorBases,
        numberComplement,
        scrollTop,
        scrollLeft,
        width: size.width,
        height: size.height,
        devicePixelRatio: dpr,
        theme: readLinearTheme(container, baseColors),
        monoFont,
        sansFont,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    doc,
    layout,
    lanes,
    translations,
    translationLanes,
    selection,
    cutSites,
    overlay,
    previewLanes,
    edits,
    colorBases,
    numberComplement,
    scrollTop,
    scrollLeft,
    size,
    monoFont,
    sansFont,
    baseColors,
  ]);

  const pointAt = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    // The container's own scroll, not the state's: the edge scroll moves it
    // between renders.
    const el = containerRef.current;
    const top = el?.scrollTop ?? scrollTop;
    const left = el?.scrollLeft ?? scrollLeft;
    return { x: clientX - rect.left + left, y: clientY - rect.top + top };
  };

  const docPoint = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } =>
    pointAt(e.currentTarget, e.clientX, e.clientY);

  /**
   * The base under a client point, with `y` pulled into the nearest row and
   * `x` into it: a finger selecting holds on to the bases wherever it
   * strays, onto a feature bar, the gutter or past the last row.
   */
  const baseAt = (clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current;
    if (canvas === null || doc.length === 0) return null;
    const { x, y } = pointAt(canvas, clientX, clientY);
    const row =
      layout.rowAtY(y) ??
      (y < metrics.topPadding ? layout.rows[0] : layout.rows[layout.rows.length - 1]);
    if (row === undefined) return null;
    const column = Math.floor(layout.offsetAtX(row, x));
    return row.start + Math.min(row.end - row.start - 1, Math.max(0, column));
  };

  /** The bases from the long press's anchor to `base`, both included. */
  const selectToBase = (anchorBase: number, base: number): void => {
    editorStore.setSelection({
      start: Math.min(anchorBase, base),
      end: Math.max(anchorBase, base) + 1,
    });
  };

  const cancelLongPress = (): void => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  const stopEdgeScroll = (): void => {
    if (edgeFrame.current !== null) cancelAnimationFrame(edgeFrame.current);
    edgeFrame.current = null;
  };

  /**
   * A finger that has rested for `LONG_PRESS_MS`: select the base under it
   * and take the drag from the browser, which until now owned it as a
   * scroll. Nothing is taken earlier, so a scroll or a tap is exactly what
   * it was before (item 15).
   */
  const startTouchSelect = (clientX: number, clientY: number, pointerId: number): void => {
    pressTimer.current = null;
    const base = baseAt(clientX, clientY);
    if (base === null) return;
    touchTap.current = null; // the lift ends the selection, it is not a tap
    touchSelect.current = { anchor: base, clientX, clientY };
    setCopyOffer(null);
    try {
      canvasRef.current?.setPointerCapture(pointerId);
    } catch {
      // As in `capturePointer`: the drag still works over the canvas.
    }
    selectToBase(base, base);
    // A tick in the hand says the press was taken, where there is a motor.
    try {
      (navigator as { vibrate?: (pattern: number) => boolean }).vibrate?.(10);
    } catch {
      // Not everywhere, and not from every frame.
    }
  };

  /**
   * While a selecting finger is near the top or bottom edge, scroll that
   * way a frame at a time and keep extending: the stretch wanted may be
   * longer than a phone's screen, and the finger cannot scroll while it
   * selects.
   */
  const edgeScroll = (): void => {
    edgeFrame.current = null;
    const el = containerRef.current;
    const held = touchSelect.current;
    if (el === null || held === null) return;
    const rect = el.getBoundingClientRect();
    const intoTop = rect.top + EDGE_SCROLL_PX - held.clientY;
    const intoBottom = held.clientY - (rect.bottom - EDGE_SCROLL_PX);
    const step = intoTop > 0 ? -intoTop : intoBottom > 0 ? intoBottom : 0;
    if (step === 0 || rect.height <= 2 * EDGE_SCROLL_PX) return;
    const before = el.scrollTop;
    el.scrollTop = before + Math.round(step / 2);
    if (el.scrollTop === before) return; // at the end already
    const base = baseAt(held.clientX, held.clientY);
    if (base !== null) selectToBase(held.anchor, base);
    edgeFrame.current = requestAnimationFrame(edgeScroll);
  };

  /**
   * The hit under the pointer with `y` pulled into the nearest row, so a drag
   * that leaves the rows above or below still tracks the row it left.
   */
  const clampedHit = (e: ReactPointerEvent<HTMLCanvasElement>): Hit => {
    const { x, y } = docPoint(e);
    const row =
      layout.rowAtY(y) ??
      (y < metrics.topPadding ? layout.rows[0] : layout.rows[layout.rows.length - 1]);
    if (row === undefined) return { kind: 'none' };
    return layout.hitTest(x, Math.min(Math.max(y, row.top), row.top + row.height - 1));
  };

  /** The clickable previewed span under an overlay hit, if there is one there. */
  const spanAtHit = (hit: Hit): OverlaySpan | undefined =>
    hit.kind === 'overlay'
      ? overlayAt(overlay, doc.length, hit.position, previewLanes, hit.lane)
      : undefined;

  /** The feature drawn at a lane or translation hit; undefined where the lane is empty. */
  const featureAtHit = (hit: Hit): Feature | undefined => {
    if (hit.kind !== 'lane' && hit.kind !== 'translation') return undefined;
    const laneOf = hit.kind === 'lane' ? lanes.laneOf : translationLanes.laneOf;
    const index = hit.kind === 'lane' ? hit.lane : hit.line;
    return doc.features.at(hit.position, doc.length).find((f) => laneOf.get(f.id) === index);
  };

  const updateCursor = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = docPoint(e);
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'overlay') setCursor(spanAtHit(hit) === undefined ? 'default' : 'pointer');
    else if (hit.kind !== 'lane' && hit.kind !== 'translation') setCursor('text');
    else setCursor(featureAtHit(hit) === undefined ? 'default' : 'pointer');
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    setCopyOffer(null);
    if (e.pointerType === 'touch') {
      // A finger down is a scroll until it lifts in place, or a selection
      // once it has rested. The browser owns the drag (`touch-action` on the
      // canvas), so nothing is selected or captured here; `onPointerUp`
      // acts on the tap, the timer on the long press.
      touchTap.current = { x: e.clientX, y: e.clientY };
      cancelLongPress();
      const { clientX, clientY, pointerId } = e;
      pressTimer.current = setTimeout(() => {
        startTouchSelect(clientX, clientY, pointerId);
      }, LONG_PRESS_MS);
      return;
    }
    press(e);
  };

  /**
   * What a press does: selects the feature or the codon under it, or puts
   * the caret there and takes the drag that may follow.
   */
  const press = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = docPoint(e);
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'lane' || hit.kind === 'translation') {
      const feature = featureAtHit(hit);
      if (feature !== undefined) {
        // On a translation line the codon under the pointer is what is meant;
        // a drag from there extends the selection codon by codon.
        if (hit.kind === 'translation' && translations !== null) {
          const translation = translations.get(feature);
          const codon = codonIndexAt(translation, hit.position);
          const span = codon < 0 ? null : codonSpan(translation, codon, codon, doc.length);
          if (span !== null) {
            containerRef.current?.focus({ preventScroll: true });
            capturePointer(e);
            setDragging(true);
            codonDrag.current = { translation, anchorIndex: codon };
            anchor.current = span.start;
            editorStore.setSelection(span);
            return;
          }
        }
        editorStore.selectFeature(feature.id);
        return;
      }
    }
    if (hit.kind === 'overlay') {
      // The band is inert except where a panel has put something clickable
      // in it: the Cloning tab's digest fragments, which go to the shelf.
      const span = spanAtHit(hit);
      if (span !== undefined) editorStore.activatePreview(span.id);
      return;
    }
    if (hit.kind !== 'boundary') return;
    containerRef.current?.focus({ preventScroll: true });
    capturePointer(e);
    setDragging(true);
    if (e.shiftKey && selection !== null) {
      dragAnchor.current = hit.position >= selection.end ? selection.start : selection.end;
      editorStore.setSelection(selectionBetween(dragAnchor.current, hit.position));
    } else {
      dragAnchor.current = hit.position;
      editorStore.setSelection({ start: hit.position, end: hit.position });
    }
    anchor.current = dragAnchor.current;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const held = touchSelect.current;
    if (held !== null) {
      touchSelect.current = { ...held, clientX: e.clientX, clientY: e.clientY };
      const base = baseAt(e.clientX, e.clientY);
      if (base !== null) selectToBase(held.anchor, base);
      edgeFrame.current ??= requestAnimationFrame(edgeScroll);
      return;
    }
    const tap = touchTap.current;
    // A finger that moves before the press has fired is a scroll.
    if (tap !== null && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TOUCH_SLOP) {
      cancelLongPress();
    }
    const codon = codonDrag.current;
    if (codon !== null) {
      const hit = clampedHit(e);
      if (hit.kind === 'none') return;
      const index = codonIndexAt(codon.translation, hit.position);
      // Off the coding bases (an intron, or past either end): keep what is selected.
      if (index < 0) return;
      const span = codonSpan(codon.translation, codon.anchorIndex, index, doc.length);
      if (span !== null) editorStore.setSelection(span);
      return;
    }
    const anchor = dragAnchor.current;
    if (anchor === null) {
      updateCursor(e);
      return;
    }
    const hit = clampedHit(e);
    const position = hit.kind === 'none' ? anchor : hit.position;
    editorStore.setSelection(selectionBetween(anchor, position));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    cancelLongPress();
    const held = touchSelect.current;
    if (held !== null) {
      // The end of a long-press selection: offer to copy it, over where the
      // finger let go, since a phone has no Ctrl+C and no menu to find it in.
      touchSelect.current = null;
      stopEdgeScroll();
      releasePointer(e);
      const range = editorStore.getState().selection;
      if (range !== null && !isEmptyRange(range)) {
        const { x, y } = docPoint(e);
        setCopyOffer({ x, y, range, copied: false });
      }
      return;
    }
    const tap = touchTap.current;
    touchTap.current = null;
    // A finger that lifted where it landed was a tap, not a scroll; a scroll
    // arrives as a cancel, or as an up somewhere else.
    if (
      tap !== null &&
      e.type !== 'pointercancel' &&
      Math.hypot(e.clientX - tap.x, e.clientY - tap.y) <= TOUCH_SLOP
    ) {
      press(e);
    }
    setDragging(false);
    if (dragAnchor.current === null && codonDrag.current === null) return;
    dragAnchor.current = null;
    codonDrag.current = null;
    releasePointer(e);
    updateCursor(e);
  };

  /** Shows why typed or pasted text was rejected, for a while after the last rejection. */
  const rejectInput = (message: string): void => {
    editorStore.fail(message, { autoDismissMs: REJECTED_INPUT_NOTICE_MS });
  };

  const withText = (text: string): void => {
    if (doc.length === 0) {
      // A whole record pasted into an empty document replaces it.
      const format = detectFormat(text);
      if (format === 'genbank' || format === 'fasta') {
        openPastedText(text);
        return;
      }
    }
    // With nothing to click on yet, typing into an empty document goes at the start.
    const target = selection ?? (doc.length === 0 ? { start: 0, end: 0 } : null);
    try {
      editorStore.applyPlan(typeText(doc, target, text));
    } catch (err) {
      if (err instanceof InvalidSequenceError) rejectInput(err.message);
      else throw err;
    }
  };

  const withClipboard = (data: DataTransfer): void => {
    const content = readClipboard(data);
    if (typeof content === 'string') {
      withText(content);
      return;
    }
    try {
      editorStore.applyPlan(pasteFragment(doc, selection, content));
    } catch (err) {
      if (err instanceof InvalidSequenceError) rejectInput(err.message);
      else throw err;
    }
  };

  const moveCaret = (target: number, extend: boolean): void => {
    const position = clampPosition(doc, target);
    if (extend && selection !== null) {
      const fixed = anchor.current ?? selection.start;
      anchor.current = fixed;
      editorStore.setSelection(selectionBetween(fixed, position));
    } else {
      anchor.current = position;
      editorStore.setSelection({ start: position, end: position });
    }
    editorStore.revealPosition(position);
  };

  /**
   * Extends the selection by one codon of the coding feature the caret is
   * in. `step` is which way along the row, so it is reading order on a
   * forward CDS and against it on a reverse one — the same as dragging along
   * a translation line, which follows the pointer rather than the protein.
   *
   * Returns false when there is no codon to work from, so the caller can let
   * the plain arrow keys have the event.
   */
  const extendByCodon = (step: 1 | -1, position: number): boolean => {
    const run = codonRun.current;
    // The first press takes the codon the caret is in, as Shift+arrow takes
    // the base it is on; the presses after that extend from there.
    if (run === null) {
      for (const feature of doc.features.all()) {
        if (!isCodingFeature(feature)) continue;
        const translation = allTranslations.get(feature);
        const index = codonIndexAt(translation, position);
        if (index < 0) continue;
        const span = codonSpan(translation, index, index, doc.length);
        if (span === null) return false;
        codonRun.current = { translation, anchorIndex: index, index };
        anchor.current = span.start;
        editorStore.setSelection(span);
        return true;
      }
      return false;
    }
    // Which way along the row, not along the protein: a reverse-strand CDS
    // reads right to left, and the arrow keys follow the screen as dragging
    // along a translation line does.
    const forward = run.translation.strand !== 'reverse';
    const next = run.index + (forward ? step : -step);
    if (next < 0 || next >= run.translation.codons.length) return true; // held at the end
    const span = codonSpan(run.translation, run.anchorIndex, next, doc.length);
    if (span === null) return true;
    codonRun.current = { ...run, index: next };
    anchor.current = span.start;
    editorStore.setSelection(span);
    editorStore.revealPosition(run.translation.codons[next]?.positions[0] ?? span.start);
    return true;
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey;
    const focus =
      selection === null ? 0 : anchor.current === selection.start ? selection.end : selection.start;
    // Any other key ends the run of codons, so the next Ctrl+Shift+arrow
    // starts again from wherever the caret has got to.
    if (!(mod && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
      codonRun.current = null;
    }
    if (mod) {
      const key = e.key.toLowerCase();
      if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        if (extendByCodon(e.key === 'ArrowRight' ? 1 : -1, focus)) {
          e.preventDefault();
          analytics.shortcut('ctrl+shift+arrow');
          return;
        }
      }
      if (key === 'z' || key === 'y') analytics.shortcut('ctrl+z');
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) editorStore.redo();
        else editorStore.undo();
      } else if (key === 'y') {
        e.preventDefault();
        editorStore.redo();
      } else if (key === 'a') {
        e.preventDefault();
        anchor.current = 0;
        editorStore.setSelection({ start: 0, end: doc.length });
      } else if (key === 'home' || key === 'end') {
        e.preventDefault();
        moveCaret(key === 'home' ? 0 : doc.length, e.shiftKey);
      }
      return; // copy/cut/paste arrive as clipboard events
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        e.preventDefault();
        if (selection === null) {
          moveCaret(0, false);
          return;
        }
        const step =
          e.key === 'ArrowLeft'
            ? -1
            : e.key === 'ArrowRight'
              ? 1
              : layout.positionInRowBeside(focus, e.key === 'ArrowUp' ? -1 : 1) - focus;
        if (
          !e.shiftKey &&
          !isEmptyRange(selection) &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
        ) {
          // Collapse the selection to the side we are moving towards.
          moveCaret(e.key === 'ArrowLeft' ? selection.start : selection.end, false);
          return;
        }
        moveCaret(focus + step, e.shiftKey);
        return;
      }
      case 'Home':
      case 'End': {
        e.preventDefault();
        if (selection === null) return;
        const row = layout.rowOfPosition(focus);
        if (row === undefined) return;
        moveCaret(e.key === 'Home' ? row.start : row.end, e.shiftKey);
        return;
      }
      case 'Backspace':
        e.preventDefault();
        editorStore.applyPlan(deleteBackward(doc, selection));
        return;
      case 'Delete':
        e.preventDefault();
        editorStore.applyPlan(deleteForward(doc, selection));
        return;
      case 'Escape':
        editorStore.setSelection(null);
        return;
      default:
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault();
          withText(e.key);
        }
    }
  };

  /** Copies the selection, bases and features, to the clipboard; false when nothing is selected. */
  const copySelection = (data: DataTransfer): boolean => {
    if (selection === null || isEmptyRange(selection)) return false;
    writeFragment(data, fragmentFromRange(doc, selection));
    return true;
  };

  /**
   * Where the selection bar goes (#89). Above the selection's first row,
   * over its ruler, with the Style menu opening upwards, when there is room
   * for the menu there; otherwise under the selection's last row with the
   * menu opening downwards. Either way the menu leaves the selected bases in
   * sight while it restyles them. Failing both, above with the menu down.
   * Null when there is no range selected, or neither place is on screen.
   */
  function selectionBarPlace(): { left: number; top: number; menuOpens: 'up' | 'down' } | null {
    if (selection === null || isEmptyRange(selection) || doc.length === 0) return null;
    const start = selection.start % doc.length;
    const last = (selection.end - 1) % doc.length;
    const first = layout.rowOfPosition(start);
    const end = layout.rowOfPosition(last);
    if (first === undefined || end === undefined) return null;
    const clampLeft = (x: number): number =>
      Math.max(scrollLeft + 8, Math.min(x - 8, scrollLeft + size.width - SELECTION_BAR_WIDTH));
    const bottom = scrollTop + size.height;
    const onScreen = (top: number): boolean =>
      top >= scrollTop + 4 && top <= bottom - SELECTION_BAR_HEIGHT;
    const above = first.top + metrics.rulerHeight - SELECTION_BAR_HEIGHT;
    const aboveAt = { left: clampLeft(layout.xOf(first, start)), top: above };
    const below = layout.forwardTextTop(end) + layout.strandsHeight(end) + 4;
    const belowAt = { left: clampLeft(layout.xOf(end, last)), top: below };
    if (onScreen(above) && above - scrollTop >= STYLE_MENU_HEIGHT) {
      return { ...aboveAt, menuOpens: 'up' };
    }
    if (onScreen(below) && bottom - below >= SELECTION_BAR_HEIGHT + STYLE_MENU_HEIGHT) {
      return { ...belowAt, menuOpens: 'down' };
    }
    if (onScreen(above)) return { ...aboveAt, menuOpens: 'down' };
    if (onScreen(below)) return { ...belowAt, menuOpens: 'down' };
    return null;
  }

  const onCopy = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    if (copySelection(e.clipboardData)) e.preventDefault();
  };

  const onCut = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    if (selection === null || !copySelection(e.clipboardData)) return;
    e.preventDefault();
    editorStore.applyPlan(deleteSelection(doc, selection));
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault();
    withClipboard(e.clipboardData);
  };

  const bar = reader || dragging ? null : selectionBarPlace();

  return (
    <div
      ref={containerRef}
      className="seq-view"
      tabIndex={0}
      onScroll={(e) => {
        const { scrollTop: top, scrollLeft: left } = e.currentTarget;
        setScrollTop(top);
        setScrollLeft(left);
        rememberView(documentId, { topBase: layout.rowAtY(top)?.start ?? 0, scrollLeft: left });
      }}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      role="textbox"
      aria-multiline="true"
      aria-label="Sequence"
    >
      {isEmpty && (
        <p className="seq-view__placeholder" aria-hidden="true">
          Type or paste a DNA sequence to start. Pasting a GenBank or FASTA record opens it instead.
        </p>
      )}
      <div
        className="seq-view__spacer"
        style={{ height: layout.totalHeight, width: Math.max(contentWidth, size.width) }}
      >
        <canvas
          ref={canvasRef}
          className="seq-view__canvas"
          style={{ width: size.width, height: size.height, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => {
            setCursor('text');
          }}
          onContextMenu={(e) => {
            // A resting finger is ours: Android answers it with a context
            // menu (and iOS with a callout) unless told not to.
            if (touchTap.current !== null || touchSelect.current !== null) e.preventDefault();
          }}
        />
        {bar !== null && selection !== null && (
          <SelectionBar
            doc={doc}
            selection={selection}
            left={bar.left}
            top={bar.top}
            menuOpens={bar.menuOpens}
          />
        )}
        {offer !== null && (
          <button
            type="button"
            className="seq-view__copy"
            style={{
              left: Math.max(scrollLeft + 8, Math.min(offer.x - 36, scrollLeft + size.width - 88)),
              top: Math.max(scrollTop + 8, offer.y - 64),
            }}
            onClick={() => {
              if (offer.copied) return;
              copyFragment(fragmentFromRange(doc, offer.range));
              analytics.track('phone', 'long-press-copy');
              setCopyOffer({ ...offer, copied: true });
            }}
          >
            {offer.copied
              ? 'Copied'
              : `Copy ${(offer.range.end - offer.range.start).toLocaleString()} bp`}
          </button>
        )}
      </div>
    </div>
  );
}
