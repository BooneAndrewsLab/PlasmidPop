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
  type CircularTheme,
  CircularLayout,
  clockwiseSelection,
  renderCircularMap,
} from '@/view/circular';
import { assignLanes } from '@/view/linear';
import { drawableFeatures } from '@/view/visibleFeatures';

import { selectionBetween } from '../editing';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

const SANS_FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = '600 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const RING_WIDTH = 14;
const OUTER_MARGIN = 110;

function readTheme(el: HTMLElement): CircularTheme {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string): string =>
    css.getPropertyValue(name).trim() || fallback;
  return {
    ink: v('--ink', '#1c2430'),
    inkMuted: v('--ink-3', '#8a94a3'),
    backbone: v('--ink-2', '#4a5566'),
    tick: v('--seq-rule', '#c8cdd5'),
    selectionFill: v('--seq-selection', 'rgba(27, 110, 140, 0.22)'),
    caret: v('--seq-caret', '#1b6e8c'),
    background: v('--surface', '#ffffff'),
    leader: v('--line', '#d5dae2'),
    cutSite: v('--seq-cut', '#b3261e'),
  };
}

interface Props {
  readonly doc: SeqDocument;
}

export function CircularMapView({ doc }: Props) {
  const { selection, analysis, shownEnzymes } = useEditorState();
  const cutSites = useMemo(
    () =>
      analysis !== null && analysis.doc === doc
        ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme))
        : [],
    [analysis, doc, shownEnzymes],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [hovered, setHovered] = useState<string | null>(null);
  const dragAnchor = useRef<number | null>(null);

  const lanes = useMemo(() => assignLanes(drawableFeatures(doc.features.all()), doc.length), [doc]);
  const layout = useMemo(
    () =>
      new CircularLayout(doc.length, doc.topology, {
        width: size.width,
        height: size.height,
        laneCount: lanes.laneCount,
        ringWidth: RING_WIDTH,
        outerMargin: OUTER_MARGIN,
      }),
    [doc.length, doc.topology, size, lanes.laneCount],
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const update = (): void => {
      setSize((prev) => {
        const width = Math.max(200, el.clientWidth);
        const height = Math.max(200, el.clientHeight);
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

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas === null || container === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const frame = requestAnimationFrame(() => {
      renderCircularMap(ctx, {
        doc,
        layout,
        lanes,
        selection,
        cutSites,
        hoveredFeatureId: hovered,
        width: size.width,
        height: size.height,
        devicePixelRatio: dpr,
        theme: readTheme(container),
        sansFont: SANS_FONT,
        titleFont: TITLE_FONT,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [doc, layout, lanes, selection, cutSites, hovered, size]);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const featureAt = (lane: number, position: number): string | null => {
    const f = doc.features.at(position, doc.length).find((x) => lanes.laneOf.get(x.id) === lane);
    return f?.id ?? null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0) return;
    const { x, y } = point(e);
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'lane') {
      const id = featureAt(hit.lane, hit.position);
      if (id !== null) editorStore.selectFeature(id);
      return;
    }
    if (hit.kind !== 'backbone') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragAnchor.current = hit.position;
    editorStore.setSelection({ start: hit.position, end: hit.position });
    editorStore.revealPosition(hit.position);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const { x, y } = point(e);
    const hit = layout.hitTest(x, y);
    const anchor = dragAnchor.current;
    if (anchor !== null) {
      if (hit.kind === 'none') return;
      editorStore.setSelection(
        doc.isCircular
          ? clockwiseSelection(anchor, hit.position, doc.length)
          : selectionBetween(anchor, hit.position),
      );
      return;
    }
    const id = hit.kind === 'lane' ? featureAt(hit.lane, hit.position) : null;
    setHovered((prev) => (prev === id ? prev : id));
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (dragAnchor.current === null) return;
    dragAnchor.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div ref={containerRef} className="map-view" role="img" aria-label={`Map of ${doc.name}`}>
      <canvas
        ref={canvasRef}
        className="map-view__canvas"
        style={{
          width: size.width,
          height: size.height,
          cursor: hovered === null ? 'default' : 'pointer',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          setHovered(null);
        }}
      />
    </div>
  );
}
