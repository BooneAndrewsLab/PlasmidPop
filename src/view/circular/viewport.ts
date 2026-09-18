/**
 * Zoom and pan state of the circular map. `zoom` scales the backbone radius
 * relative to the size that fits the canvas (zoom 1); `panX`/`panY` move the
 * circle's centre away from the canvas centre, in CSS pixels. Lane widths,
 * fonts and label spacing do not scale, so zooming in spreads the sequence
 * out rather than magnifying the picture.
 */
export interface MapViewport {
  readonly zoom: number;
  readonly panX: number;
  readonly panY: number;
}

export const FIT_VIEWPORT: MapViewport = { zoom: 1, panX: 0, panY: 0 };

/** Fixed quantities the clamping rules need; none depends on the viewport. */
export interface ViewportBounds {
  readonly width: number;
  readonly height: number;
  /** Backbone radius at zoom 1. */
  readonly baseRadius: number;
  readonly maxZoom: number;
}

const TWO_PI = Math.PI * 2;
/** Zooming stops once the backbone stretches to this many pixels per base. */
const MAX_PX_PER_BASE = 3;
/** Never let one wheel notch or pinch step go beyond this, whatever the length. */
const ABSOLUTE_MAX_ZOOM = 400;

export function maxZoomFor(seqLength: number, baseRadius: number): number {
  if (seqLength <= 0 || baseRadius <= 0) return 1;
  const circumference = TWO_PI * baseRadius;
  return Math.min(ABSOLUTE_MAX_ZOOM, Math.max(1, (seqLength * MAX_PX_PER_BASE) / circumference));
}

function isFit(v: MapViewport): boolean {
  return v.zoom === 1 && v.panX === 0 && v.panY === 0;
}

/**
 * Keeps the zoom in [1, maxZoom] and the pan such that some part of the
 * backbone stays on the canvas. At zoom 1 the circle is always centred.
 */
export function clampViewport(v: MapViewport, b: ViewportBounds): MapViewport {
  const zoom = Math.min(b.maxZoom, Math.max(1, v.zoom));
  if (zoom <= 1) return FIT_VIEWPORT;
  const radius = b.baseRadius * zoom;
  // The circle's centre may leave the canvas by up to the radius: with the
  // centre on the extended edge, the ring still crosses the canvas.
  const maxX = b.width / 2 + radius - 8;
  const maxY = b.height / 2 + radius - 8;
  const next = {
    zoom,
    panX: Math.min(maxX, Math.max(-maxX, v.panX)),
    panY: Math.min(maxY, Math.max(-maxY, v.panY)),
  };
  return isFit(next) ? FIT_VIEWPORT : next;
}

/**
 * Multiplies the zoom by `factor` while keeping the map point under
 * (`x`, `y`) in canvas coordinates fixed.
 */
export function zoomAround(
  v: MapViewport,
  b: ViewportBounds,
  x: number,
  y: number,
  factor: number,
): MapViewport {
  const zoom = Math.min(b.maxZoom, Math.max(1, v.zoom * factor));
  const f = zoom / v.zoom;
  const cx = b.width / 2 + v.panX;
  const cy = b.height / 2 + v.panY;
  const ncx = x - (x - cx) * f;
  const ncy = y - (y - cy) * f;
  return clampViewport({ zoom, panX: ncx - b.width / 2, panY: ncy - b.height / 2 }, b);
}

export function panBy(v: MapViewport, b: ViewportBounds, dx: number, dy: number): MapViewport {
  return clampViewport({ zoom: v.zoom, panX: v.panX + dx, panY: v.panY + dy }, b);
}

function angleOf(position: number, seqLength: number): number {
  return -Math.PI / 2 + (TWO_PI * position) / seqLength;
}

/**
 * Viewport that shows the clockwise arc from `start` to `end` (bases;
 * `end` may exceed `seqLength` for a range across the origin) as large as
 * possible, with `pad` pixels kept free around it for lanes and labels.
 * The whole circle is shown when the arc is too long to gain anything.
 */
export function fitRange(
  b: ViewportBounds,
  start: number,
  end: number,
  seqLength: number,
  pad: number,
): MapViewport {
  if (seqLength <= 0 || end <= start || end - start >= seqLength) return FIT_VIEWPORT;
  const span = end - start;
  const a0 = angleOf(start, seqLength);
  const a1 = a0 + (TWO_PI * span) / seqLength;
  // Bounding box of the unit arc: its ends plus any axis crossing inside it.
  const xs = [Math.cos(a0), Math.cos(a1)];
  const ys = [Math.sin(a0), Math.sin(a1)];
  for (let k = Math.ceil(a0 / (Math.PI / 2)); k * (Math.PI / 2) <= a1; k++) {
    const a = k * (Math.PI / 2);
    xs.push(Math.cos(a));
    ys.push(Math.sin(a));
  }
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const freeW = Math.max(1, b.width - 2 * pad);
  const freeH = Math.max(1, b.height - 2 * pad);
  const radius = Math.min(
    freeW / Math.max(x1 - x0, 1e-6),
    freeH / Math.max(y1 - y0, 1e-6),
    b.baseRadius * b.maxZoom,
  );
  const zoom = radius / b.baseRadius;
  if (zoom <= 1) return FIT_VIEWPORT;
  // Put the arc's bounding-box centre at the canvas centre.
  const midX = (radius * (x0 + x1)) / 2;
  const midY = (radius * (y0 + y1)) / 2;
  return clampViewport({ zoom, panX: -midX, panY: -midY }, b);
}
