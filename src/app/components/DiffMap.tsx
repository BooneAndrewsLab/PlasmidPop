import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type CutSite, type DocumentDiff, type SeqDocument, featureExtent } from '@/core';
import {
  type ChangeTarget,
  type DrawnLabel,
  type MapViewport,
  CircularLayout,
  FIT_VIEWPORT,
  changeAt,
  cutSiteAt,
  featureAtLane,
  fitRange,
  ghostFeatures,
  lanesWithGhosts,
  panBy,
  renderCircularMap,
  sameChange,
  zoomAround,
} from '@/view/circular';
import { NO_LANES, assignLanes } from '@/view/linear';
import { NO_OVERLAY } from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { readCircularTheme } from './circularTheme';

/** Square side of the map in the review, wide enough for the label ring. */
const SIZE = 380;
const RING_WIDTH = 12;
const OUTER_MARGIN = 92;
const SANS_FONT = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE_FONT = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** Zoom factor of one press of the +/− buttons and of a double-click, as on the editor's map. */
const ZOOM_STEP = 1.6;
/** How far the pointer may travel and still count as a tap rather than a drag. */
const CLICK_SLOP = 3;

interface Props {
  /** The document the diff is in the coordinates of, and which is drawn. */
  readonly doc: SeqDocument;
  readonly diff?: DocumentDiff | null;
  /** Cut sites to mark and label, as the editor's map marks the ticked enzymes'. */
  readonly cutSites?: readonly CutSite[];
  /** Side of the square, in CSS pixels. */
  readonly size?: number;
  /** What the map is of, for a screen reader; hidden from one without it. */
  readonly label?: string;
  /**
   * A click on a change — a mark, a deletion's wedge, a removed feature's
   * ghost (#27). Without it the map takes no pointer at all.
   */
  readonly onPick?: (target: ChangeTarget) => void;
  /** A change to point at, drawn as a hovered one is: a review's list asks for it. */
  readonly pointed?: ChangeTarget | null;
  /**
   * Whether the map can be looked at closely (#80): a hovered feature or
   * cut site gets its label back, as on the editor's map, and the wheel,
   * a pinch, a drag and the +/− buttons zoom and pan. There is still
   * nothing to select: the Bench's product is not a document yet.
   */
  readonly explore?: boolean;
}

const NO_CUTS: readonly CutSite[] = [];

interface Hover {
  readonly featureId: string | null;
  readonly cut: number | null;
}

const NO_HOVER: Hover = { featureId: null, cut: null };

type Gesture =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'pan';
      readonly from: { x: number; y: number };
      last: { x: number; y: number };
      moved: boolean;
    }
  | { readonly kind: 'pinch'; prev: { dist: number; x: number; y: number } | null };

/**
 * The whole molecule with its changes marked, above the rows of bases. A
 * plasmid is read as a ring, so where a change landed — in the marker, in
 * the origin, in nothing at all — is the first thing to say about it, and a
 * column of sequence hunks says it last.
 *
 * It is the circular map with the same renderer, marks and colours as the
 * editor's own, at a fixed size and fitted to the whole circle, rather than
 * a second drawing routine. With `explore` it zooms and hovers as the
 * editor's does, which the Bench's product map asks for.
 */
