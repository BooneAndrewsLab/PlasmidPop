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

import { type Feature, type SeqDocument, featureExtent, isEmptyRange } from '@/core';
import {
  type ChangeTarget,
  type DrawnLabel,
  type MapViewport,
  type RingTarget,
  CircularLayout,
  FIT_VIEWPORT,
  clockwiseSelection,
  sameChange,
  fitRange,
  ghostFeatures,
  lanesWithGhosts,
  MIN_FEATURE_PX,
  labelMargin,
  overlayRingRadius,
  panBy,
  renderCircularMap,
  ringTargetAt,
  zoomAround,
} from '@/view/circular';
import { assignLanes } from '@/view/linear';
import { NO_OVERLAY, overlayAt, overlayLanes } from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { selectionBetween } from '../editing';
import { readCircularTheme } from './circularTheme';
import { selectChange, useEditDiff } from '../state/editDiff';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { recallView, rememberView } from '../state/viewMemory';

const SANS_FONT = '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = '600 15px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const RING_WIDTH = 14;
/** Room for the label ring, measured in its text (#25). */
const OUTER_MARGIN = labelMargin(SANS_FONT);
/** How far the pointer may travel and still count as a click rather than a drag. */
const CLICK_SLOP = 3;
/** Zoom factor of one press of the +/− buttons and of a double-click. */
const ZOOM_STEP = 1.6;

type Gesture =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'select';
      readonly anchor: number;
      readonly from: { x: number; y: number };
      moved: boolean;
      /**
       * The change pressed on, if any (#27). A mark lies on the backbone, so
       * a press there still starts a drag selection; only a click that did
       * not move selects the change, on release.
       */
      readonly change: ChangeTarget | null;
      /** The cut site pressed on, if any: a click that did not move puts the caret at it (#82). */
      readonly cut: number | null;
    }
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
  /** `label` when the pointer is on a label, which names what it is over (#25). */
  readonly kind: 'lane' | 'backbone' | 'label' | 'none';
  /** The change under the pointer when nothing else is (#27); it says what it is. */
  readonly change: ChangeTarget | null;
}

const NO_HOVER: Hover = { featureId: null, cut: null, kind: 'none', change: null };

