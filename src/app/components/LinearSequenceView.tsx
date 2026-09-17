import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type SeqDocument } from '@/core';
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
  };
}

interface Props {
  readonly doc: SeqDocument;
}

export function LinearSequenceView({ doc }: Props) {
  const { selection, showComplement, reveal } = useEditorState();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const dragAnchor = useRef<number | null>(null);

  const charWidth = useMemo(() => measureCharWidth(MONO_FONT), []);
  const metrics = useMemo<LinearMetrics>(
    () => ({
      basesPerRow: basesPerRowFor(size.width - LEFT_GUTTER - RIGHT_PADDING, charWidth),
      charWidth,
      lineHeight: 18,
      showComplement,
      rulerHeight: 16,
      laneHeight: 20,
      rowGap: 14,
      leftGutter: LEFT_GUTTER,
      topPadding: 12,
    }),
    [size.width, charWidth, showComplement],
  );
  const lanes = useMemo(() => assignLanes(doc.features.all(), doc.length), [doc]);
  const layout = useMemo(() => {
    const perRow = lanesPerRow(doc.features.all(), lanes, doc.length, metrics.basesPerRow);
    return new LinearLayout(doc.length, metrics, perRow);
  }, [doc, lanes, metrics]);

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
        selection,
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
  }, [doc, layout, lanes, selection, scrollTop, size]);

  const docPoint = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top + scrollTop };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const { x, y } = docPoint(e);
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'lane') {
      const feature = doc.features
        .at(hit.position, doc.length)
        .find((f) => lanes.laneOf.get(f.id) === hit.lane);
      if (feature !== undefined) {
        editorStore.selectFeature(feature.id);
        return;
      }
    }
    if (hit.kind !== 'boundary') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.shiftKey && selection !== null) {
      dragAnchor.current = hit.position >= selection.end ? selection.start : selection.end;
      editorStore.setSelection(ordered(dragAnchor.current, hit.position));
    } else {
      dragAnchor.current = hit.position;
      editorStore.setSelection({ start: hit.position, end: hit.position });
    }
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
    editorStore.setSelection(ordered(anchor, position));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (dragAnchor.current === null) return;
    dragAnchor.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
      className="seq-view"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
      }}
      role="region"
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

function ordered(a: number, b: number): { start: number; end: number } {
  return a <= b ? { start: a, end: b } : { start: b, end: a };
}
