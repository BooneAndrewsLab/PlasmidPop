import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type Feature, type RangeSegment, type SeqDocument, isEmptyRange } from '@/core';
import {
  type MapViewport,
  CircularLayout,
  FIT_VIEWPORT,
  clockwiseSelection,
  fitRange,
  panBy,
  renderCircularMap,
  zoomAround,
} from '@/view/circular';
import { assignLanes } from '@/view/linear';
import { NO_OVERLAY, overlayLanes } from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { selectionBetween } from '../editing';
import { readCircularTheme } from './circularTheme';
import { useEditDiff } from '../state/editDiff';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

const SANS_FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = '600 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const RING_WIDTH = 14;
const OUTER_MARGIN = 110;
/** How far the pointer may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 3;
/** Zoom factor of one press of the +/− buttons and of a double-click. */
const ZOOM_STEP = 1.6;

/** First range segment's start through the last one's end, as the map draws it. */
function featureExtent(feature: Feature): { start: number; end: number } | null {
  const ranges = feature.segments.filter((s): s is RangeSegment => s.kind === 'range');
  const first = ranges[0];
  const last = ranges[ranges.length - 1];
  if (first === undefined || last === undefined) return null;
  return { start: first.start, end: Math.max(last.end, first.end) };
}

type Gesture =
  | { readonly kind: 'idle' }
  | { readonly kind: 'select'; readonly anchor: number }
  | {
      readonly kind: 'pan';
      readonly button: number;
      readonly from: { x: number; y: number };
      last: { x: number; y: number };
      moved: boolean;
    }
  | { readonly kind: 'pinch'; prev: { dist: number; x: number; y: number } | null };

interface Hover {
  readonly featureId: string | null;
  /** Top-strand cut position under the pointer; the map keeps its label. */
  readonly cut: number | null;
  readonly kind: 'lane' | 'backbone' | 'none';
}

const NO_HOVER: Hover = { featureId: null, cut: null, kind: 'none' };

/** Half-width of the band a cut site's tick is hit-tested in, in pixels. */
const CUT_HIT_PX = 6;

interface Props {
  readonly doc: SeqDocument;
}

