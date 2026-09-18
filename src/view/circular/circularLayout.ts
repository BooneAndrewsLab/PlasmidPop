import { type Topology } from '@/core';

import { type MapViewport, type ViewportBounds, FIT_VIEWPORT, maxZoomFor } from './viewport';

/**
 * Geometry of the circular plasmid map. Position 0 sits at 12 o'clock and
 * positions increase clockwise. Feature lanes stack inward from the
 * backbone; labels sit outside it.
 */

export type CircularHit =
  | { readonly kind: 'backbone'; readonly position: number }
  | { readonly kind: 'lane'; readonly lane: number; readonly position: number }
  | { readonly kind: 'none' };

const TWO_PI = Math.PI * 2;

export interface CircularOptions {
  readonly width: number;
  readonly height: number;
  readonly laneCount: number;
  /** Radial thickness of one feature lane (arc plus gap). */
  readonly ringWidth: number;
  /** Space kept outside the backbone for ticks and labels. */
  readonly outerMargin: number;
  /** Zoom and pan; the whole circle, centred, when omitted. */
  readonly viewport?: MapViewport;
}

export class CircularLayout {
  readonly width: number;
  readonly height: number;
  readonly cx: number;
  readonly cy: number;
  /** Radius of the backbone circle at the current zoom. */
  readonly radius: number;
  /** Backbone radius at zoom 1, when the whole circle fits the canvas. */
  readonly baseRadius: number;
  readonly viewport: MapViewport;
  readonly maxZoom: number;
  readonly ringWidth: number;
  readonly laneCount: number;

  constructor(
    readonly seqLength: number,
    readonly topology: Topology,
    options: CircularOptions,
  ) {
    this.width = options.width;
    this.height = options.height;
    this.ringWidth = options.ringWidth;
    this.laneCount = options.laneCount;
    const available = Math.min(options.width, options.height) / 2 - options.outerMargin;
    const needed = 40 + options.laneCount * options.ringWidth;
    this.baseRadius = Math.max(24, Math.max(available, needed));
    this.maxZoom = maxZoomFor(seqLength, this.baseRadius);
    this.viewport = options.viewport ?? FIT_VIEWPORT;
    this.radius = this.baseRadius * this.viewport.zoom;
    this.cx = options.width / 2 + this.viewport.panX;
    this.cy = options.height / 2 + this.viewport.panY;
  }

  get zoom(): number {
    return this.viewport.zoom;
  }

  /** What the zoom and pan rules need to know about this canvas. */
  get bounds(): ViewportBounds {
    return {
      width: this.width,
      height: this.height,
      baseRadius: this.baseRadius,
      maxZoom: this.maxZoom,
    };
  }

  /** Whether a canvas point lies within `margin` pixels of the canvas. */
  isOnCanvas(x: number, y: number, margin = 0): boolean {
    return x >= -margin && x <= this.width + margin && y >= -margin && y <= this.height + margin;
  }

  /** Angle (radians) of a base boundary; 0 → -π/2 (top). */
  angleOf(position: number): number {
    if (this.seqLength === 0) return -Math.PI / 2;
    return -Math.PI / 2 + (TWO_PI * position) / this.seqLength;
  }

  /** Base boundary nearest to an angle, in [0, seqLength). */
  positionOf(angle: number): number {
    if (this.seqLength === 0) return 0;
    let turns = (angle + Math.PI / 2) / TWO_PI;
    turns -= Math.floor(turns);
    return Math.round(turns * this.seqLength) % this.seqLength;
  }

  pointAt(position: number, r: number): { x: number; y: number } {
    const a = this.angleOf(position);
    return { x: this.cx + r * Math.cos(a), y: this.cy + r * Math.sin(a) };
  }

  /** Centre-line radius of a feature lane (0 = just inside the backbone). */
  laneRadius(lane: number): number {
    return this.radius - 12 - this.ringWidth * lane - this.ringWidth / 2;
  }

