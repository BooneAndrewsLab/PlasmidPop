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
  /** Angle of the thing being labelled. */
  readonly angle: number;
  readonly textWidth: number;
  /**
   * Who keeps their place when the ring cannot hold everything. Higher wins.
   * It is a property of the document — a feature's length, an enzyme's
   * rarity — never of the canvas, so panning does not reshuffle which
   * labels survive.
   */
  readonly rank: number;
}

/** A rectangle on the canvas that labels are spaced against. */
export interface LabelBox {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface PlacedLabel extends LabelInput {
  /** Text origin; `align` says which edge of the box it is. */
  readonly x: number;
  readonly y: number;
  readonly align: 'left' | 'right';
  /** Point on the label ring where the leader line meets the label. */
  readonly anchorX: number;
  readonly anchorY: number;
  readonly box: LabelBox;
}

export interface LabelLayoutOptions {
  readonly labelRadius: number;
  readonly lineHeight: number;
  readonly width: number;
  readonly height: number;
  /** Boxes already spoken for — ruler numbers — which never move. */
  readonly obstacles?: readonly LabelBox[];
  /** How far a label may slide along the ring from its anchor, in pixels. */
  readonly maxShift?: number;
  /** Margin kept clear at the canvas edges, for the hovered label's bubble. */
  readonly inset?: number;
}

export interface LabelLayout {
  readonly placed: readonly PlacedLabel[];
  /** Labels there was no room for. The map says how many; see `drawLabels`. */
  readonly dropped: readonly LabelInput[];
}

const LABEL_GAP_X = 4;
const LABEL_GAP_Y = 1;

export function labelBox(
  x: number,
  y: number,
  textWidth: number,
  lineHeight: number,
  align: 'left' | 'right' | 'center',
): LabelBox {
  const left = align === 'left' ? x : align === 'right' ? x - textWidth : x - textWidth / 2;
  return { left, right: left + textWidth, top: y - lineHeight / 2, bottom: y + lineHeight / 2 };
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return (
    a.left < b.right + LABEL_GAP_X &&
    b.left < a.right + LABEL_GAP_X &&
    a.top < b.bottom + LABEL_GAP_Y &&
    b.top < a.bottom + LABEL_GAP_Y
  );
}

/**
 * Places labels on a ring outside the backbone.
 *
 * A label that cannot sit at its anchor slides *along the ring*, which is
 * what keeps it beside the feature it names: where the ring runs steeply
 * (3 and 9 o'clock) that is the vertical stacking a crowded side needs, and
 * where it runs flat (12 and 6 o'clock) the labels spread sideways instead
 * of marching down across the map. Labels are placed in rank order and each
 * takes the free slot nearest its anchor; one that finds no slot within
 * `maxShift`, or none that fits on the canvas, is dropped rather than
 * stacked on top of its neighbour. Ruler numbers are passed in as
 * obstacles: they are placed first, never move, and are never dropped.
 */
export function layoutLabels(
  labels: readonly LabelInput[],
  layout: CircularLayout,
  options: LabelLayoutOptions,
): LabelLayout {
  const { labelRadius, lineHeight, width, height } = options;
  const inset = options.inset ?? 0;
  const maxShift = options.maxShift ?? lineHeight * 16;
  const step = Math.max(2, lineHeight / 2);
  const radius = Math.max(1, labelRadius);
  // Boxes are filed by horizontal band, so a candidate is only compared with
  // what is already near its own y. Ticking every enzyme puts several hundred
  // labels on the ring, and the map is redrawn on every pointer move.
  const band = Math.max(8, lineHeight * 2);
  const taken = new Map<number, LabelBox[]>();
  const bandsOf = (box: LabelBox): number[] => {
    const first = Math.floor(box.top / band);
    const last = Math.floor(box.bottom / band);
    const out: number[] = [];
    for (let i = first - 1; i <= last + 1; i++) out.push(i);
    return out;
  };
  const take = (box: LabelBox): void => {
    for (const i of bandsOf(box)) {
      const list = taken.get(i);
      if (list === undefined) taken.set(i, [box]);
      else list.push(box);
    }
  };
  const isFree = (box: LabelBox): boolean => {
    for (const i of bandsOf(box)) {
      for (const other of taken.get(i) ?? []) if (overlaps(box, other)) return false;
    }
    return true;
  };
  for (const box of options.obstacles ?? []) take(box);
  const order = [...labels].sort((a, b) => b.rank - a.rank || a.angle - b.angle);
  const placed: PlacedLabel[] = [];
  const dropped: LabelInput[] = [];

  for (const label of order) {
    // The side is fixed by the anchor, so sliding never flips a label from
    // one side of the ring to the other under the reader. It is also why a
    // label may not slide past 12 or 6 o'clock: the text runs away from the
    // ring, so a right-hand label that slid onto the left half would be
    // written back across the map.
    const right = Math.cos(label.angle) >= 0;
    const align = right ? 'left' : 'right';
    let found: PlacedLabel | null = null;
    for (let i = 0; found === null && i * step <= maxShift; i++) {
      for (const dir of i === 0 ? [0] : [1, -1]) {
        const angle = label.angle + (dir * i * step) / radius;
        if (Math.cos(angle) >= 0 !== right) continue;
        const ax = layout.cx + labelRadius * Math.cos(angle);
        const ay = layout.cy + labelRadius * Math.sin(angle);
        const x = right ? ax + LABEL_GAP_X : ax - LABEL_GAP_X;
        const box = labelBox(x, ay, label.textWidth, lineHeight, align);
        if (
          box.left < inset ||
          box.right > width - inset ||
          box.top < inset ||
          box.bottom > height - inset
        )
          continue;
        if (!isFree(box)) continue;
        found = { ...label, x, y: ay, align, anchorX: ax, anchorY: ay, box };
        break;
      }
    }
    if (found === null) {
      dropped.push(label);
    } else {
      placed.push(found);
      take(found.box);
    }
  }
  return { placed, dropped };
}