export function CircularMapView({ doc }: Props) {
  const { selection, analysis, shownEnzymes, showCutSites, documentId, reveal, preview } =
    useEditorState();
  const overlay = preview?.items ?? NO_OVERLAY;
  const edits = useEditDiff();
  const previewLanes = useMemo(() => overlayLanes(overlay, doc.length), [overlay, doc.length]);
  const cutSites = useMemo(
    () =>
      showCutSites && analysis !== null && analysis.doc === doc
        ? analysis.cutSites.filter((s) => shownEnzymes.has(s.enzyme))
        : [],
    [analysis, doc, shownEnzymes, showCutSites],
  );
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [hover, setHover] = useState<Hover>(NO_HOVER);
  const [panning, setPanning] = useState(false);
  const [viewport, setViewport] = useState<MapViewport>(FIT_VIEWPORT);
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // A newly opened document starts with the whole circle in view.
  const [viewportDocId, setViewportDocId] = useState(documentId);
  if (documentId !== viewportDocId) {
    setViewportDocId(documentId);
    setViewport(FIT_VIEWPORT);
  }

  const lanes = useMemo(() => assignLanes(drawableFeatures(doc.features.all()), doc.length), [doc]);
  const layout = useMemo(() => {
    const options = {
      width: size.width,
      height: size.height,
      laneCount: lanes.laneCount,
      ringWidth: RING_WIDTH,
      outerMargin: OUTER_MARGIN,
    };
    const first = new CircularLayout(doc.length, doc.topology, { ...options, viewport });
    // Re-clamp when the canvas shrank or the lane count changed under a zoomed view.
    const clamped = panBy(viewport, first.bounds, 0, 0);
    return clamped === viewport ||
      (clamped.zoom === viewport.zoom &&
        clamped.panX === viewport.panX &&
        clamped.panY === viewport.panY)
      ? first
      : new CircularLayout(doc.length, doc.topology, { ...options, viewport: clamped });
  }, [doc.length, doc.topology, size, lanes.laneCount, viewport]);

  // Handlers registered outside React (wheel) and fast gesture updates read
  // the latest layout through refs rather than re-binding on every render.
  const layoutRef = useRef(layout);
  const viewportRef = useRef(layout.viewport);
  useLayoutEffect(() => {
    layoutRef.current = layout;
    viewportRef.current = layout.viewport;
  }, [layout]);

  const commit = useCallback((next: MapViewport): void => {
    viewportRef.current = next;
    setViewport(next);
  }, []);

  // Room kept around a fitted arc for its lanes and labels; matching the
  // fit-to-canvas margin means fitting the whole circle is exactly zoom 1.
  const labelPad = Math.max(OUTER_MARGIN, 20 + lanes.laneCount * RING_WIDTH);

  const zoomTo = (start: number, end: number): void => {
    commit(fitRange(layout.bounds, start, end, doc.length, labelPad));
  };
  const zoomBy = (factor: number, x = size.width / 2, y = size.height / 2): void => {
    commit(zoomAround(viewportRef.current, layout.bounds, x, y, factor));
  };

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

  // Mouse wheel and trackpad pinch (which arrives as ctrl+wheel) zoom about
  // the cursor. React's onWheel is passive, so the listener is attached
  // by hand to be allowed to stop the page from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const current = layoutRef.current;
      const rect = canvas.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
      commit(
        zoomAround(
          viewportRef.current,
          current.bounds,
          e.clientX - rect.left,
          e.clientY - rect.top,
          factor,
        ),
      );
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [commit]);

  // The pan is in pixels from the canvas centre, so when a resize or a
  // change in lane count alters the base radius, scaling it by the same
  // ratio keeps the map point at the canvas centre where it was.
  const baseRadiusRef = useRef(layout.baseRadius);
  useEffect(() => {
    const prev = baseRadiusRef.current;
    baseRadiusRef.current = layout.baseRadius;
    if (prev === layout.baseRadius || layout.zoom <= 1) return;
    const ratio = layout.baseRadius / prev;
    const { zoom, panX, panY } = layout.viewport;
    commit(panBy({ zoom, panX: panX * ratio, panY: panY * ratio }, layout.bounds, 0, 0));
  }, [layout, commit]);

  // When another view asks to reveal a position (feature list click, find),
  // a zoomed-in map pans so that position is on screen.
  useEffect(() => {
    if (reveal === null) return;
    const current = layoutRef.current;
    if (current.zoom <= 1) return;
    const pt = current.pointAt(reveal.position, current.radius);
    if (current.isOnCanvas(pt.x, pt.y, -20)) return;
    commit(
      panBy(
        viewportRef.current,
        current.bounds,
        current.width / 2 - pt.x,
        current.height / 2 - pt.y,
      ),
    );
  }, [reveal, commit]);

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
        overlay,
        overlayLanes: previewLanes,
        edits,
        hoveredFeatureId: hover.featureId,
        hoveredCut: hover.cut,
        width: size.width,
        height: size.height,
        devicePixelRatio: dpr,
        theme: readCircularTheme(container),
        sansFont: SANS_FONT,
        titleFont: TITLE_FONT,
      });
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    doc,
    layout,
    lanes,
    selection,
    cutSites,
    overlay,
    previewLanes,
    edits,
    hover.featureId,
    hover.cut,
    size,
  ]);

  const point = (
    e: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /**
   * The cut site whose tick is under the pointer, so the map can bring back
   * a cut label the ring had no room for. Hover only: a press near the
   * backbone still starts a selection.
   */
  const cutAt = (x: number, y: number): number | null => {
    if (cutSites.length === 0 || doc.length === 0) return null;
    const r = Math.hypot(x - layout.cx, y - layout.cy);
    if (r < layout.radius - 10 || r > layout.radius + 12) return null;
    const angle = Math.atan2(y - layout.cy, x - layout.cx);
    const twoPi = Math.PI * 2;
    let best: number | null = null;
    let bestPx = CUT_HIT_PX;
    for (const site of cutSites) {
      let d = (layout.angleOf(site.cut) - angle + Math.PI) % twoPi;
      if (d < 0) d += twoPi;
      const px = Math.abs(d - Math.PI) * layout.radius;
      if (px < bestPx) {
        bestPx = px;
        best = site.cut;
      }
    }
    return best;
  };

  const featureAt = (lane: number, position: number): string | null => {
    const f = doc.features.at(position, doc.length).find((x) => lanes.laneOf.get(x.id) === lane);
    return f?.id ?? null;
  };

  const endGesture = (): void => {
    gesture.current = { kind: 'idle' };
    setPanning(false);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    pointers.current.set(e.pointerId, pt);
    if (pointers.current.size === 2) {
      // A second finger turns whatever was happening into a pinch.
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'pinch', prev: null };
      setPanning(false);
      return;
    }
    if (pointers.current.size > 2) return;
    const hit = layout.hitTest(pt.x, pt.y);
    if (e.button === 1 || (e.button === 0 && hit.kind === 'none')) {
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'pan', button: e.button, from: pt, last: pt, moved: false };
      setPanning(layout.zoom > 1);
      return;
    }
    if (e.button !== 0) return;
    if (hit.kind === 'lane') {
      const id = featureAt(hit.lane, hit.position);
      if (id !== null) editorStore.selectFeature(id);
      return;
    }
    if (hit.kind !== 'backbone') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind: 'select', anchor: hit.position };
    editorStore.setSelection({ start: hit.position, end: hit.position });
    editorStore.revealPosition(hit.position);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g.prev !== null) {
        const bounds = layoutRef.current.bounds;
        const zoomed = zoomAround(
          viewportRef.current,
          bounds,
          g.prev.x,
          g.prev.y,
          dist / g.prev.dist,
        );
        commit(panBy(zoomed, bounds, mid.x - g.prev.x, mid.y - g.prev.y));
      }
      g.prev = { dist, ...mid };
      return;
    }
    if (g.kind === 'pan') {
      const bounds = layoutRef.current.bounds;
      commit(panBy(viewportRef.current, bounds, pt.x - g.last.x, pt.y - g.last.y));
      g.last = pt;
      if (Math.hypot(pt.x - g.from.x, pt.y - g.from.y) > CLICK_SLOP) g.moved = true;
      return;
    }
    const hit = layout.hitTest(pt.x, pt.y);
    if (g.kind === 'select') {
      if (hit.kind === 'none') return;
      editorStore.setSelection(
        doc.isCircular
          ? clockwiseSelection(g.anchor, hit.position, doc.length)
          : selectionBetween(g.anchor, hit.position),
      );
      return;
    }
    const next: Hover = {
      featureId: hit.kind === 'lane' ? featureAt(hit.lane, hit.position) : null,
      cut: hit.kind === 'lane' ? null : cutAt(pt.x, pt.y),
      kind: hit.kind,
    };
    setHover((prev) =>
      prev.featureId === next.featureId && prev.cut === next.cut && prev.kind === next.kind
        ? prev
        : next,
    );
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const g = gesture.current;
    if (g.kind === 'pinch') {
      if (pointers.current.size < 2) endGesture();
      return;
    }
    // A left click on empty space that did not turn into a pan clears the
    // selection, as clicking away from everything is expected to.
    if (g.kind === 'pan' && g.button === 0 && !g.moved) editorStore.setSelection(null);
    if (g.kind !== 'idle') endGesture();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    const hit = layout.hitTest(pt.x, pt.y);
    if (hit.kind === 'lane') {
      const id = featureAt(hit.lane, hit.position);
      const feature = id === null ? undefined : doc.getFeature(id);
      const extent = feature === undefined ? null : featureExtent(feature);
      if (extent !== null) {
        zoomTo(extent.start, extent.end);
        return;
      }
    }
    zoomBy(ZOOM_STEP, pt.x, pt.y);
  };

  const cursor = panning
    ? 'grabbing'
    : hover.featureId !== null
      ? 'pointer'
      : hover.kind === 'none' && layout.zoom > 1
        ? 'grab'
        : 'default';
  const hasRange = selection !== null && !isEmptyRange(selection);
  const zoomed = layout.zoom > 1;

  return (
    <div ref={containerRef} className="map-view">
      <canvas
        ref={canvasRef}
        className="map-view__canvas"
        role="img"
        aria-label={`Map of ${doc.name}`}
        style={{ width: size.width, height: size.height, cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          if (gesture.current.kind === 'pan') e.preventDefault();
        }}
        onPointerLeave={() => {
          setHover(NO_HOVER);
        }}
      />
      <div className="map-view__controls" role="toolbar" aria-label="Map zoom">
        <button
          type="button"
          className="button map-view__control"
          title="Zoom in (mouse wheel or pinch also zooms; double-click a feature to fit it)"
          aria-label="Zoom in"
          disabled={layout.zoom >= layout.maxZoom}
          onClick={() => {
            zoomBy(ZOOM_STEP);
          }}
        >
          +
        </button>
        <button
          type="button"
          className="button map-view__control"
          title="Zoom out"
          aria-label="Zoom out"
          disabled={!zoomed}
          onClick={() => {
            zoomBy(1 / ZOOM_STEP);
          }}
        >
          −
        </button>
        <button
          type="button"
          className="button map-view__control"
          title="Zoom to the selected bases"
          aria-label="Zoom to selection"
          disabled={!hasRange}
          onClick={() => {
            if (selection !== null) zoomTo(selection.start, selection.end);
          }}
        >
          Sel
        </button>
        <button
          type="button"
          className="button map-view__control"
          title="Show the whole map"
          aria-label="Show the whole map"
          disabled={!zoomed}
          onClick={() => {
            commit(FIT_VIEWPORT);
          }}
        >
          Fit
        </button>
        {zoomed && (
          <span className="map-view__zoom" aria-live="polite">
            {layout.zoom < 10 ? layout.zoom.toFixed(1) : Math.round(layout.zoom).toString()}×
          </span>
        )}
      </div>
    </div>
  );
}