/** How far off the preview ring a click may land and still count. */
const OVERLAY_HIT_PX = 6;

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
  const cuts = useMemo(() => cutSites.map((site) => site.cut), [cutSites]);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 600, height: 600 });
  const [hover, setHover] = useState<Hover>(NO_HOVER);
  // A hovered change is an index into the diff it was found in; when the
  // diff changes under a still pointer it would name another change, so it
  // is let go until the pointer moves (#82).
  const [hoverEdits, setHoverEdits] = useState(edits);
  if (edits !== hoverEdits) {
    setHoverEdits(edits);
    if (hover.change !== null) setHover({ ...hover, change: null });
  }
  const [panning, setPanning] = useState(false);
  // A tab comes back zoomed where it was left (#33); a new one shows the whole circle.
  const [viewport, setViewport] = useState<MapViewport>(
    () => recallView(documentId).mapViewport ?? FIT_VIEWPORT,
  );
  const gesture = useRef<Gesture>({ kind: 'idle' });
  /** The labels the last frame drew, for the pointer to find (#25). */
  const drawnLabels = useRef<readonly DrawnLabel[]>([]);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  const [viewportDocId, setViewportDocId] = useState(documentId);
  if (documentId !== viewportDocId) {
    setViewportDocId(documentId);
    setViewport(recallView(documentId).mapViewport ?? FIT_VIEWPORT);
  }

  const liveFeatures = useMemo(() => drawableFeatures(doc.features.all()), [doc]);
  const liveLanes = useMemo(
    () => assignLanes(liveFeatures, doc.length),
    [liveFeatures, doc.length],
  );
  // Removed features are ghosts in the lanes after the live ones (#27), so
  // the lanes follow the marks as well as the document.
  const lanes = useMemo(
    () => lanesWithGhosts(liveFeatures, liveLanes, ghostFeatures(edits), doc.length),
    [liveFeatures, liveLanes, edits, doc.length],
  );
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

  const commit = useCallback(
    (next: MapViewport): void => {
      viewportRef.current = next;
      setViewport(next);
      rememberView(documentId, { mapViewport: next });
    },
    [documentId],
  );

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
      const { labels } = renderCircularMap(ctx, {
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
        hoveredChange: hover.change,
        width: size.width,
        height: size.height,
        devicePixelRatio: dpr,
        theme: readCircularTheme(container),
        sansFont: SANS_FONT,
        titleFont: TITLE_FONT,
      });
      drawnLabels.current = labels;
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
    hover.change,
    size,
  ]);

  const point = (
    e: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  /**
   * The clickable previewed span under the pointer, or null. The preview
   * ring sits just inside the backbone, so this is asked before the backbone
   * is, and only spans a panel marked clickable answer — otherwise a find
   * with 200 matches would shadow half the backbone.
   */
  const overlayIdAt = (x: number, y: number): string | null => {
    if (overlay.length === 0 || doc.length === 0) return null;
    const r = Math.hypot(x - layout.cx, y - layout.cy);
    const position = layout.positionOf(Math.atan2(y - layout.cy, x - layout.cx));
    for (const span of overlay) {
      if (span.clickable !== true) continue;
      const lane = previewLanes.laneOf.get(span.id) ?? 0;
      const ring = overlayRingRadius(layout.radius, lane, previewLanes.laneCount);
      if (Math.abs(r - ring) > OVERLAY_HIT_PX) continue;
      if (overlayAt([span], doc.length, position) !== undefined) return span.id;
    }
    return null;
  };

  const featureAt = (lane: number, position: number): string | null => {
    const inLane = (x: Feature): boolean => lanes.laneOf.get(x.id) === lane;
    const f = doc.features.at(position, doc.length).find(inLane);
    if (f !== undefined) return f.id;
    // A feature too short to see is drawn a few pixels wide (#26); it takes
    // that much of the pointer too, or what can be seen could not be hovered.
    const r = layout.laneRadius(lane);
    // Bases per pixel of this lane's ring; the radius is on screen, zoom and all.
    const bases = Math.ceil(MIN_FEATURE_PX / 2 / ((Math.PI * 2 * r) / Math.max(1, doc.length)));
    if (bases < 1) return null;
    const near = doc.features
      .overlapping(
        { start: Math.max(0, position - bases), end: Math.min(doc.length, position + bases + 1) },
        doc.length,
      )
      .filter(inLane);
    return near[0]?.id ?? null;
  };

  const endGesture = (): void => {
    gesture.current = { kind: 'idle' };
    setPanning(false);
  };

  /**
   * The cut site's tick or the change — a mark, a deletion's wedge or a
   * ghost (#27) — under a point, the cut site first; hover and click both
   * ask this, so they agree (#82).
   */
  const ringAt = (x: number, y: number): RingTarget | null =>
    ringTargetAt({ layout, lanes, edits, sansFont: SANS_FONT, cuts }, x, y);

  /** The caret at a cut, as a click on its label puts it (#25). */
  const caretAtCut = (position: number): void => {
    editorStore.setSelection({ start: position, end: position });
    editorStore.revealPosition(position);
  };

  /** The label under a point, if any: a label is a click target like the arc it names. */
  const labelAt = (x: number, y: number): DrawnLabel['target'] | null => {
    for (const { box, target } of drawnLabels.current)
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return target;
    return null;
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
    // A label names what it is for, so clicking it does what clicking that
    // does: a feature's selects the feature, a cut site's puts the caret at
    // the cut (#25).
    const label = e.button === 0 ? labelAt(pt.x, pt.y) : null;
    if (label !== null) {
      if (label.kind === 'feature') editorStore.selectFeature(label.featureId);
      else caretAtCut(label.position);
      return;
    }
    const hit = layout.hitTest(pt.x, pt.y);
    // Cut sites and changes come after features, labels and the preview:
    // they are the lowest things on the map to answer a click (#27), a cut
    // site before a change under it, as hover has it (#82).
    const ring = e.button === 0 ? ringAt(pt.x, pt.y) : null;
    const change = ring?.kind === 'change' ? ring.change : null;
    const cut = ring?.kind === 'cut' ? ring.position : null;
    if (e.button === 1 || (e.button === 0 && hit.kind === 'none' && ring === null)) {
      if (e.button === 1) e.preventDefault(); // no middle-click autoscroll
      e.currentTarget.setPointerCapture(e.pointerId);
      gesture.current = { kind: 'pan', button: e.button, from: pt, last: pt, moved: false };
      setPanning(layout.zoom > 1);
      return;
    }
    if (e.button !== 0) return;
    if (hit.kind === 'lane') {
      const id = featureAt(hit.lane, hit.position);
      if (id !== null) {
        editorStore.selectFeature(id);
        // A finger has no hover, so the tap does what a pointer resting
        // there does: the feature's label comes back if the ring dropped
        // it, and stays until the next tap (`onPointerLeave` lets it be).
        if (e.pointerType === 'touch')
          setHover({ featureId: id, cut: null, kind: 'lane', change: null });
      } else if (change !== null) selectChange(change);
      return;
    }
    const spanId = overlayIdAt(pt.x, pt.y);
    if (spanId !== null) {
      editorStore.activatePreview(spanId);
      return;
    }
    if (hit.kind !== 'backbone') {
      if (cut !== null) caretAtCut(cut);
      else if (change !== null) selectChange(change);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: 'select',
      anchor: hit.position,
      from: pt,
      moved: false,
      change,
      cut,
    };
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
      if (Math.hypot(pt.x - g.from.x, pt.y - g.from.y) > CLICK_SLOP) g.moved = true;
      if (hit.kind === 'none') return;
      editorStore.setSelection(
        doc.isCircular
          ? clockwiseSelection(g.anchor, hit.position, doc.length)
          : selectionBetween(g.anchor, hit.position),
      );
      return;
    }
    const label = labelAt(pt.x, pt.y);
    const next: Hover =
      label !== null
        ? {
            featureId: label.kind === 'feature' ? label.featureId : null,
            cut: label.kind === 'cut' ? label.position : null,
            kind: 'label',
            change: null,
          }
        : ((): Hover => {
            const featureId = hit.kind === 'lane' ? featureAt(hit.lane, hit.position) : null;
            const ring = featureId === null ? ringAt(pt.x, pt.y) : null;
            return {
              featureId,
              cut: ring?.kind === 'cut' ? ring.position : null,
              kind: hit.kind,
              change: ring?.kind === 'change' ? ring.change : null,
            };
          })();
    setHover((prev) =>
      prev.featureId === next.featureId &&
      prev.cut === next.cut &&
      prev.kind === next.kind &&
      sameChange(prev.change, next.change)
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
    if (g.kind === 'pan' && g.button === 0 && !g.moved) {
      editorStore.setSelection(null);
      setHover(NO_HOVER);
    }
    // A click on a mark or a deletion's wedge that did not turn into a drag
    // selects the change, where it would have put the caret (#27); on a cut
    // site's tick it puts the caret at the cut, over a mark or not (#82).
    if (g.kind === 'select' && !g.moved) {
      if (g.cut !== null) caretAtCut(g.cut);
      else if (g.change !== null) selectChange(g.change);
    }
    if (g.kind !== 'idle') endGesture();
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    const hit = layout.hitTest(pt.x, pt.y);
    const label = labelAt(pt.x, pt.y);
    if (label?.kind === 'cut') return; // a cut site has nothing to zoom to
    if (label !== null || hit.kind === 'lane') {
      const id =
        label?.kind === 'feature'
          ? label.featureId
          : hit.kind === 'lane'
            ? featureAt(hit.lane, hit.position)
            : null;
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
    : hover.featureId !== null ||
        hover.kind === 'label' ||
        hover.change !== null ||
        hover.cut !== null
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
        onPointerLeave={(e) => {
          // A finger leaves the moment it lifts, and the label it brought
          // back would go with it.
          if (e.pointerType !== 'touch') setHover(NO_HOVER);
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
