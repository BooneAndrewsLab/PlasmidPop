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
  type SeqDocument,
  CdsTranslations,
  InvalidSequenceError,
  isCodingFeature,
  isEmptyRange,
} from '@/core';
import {
  type LinearMetrics,
  type LinearTheme,
  LinearLayout,
  assignLanes,
  basesPerRowFor,
  lanesPerRow,
  measureCharWidth,
  renderLinearView,
} from '@/view/linear';
import { drawableFeatures } from '@/view/visibleFeatures';

import {
  clampPosition,
  deleteBackward,
  deleteForward,
  deleteSelection,
  selectionBetween,
  typeText,
} from '../editing';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

const MONO_FONT = '13px ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const SANS_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const LEFT_GUTTER = 72;
const RIGHT_PADDING = 24;

function readTheme(el: HTMLElement): LinearTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--seq-ink', '#1c2430'),
    inkMuted: v('--seq-ink-muted', '#8a94a3'),
    gutterText: v('--seq-gutter', '#8a94a3'),
    rulerLine: v('--seq-rule', '#c8cdd5'),
    selectionFill: v('--seq-selection', 'rgba(27, 110, 140, 0.22)'),
    caret: v('--seq-caret', '#1b6e8c'),
    background: v('--surface', '#ffffff'),
    cutSite: v('--seq-cut', '#b3261e'),
  };
}

interface Props {
  readonly doc: SeqDocument;
}

export function LinearSequenceView({ doc }: Props) {
  const { selection, showComplement, showTranslations, reveal, analysis, shownEnzymes } =
    useEditorState();
  const cutSites = useMemo(
    () =>
      analysis !== null && analysis.doc === doc
        ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme))
        : [],
    [analysis, doc, shownEnzymes],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const dragAnchor = useRef<number | null>(null);
  /** Fixed end of the selection while extending with shift+arrows. */
  const anchor = useRef<number | null>(null);

  const charWidth = useMemo(() => measureCharWidth(MONO_FONT), []);
  const metrics = useMemo<LinearMetrics>(
    () => ({
      basesPerRow: basesPerRowFor(size.width - LEFT_GUTTER - RIGHT_PADDING, charWidth),
      charWidth,
      lineHeight: 18,
      showComplement,
      rulerHeight: cutSites.length > 0 ? 30 : 16,
      laneHeight: 20,
      translationHeight: 16,
      rowGap: 14,
      leftGutter: LEFT_GUTTER,
      topPadding: 12,
    }),
    [size.width, charWidth, showComplement, cutSites.length],
  );
  const lanes = useMemo(() => assignLanes(drawableFeatures(doc.features.all()), doc.length), [doc]);
  const codingFeatures = useMemo(
    () => (showTranslations ? drawableFeatures(doc.features.all()).filter(isCodingFeature) : []),
    [doc, showTranslations],
  );
  const translationLanes = useMemo(
    () => assignLanes(codingFeatures, doc.length),
    [codingFeatures, doc.length],
  );
  const translations = useMemo(
    () => (showTranslations ? new CdsTranslations(doc) : null),
    [doc, showTranslations],
  );
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
    return new LinearLayout(doc.length, metrics, perRow, translationsPerRow);
  }, [doc, lanes, codingFeatures, translationLanes, metrics]);

  // Track the viewport size.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const update = (): void => {
      // clientWidth/Height exclude the scrollbars, so the canvas never overflows.
      setSize((prev) => {
        const width = Math.max(200, el.clientWidth);
        const height = Math.max(100, el.clientHeight);
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
        scrollTop,
        width: size.width,
        height: size.height,
        devicePixelRatio: dpr,
        theme: readTheme(container),
        monoFont: MONO_FONT,
        sansFont: SANS_FONT,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [doc, layout, lanes, translations, translationLanes, selection, cutSites, scrollTop, size]);

  const docPoint = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top + scrollTop };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const { x, y } = docPoint(e);
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'lane' || hit.kind === 'translation') {
      const laneOf = hit.kind === 'lane' ? lanes.laneOf : translationLanes.laneOf;
      const index = hit.kind === 'lane' ? hit.lane : hit.line;
      const feature = doc.features
        .at(hit.position, doc.length)
        .find((f) => laneOf.get(f.id) === index);
      if (feature !== undefined) {
        editorStore.selectFeature(feature.id);
        return;
      }
    }
    if (hit.kind !== 'boundary') return;
    containerRef.current?.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
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
    const anchor = dragAnchor.current;
    if (anchor === null) return;
    const { x, y } = docPoint(e);
    const row =
      layout.rowAtY(y) ??
      (y < metrics.topPadding ? layout.rows[0] : layout.rows[layout.rows.length - 1]);
    if (row === undefined) return;
    const hit = layout.hitTest(x, Math.min(Math.max(y, row.top), row.top + row.height - 1));
    const position = hit.kind === 'none' ? anchor : hit.position;
    editorStore.setSelection(selectionBetween(anchor, position));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (dragAnchor.current === null) return;
    dragAnchor.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const withText = (text: string): void => {
    try {
      editorStore.applyPlan(typeText(doc, selection, text));
    } catch (err) {
      if (err instanceof InvalidSequenceError) editorStore.fail(err.message);
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

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    const mod = e.ctrlKey || e.metaKey;
    const focus =
      selection === null ? 0 : anchor.current === selection.start ? selection.end : selection.start;
    if (mod) {
      const key = e.key.toLowerCase();
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

  const selectedText = (): string =>
    selection === null || isEmptyRange(selection) ? '' : doc.subsequence(selection);

  const onCopy = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    const text = selectedText();
    if (text === '') return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
  };

  const onCut = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    const text = selectedText();
    if (text === '' || selection === null) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    editorStore.applyPlan(deleteSelection(doc, selection));
  };

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault();
    withText(e.clipboardData.getData('text/plain'));
  };

  return (
    <div
      ref={containerRef}
      className="seq-view"
      tabIndex={0}
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      role="textbox"
      aria-multiline="true"
      aria-label="Sequence"
    >
      <div className="seq-view__spacer" style={{ height: layout.totalHeight }}>
        <canvas
          ref={canvasRef}
          className="seq-view__canvas"
          style={{ width: size.width, height: size.height }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}