export function DiffMap({
  doc,
  diff = null,
  cutSites = NO_CUTS,
  size = SIZE,
  label,
  onPick,
  pointed = null,
  explore = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<ChangeTarget | null>(null);
  const [hover, setHover] = useState<Hover>(NO_HOVER);
  const [viewport, setViewport] = useState<MapViewport>(FIT_VIEWPORT);
  const [panning, setPanning] = useState(false);
  const gesture = useRef<Gesture>({ kind: 'idle' });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  /** The labels the last frame drew, for the pointer to find. */
  const drawnLabels = useRef<readonly DrawnLabel[]>([]);

  // A reaction works its product out again on every render, so a new
  // object is not a new product; another length or topology is, and is
  // shown whole.
  const shape = `${doc.length.toString()}:${doc.topology}`;
  const [viewShape, setViewShape] = useState(shape);
  if (shape !== viewShape) {
    setViewShape(shape);
    setViewport(FIT_VIEWPORT);
    setHover(NO_HOVER);
  }

  const drawing = useMemo(() => {
    const features = drawableFeatures(doc.features.all());
    const lanes = lanesWithGhosts(
      features,
      assignLanes(features, doc.length),
      ghostFeatures(diff),
      doc.length,
    );
    const options = {
      width: size,
      height: size,
      laneCount: lanes.laneCount,
      ringWidth: RING_WIDTH,
      outerMargin: OUTER_MARGIN,
    };
    const first = new CircularLayout(doc.length, doc.topology, { ...options, viewport });
    // Re-clamp when the lane count changed under a zoomed view.
    const clamped = panBy(viewport, first.bounds, 0, 0);
    const layout =
      clamped.zoom === viewport.zoom &&
      clamped.panX === viewport.panX &&
      clamped.panY === viewport.panY
        ? first
        : new CircularLayout(doc.length, doc.topology, { ...options, viewport: clamped });
    return { lanes, layout };
  }, [doc, diff, size, viewport]);

  // The wheel listener is bound outside React, and reads the latest layout.
  const layoutRef = useRef(drawing.layout);
  useLayoutEffect(() => {
    layoutRef.current = drawing.layout;
  }, [drawing.layout]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const { labels } = renderCircularMap(ctx, {
      doc,
      layout: drawing.layout,
      lanes: drawing.lanes,
      selection: null,
      // The review is about what changed, not about what is ticked or what a
      // panel is pointing at; the Bench's product map passes its check digest.
      cutSites,
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      edits: diff,
      hoveredFeatureId: hover.featureId,
      hoveredCut: hover.cut,
      hoveredChange: hovered ?? pointed,
      width: size,
      height: size,
      devicePixelRatio: dpr,
      theme: readCircularTheme(canvas),
      sansFont: SANS_FONT,
      titleFont: TITLE_FONT,
    });
    drawnLabels.current = labels;
  }, [doc, diff, cutSites, drawing, size, hovered, pointed, hover]);

  // Mouse wheel and trackpad pinch (ctrl+wheel) zoom about the cursor, as on
  // the editor's map. React's onWheel is passive, so the listener is bound
  // by hand to be allowed to keep the column from scrolling.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || !explore) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      const factor = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002));
      const layout = layoutRef.current;
      setViewport(
        zoomAround(
          layout.viewport,
          layout.bounds,
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
  }, [explore]);

  const point = (
    e: ReactPointerEvent<HTMLCanvasElement> | ReactMouseEvent<HTMLCanvasElement>,
  ): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const targetAt = (e: ReactPointerEvent<HTMLCanvasElement>): ChangeTarget | null => {
    const pt = point(e);
    return changeAt(
      { layout: drawing.layout, lanes: drawing.lanes, edits: diff, sansFont: SANS_FONT },
      pt.x,
      pt.y,
    );
  };

  /** What a point is on: a drawn label, a feature, or a cut site's tick, in that order. */
  const hoverAt = (x: number, y: number): Hover => {
    for (const { box, target } of drawnLabels.current)
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)
        return target.kind === 'feature'
          ? { featureId: target.featureId, cut: null }
          : { featureId: null, cut: target.position };
    const { layout, lanes } = drawing;
    const hit = layout.hitTest(x, y);
    if (hit.kind === 'lane') {
      const featureId = featureAtLane(doc, lanes, layout, hit.lane, hit.position);
      if (featureId !== null) return { featureId, cut: null };
      return NO_HOVER;
    }
    const cut = cutSiteAt(
      layout,
      cutSites.map((s) => s.cut),
      x,
      y,
    );
    return cut === null ? NO_HOVER : { featureId: null, cut };
  };

  const setHoverIfNew = (next: Hover): void => {
    setHover((prev) => (prev.featureId === next.featureId && prev.cut === next.cut ? prev : next));
  };

  const zoomBy = (factor: number, x = size / 2, y = size / 2): void => {
    const { layout } = drawing;
    setViewport(zoomAround(layout.viewport, layout.bounds, x, y, factor));
  };

  const exploreDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    pointers.current.set(e.pointerId, pt);
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      gesture.current = { kind: 'pinch', prev: null };
      setPanning(false);
      return;
    }
    if (pointers.current.size > 2 || e.button !== 0) return;
    // A finger has no hover: a tap brings back the label under it, as it
    // does on the editor's map, and it stays until the next.
    if (e.pointerType === 'touch') setHoverIfNew(hoverAt(pt.x, pt.y));
    gesture.current = { kind: 'pan', from: pt, last: pt, moved: false };
  };

  const exploreMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, pt);
    const g = gesture.current;
    const { layout } = drawing;
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()];
      if (a === undefined || b === undefined) return;
      const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (g.prev !== null) {
        const zoomed = zoomAround(
          layout.viewport,
          layout.bounds,
          g.prev.x,
          g.prev.y,
          dist / g.prev.dist,
        );
        setViewport(panBy(zoomed, layout.bounds, mid.x - g.prev.x, mid.y - g.prev.y));
      }
      g.prev = { dist, ...mid };
      return;
    }
    if (g.kind === 'pan') {
      if (Math.hypot(pt.x - g.from.x, pt.y - g.from.y) > CLICK_SLOP) g.moved = true;
      if (g.moved && layout.zoom > 1) {
        setPanning(true);
        setViewport(panBy(layout.viewport, layout.bounds, pt.x - g.last.x, pt.y - g.last.y));
      }
      g.last = pt;
      return;
    }
    setHoverIfNew(hoverAt(pt.x, pt.y));
  };

  const exploreUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (gesture.current.kind === 'pinch' && pointers.current.size >= 2) return;
    gesture.current = { kind: 'idle' };
    setPanning(false);
  };

  const exploreLeave = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    // A finger leaves the moment it lifts, and the label it brought back
    // would go with it.
    if (e.pointerType !== 'touch') setHover(NO_HOVER);
  };

  const exploreDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const pt = point(e);
    const { featureId } = hoverAt(pt.x, pt.y);
    const feature = featureId === null ? undefined : doc.getFeature(featureId);
    const extent = feature === undefined ? null : featureExtent(feature);
    if (extent !== null) {
      const pad = Math.max(OUTER_MARGIN, 20 + drawing.lanes.laneCount * RING_WIDTH);
      setViewport(fitRange(drawing.layout.bounds, extent.start, extent.end, doc.length, pad));
      return;
    }
    zoomBy(ZOOM_STEP, pt.x, pt.y);
  };

  const pickMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const next = targetAt(e);
    setHovered((prev) => (sameChange(prev, next) ? prev : next));
  };

  const pickDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.button !== 0 || onPick === undefined) return;
    const target = targetAt(e);
    if (target !== null) onPick(target);
  };

  const picks = onPick !== undefined;

  const { layout } = drawing;
  const zoomed = layout.zoom > 1;
  // On the Bench nothing is clicked, so a hovered feature is not a link.
  const cursor = panning
    ? 'grabbing'
    : hovered !== null
      ? 'pointer'
      : explore && zoomed
        ? 'grab'
        : 'default';

  const canvas = (
    <canvas
      ref={canvasRef}
      className="diff-map__canvas"
      style={{ width: size, height: size, cursor, touchAction: explore ? 'none' : undefined }}
      onPointerDown={explore ? exploreDown : picks ? pickDown : undefined}
      onPointerMove={explore ? exploreMove : picks ? pickMove : undefined}
      onPointerUp={explore ? exploreUp : undefined}
      onPointerCancel={explore ? exploreUp : undefined}
      onPointerLeave={
        explore
          ? exploreLeave
          : picks
            ? () => {
                setHovered(null);
              }
            : undefined
      }
      onDoubleClick={explore ? exploreDoubleClick : undefined}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
  if (!explore) return canvas;
  return (
    <div className="diff-map--explore" style={{ width: size }}>
      {canvas}
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
          title="Show the whole map"
          aria-label="Show the whole map"
          disabled={!zoomed}
          onClick={() => {
            setViewport(FIT_VIEWPORT);
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
