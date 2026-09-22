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
} from '@/view/linear';
import { NO_OVERLAY, overlayLanes, overlaysPerRow } from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { detectFormat } from '@/io';

import { readClipboard, writeFragment } from '../clipboard';
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
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** How long a notice about rejected input stays after the last rejected keystroke. */
const REJECTED_INPUT_NOTICE_MS = 5000;

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
}

export function LinearSequenceView({ doc }: Props) {
  const {
    selection,
    showComplement,
    showTranslations,
    showCutSites,
    seqFontSize,
    seqBasesPerRow,
    numberComplement,
    colorBases,
    reveal,
    analysis,
    shownEnzymes,
    preview,
  } = useEditorState();
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
  /** Only ever non-zero when a fixed row width is wider than the viewport. */
  const [scrollLeft, setScrollLeft] = useState(0);
  /** What the pointer is over: the feature and translation tracks are click
      targets, the bases are text. */
  const [cursor, setCursor] = useState<'text' | 'pointer' | 'default'>('text');
  const dragAnchor = useRef<number | null>(null);
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
  const layout = useMemo(() => {
    const perRow = lanesPerRow(
      drawableFeatures(doc.features.all()),
      lanes,
      doc.length,
      metrics.basesPerRow,
    );
    const translationsPerRow = lanesPerRow(
      codingFeatures,
      translationLanes,
      doc.length,
      metrics.basesPerRow,
    );
    const previewPerRow = overlaysPerRow(overlay, previewLanes, doc.length, metrics.basesPerRow);
    return new LinearLayout(doc.length, metrics, perRow, translationsPerRow, previewPerRow);
  }, [doc, lanes, codingFeatures, translationLanes, metrics, overlay, previewLanes]);

  // Track the viewport size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
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

  // Scroll to a requested position.
  useEffect(() => {
    const el = containerRef.current;
    if (el === null || reveal === null) return;
    const row = layout.rowOfPosition(reveal.position);
    if (row === undefined) return;
    const visible =
      row.top >= el.scrollTop && row.top + row.height <= el.scrollTop + el.clientHeight;
    if (!visible) el.scrollTop = Math.max(0, row.top - metrics.topPadding);
  }, [reveal, layout, metrics.topPadding]);

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
        theme: readLinearTheme(container),
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
  ]);

  const docPoint = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left + scrollLeft, y: e.clientY - rect.top + scrollTop };
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
    if (hit.kind === 'overlay') setCursor('default');
    else if (hit.kind !== 'lane' && hit.kind !== 'translation') setCursor('text');
    else setCursor(featureAtHit(hit) === undefined ? 'default' : 'pointer');
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
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
    if (hit.kind !== 'boundary') return;
    containerRef.current?.focus({ preventScroll: true });
    capturePointer(e);
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
          return;
        }
      }
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
              : e.key === 'ArrowUp'
                ? -metrics.basesPerRow
                : metrics.basesPerRow;
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

  return (
    <div
      ref={containerRef}
      className="seq-view"
      tabIndex={0}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        setScrollLeft(e.currentTarget.scrollLeft);
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
        />
      </div>
    </div>
  );
}