  hitTest(x: number, y: number): CircularHit {
    const dx = x - this.cx;
    const dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    const position = this.positionOf(Math.atan2(dy, dx));
    if (Math.abs(r - this.radius) <= 10) return { kind: 'backbone', position };
    if (this.laneCount > 0) {
      const outer = this.laneRadius(0) + this.ringWidth / 2;
      const inner = this.laneRadius(this.laneCount - 1) - this.ringWidth / 2;
      if (r <= outer && r >= inner) {
        const lane = Math.min(this.laneCount - 1, Math.floor((outer - r) / this.ringWidth));
        return { kind: 'lane', lane, position };
      }
    }
    return { kind: 'none' };
  }
}

const TICK_STEPS = [
  10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000,
];

/**
 * Spacing between ruler ticks such that the whole circle carries at most
 * ~16 of them at zoom 1; zooming in admits proportionally more, so the
 * tick density on screen stays roughly constant.
 */
export function tickInterval(seqLength: number, maxTicks = 16): number {
  for (const step of TICK_STEPS) if (seqLength / step <= maxTicks) return step;
  return 10 ** Math.ceil(Math.log10(seqLength / maxTicks));
}

export interface LabelInput {
  readonly id: string;
  readonly text: string;
  /** Angle of the feature's midpoint. */
  readonly angle: number;
  readonly textWidth: number;
}

export interface PlacedLabel extends LabelInput {
  readonly x: number;
  readonly y: number;
  readonly align: 'left' | 'right';
  /** Where the leader line leaves the label. */
  readonly anchorX: number;
}

/**
 * Places labels on a ring outside the backbone and nudges them vertically so
 * that labels on the same side never overlap. Labels whose text does not
 * overlap horizontally may share a line, which matters near the top and
 * bottom of the circle and on a zoomed-in map, where the ring runs almost
 * horizontally. Labels are kept inside the canvas height.
 */
export function layoutLabels(
  labels: readonly LabelInput[],
  layout: CircularLayout,
  labelRadius: number,
  lineHeight: number,
  height: number,
): PlacedLabel[] {
  const sides: { right: PlacedLabel[]; left: PlacedLabel[] } = { right: [], left: [] };
  for (const label of labels) {
    const x = layout.cx + labelRadius * Math.cos(label.angle);
    const y = layout.cy + labelRadius * Math.sin(label.angle);
    const right = Math.cos(label.angle) >= 0;
    const placed: PlacedLabel = {
      ...label,
      x: right ? x + 4 : x - 4,
      y,
      align: right ? 'left' : 'right',
      anchorX: x,
    };
    (right ? sides.right : sides.left).push(placed);
  }
  const xExtent = (l: PlacedLabel): readonly [number, number] =>
    l.align === 'left' ? [l.x, l.x + l.textWidth] : [l.x - l.textWidth, l.x];
  const overlapsX = (a: PlacedLabel, b: PlacedLabel): boolean => {
    const [a0, a1] = xExtent(a);
    const [b0, b1] = xExtent(b);
    return a0 < b1 + 4 && b0 < a1 + 4;
  };
  const resolve = (items: PlacedLabel[]): PlacedLabel[] => {
    items.sort((a, b) => a.y - b.y);
    const ys = items.map((l) => l.y);
    for (let i = 1; i < ys.length; i++) {
      const me = items[i];
      if (me === undefined) continue;
      let floor = -Infinity;
      for (let j = 0; j < i; j++) {
        const other = items[j];
        if (other !== undefined && overlapsX(me, other)) floor = Math.max(floor, ys[j] ?? 0);
      }
      if ((ys[i] ?? 0) < floor + lineHeight) ys[i] = floor + lineHeight;
    }
    // Push back up if the stack ran past the bottom edge.
    const overflow = (ys[ys.length - 1] ?? 0) + lineHeight / 2 - height;
    if (overflow > 0) {
      for (let i = ys.length - 1; i >= 0; i--) {
        const limit = i === ys.length - 1 ? height - lineHeight / 2 : (ys[i + 1] ?? 0) - lineHeight;
        ys[i] = Math.min(ys[i] ?? 0, limit);
      }
    }
    for (let i = 0; i < ys.length; i++) ys[i] = Math.max(lineHeight / 2, ys[i] ?? 0);
    return items.map((l, i) => ({ ...l, y: ys[i] ?? l.y }));
  };
  return [...resolve(sides.right), ...resolve(sides.left)];
}
