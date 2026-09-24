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
  /**
   * How far a label may slide along the ring from its anchor, in pixels.
   * A slide is a leader line drawn across the map, so this is a budget for
   * how far the reader's eye has to travel, not a measure of how hard the
   * ring is to fit into: past it the label is left out instead.
   */
  readonly maxShift?: number;
  /**
   * How far a label the rules refused may slide in the pass that takes
   * what room is left; see `RESCUE_SHIFT_LINES`.
   */
  readonly rescueShift?: number;
  /** Margin kept clear at the canvas edges, for the hovered label's bubble. */
  readonly inset?: number;
  /**
   * How far outside the label ring a second ring may put a label the first
   * had no room for, in pixels (#23); 0 for none. Defaults to `maxShift`.
   */
  readonly outerReach?: number;
  /**
   * Radius of the elbow a leader turns at, which is where the line to a
   * slid label starts. Needed to keep leaders from crossing; defaults to
   * the label ring, which makes every leader a chord of it.
   */
  readonly elbowRadius?: number;
}

export interface LabelLayout {
  readonly placed: readonly PlacedLabel[];
  /** Labels there was no room for. The map says how many; see `drawLabels`. */
  readonly dropped: readonly LabelInput[];
}

const LABEL_GAP_X = 4;
const LABEL_GAP_Y = 1;

/**
 * How far a label may slide from its anchor by default, in line heights.
 * It was sixteen, which is most of a pane: on a map zoomed into one arc a
 * crowded side would slide its whole crowd to one end rather than leave
 * any of it out, and the leaders fanned across the gap (item 31). A label
 * that cannot be reached in a glance from the thing it names is worth less
 * than the `+N not shown` line that replaces it.
 */
const MAX_SHIFT_LINES = 8;

/**
 * How far a label placed in the second pass may slide, in line heights.
 * Much less than the whole budget: that pass is there for the pair of features at
 * nearly the same place — a `mat_peptide` inside its CDS, a cut site beside
 * a feature's end — where one of the two has to give way and whichever does
 * gets in the other's way. A label that has to travel to find room *and*
 * break the order to get there is the tangle this was fixing, so it is left
 * out as before. `rescueShift` overrides it, which is what the SVG export
 * does: on paper a name that did not fit is lost for good, so a figure pays
 * the long leader and the broken order rather than leave one out.
 */
const RESCUE_SHIFT_LINES = 2;

/** Labels in a row the outer ring may fail to place before it is taken to be full. */
const OUTER_MISSES = 24;

/** Rounds of trimming an overfull crowd before the spread settles for what it has. */
const MAX_SPREAD_ROUNDS = 16;

/** A label placed, with what the next one needs to know about it. */
interface Attempt {
  readonly label: PlacedLabel;
  readonly run: PlacedRun;
  readonly slot: Slot;
  readonly side: 0 | 1;
  readonly index: number;
}

/**
 * Angle normalised to [-π/2, 3π/2), so that each side of the ring is one
 * interval — the right side [-π/2, π/2], the left the rest — and a label's
 * place along the ring is just this number: it increases clockwise down the
 * right side and anticlockwise up the left one, which on both sides is the
 * order the labels are read in.
 */
function ringAngle(angle: number): number {
  let a = angle % TWO_PI;
  if (a < -Math.PI / 2) a += TWO_PI;
  if (a >= Math.PI * 1.5) a -= TWO_PI;
  return a;
}

/** A slot taken on one side of the ring, and whose turn along it it was. */
interface Slot {
  readonly rung: number;
  readonly at: number;
}

/**
 * A leader already drawn: the line from the elbow beside the thing named to
 * the label itself, with the stretch of ring it runs over so that the ones
 * nowhere near a candidate can be dismissed on one comparison.
 */
interface PlacedRun {
  readonly lo: number;
  readonly hi: number;
  readonly ex: number;
  readonly ey: number;
  readonly ax: number;
  readonly ay: number;
}

function turn(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return Math.sign((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
}

/** Whether two leaders run over the same stretch of ring, a turn either way. */
function overlapsTurn(a: PlacedRun, b: PlacedRun): boolean {
  for (const shift of [0, TWO_PI, -TWO_PI])
    if (a.lo + shift <= b.hi && b.lo <= a.hi + shift) return true;
  return false;
}

/**
 * Whether a candidate leader crosses none of those already drawn. Only one
 * running over the same stretch of ring can be in the way, and a slide is a
 * few line heights at most, so nearly every one is dismissed on a single
 * comparison. The two sides meet at 12 o'clock, where one is just over -π/2
 * and the other just under 3π/2, so the stretches are compared a turn apart
 * as well: neighbours across the top were being missed.
 */
function runIsClear(
  runs: readonly PlacedRun[],
  run: PlacedRun,
  ex: number,
  ey: number,
  ax: number,
  ay: number,
): boolean {
  for (const other of runs) {
    if (!overlapsTurn(other, run)) continue;
    if (crossesRun(other, ex, ey, ax, ay)) return false;
  }
  return true;
}

/** Whether a candidate leader would cross one already drawn. */
function crossesRun(run: PlacedRun, ex: number, ey: number, ax: number, ay: number): boolean {
  const d1 = turn(ex, ey, ax, ay, run.ex, run.ey);
  const d2 = turn(ex, ey, ax, ay, run.ax, run.ay);
  const d3 = turn(run.ex, run.ey, run.ax, run.ay, ex, ey);
  const d4 = turn(run.ex, run.ey, run.ax, run.ay, ax, ay);
  return d1 !== d2 && d3 !== d4;
}

/**
 * Where each label of a crowd would like to sit so that the crowd shares
 * its room, as angles by label id (#24).
 *
 * Placing greedily in rank order lets the highest-ranked of a bunch keep its
 * own anchor and the rest work around it, which against 12 or 6 o'clock —
 * where a side ends and the ring has no more room in the direction the
 * order demands — leaves the pole-most labels no slot at all. This is the
 * one-dimensional cluster spread: along each side, in the ring's order,
 * labels that would crowd each other form a cluster, the cluster is centred
 * on its members' anchors and held inside the stretch of ring that can show
 * it, and clusters that then touch merge, until none do. A crowd against a
 * pole is pushed away from it as one, so each label gets a share rather
 * than the first comers getting all of it.
 *
 * The spacing between two neighbours is estimated from where they are on
 * the ring: where it runs steeply a label needs a line's height of it, where
 * it runs flat the width of the label nearer the pole. It is an estimate;
 * the targets are where the slot search starts, and it still checks every
 * box. No target is further from its anchor than `maxShift`.
 */
/**
 * Breaks a tie between two labels by what they say, never by id: a parsed
 * file's feature ids are random, and so is the order features with the same
 * start come out of the set, so a tie broken either way lays the same map
 * out differently each time it is opened. Two labels alike in text and
 * width are alike on the map too.
 */
function tie(a: LabelInput, b: LabelInput): number {
  return a.text < b.text ? -1 : a.text > b.text ? 1 : a.textWidth - b.textWidth;
}

function spreadTargets(
  labels: readonly LabelInput[],
  layout: CircularLayout,
  options: LabelLayoutOptions,
  maxShift: number,
): Map<string, number> {
  const { labelRadius, lineHeight, width, height } = options;
  const inset = options.inset ?? 0;
  const radius = Math.max(1, labelRadius);
  const HALF_PI = Math.PI / 2;
  const out = new Map<string, number>();
  const visible = (angle: number): boolean => {
    const x = layout.cx + labelRadius * Math.cos(angle);
    const y = layout.cy + labelRadius * Math.sin(angle);
    return x >= inset && x <= width - inset && y >= inset && y <= height - inset;
  };
  const need = (a: LabelInput, b: LabelInput, at: number): number => {
    const cos = Math.max(0.05, Math.abs(Math.cos(at)));
    const sin = Math.max(0.05, Math.abs(Math.sin(at)));
    // The label nearer the pole is the one whose width the other must clear.
    const pole =
      Math.abs(Math.sin(ringAngle(a.angle))) >= Math.abs(Math.sin(ringAngle(b.angle))) ? a : b;
    return Math.min((lineHeight + LABEL_GAP_Y) / cos, (pole.textWidth + LABEL_GAP_X) / sin) + 1;
  };
  const step = Math.max(1, lineHeight / 4) / radius;
  for (const [lo, hi] of [
    [-HALF_PI, HALF_PI],
    [HALF_PI, Math.PI * 1.5],
  ] as const) {
    const side = labels
      .filter((l) => {
        const at = ringAngle(l.angle);
        return lo === -HALF_PI ? at <= HALF_PI : at > HALF_PI;
      })
      .sort((a, b) => ringAngle(a.angle) - ringAngle(b.angle) || tie(a, b));
    // The stretches of this side the canvas shows; a crowd is spread within
    // the one its anchors are in, since a slot off the canvas is no slot.
    const stretches: [number, number][] = [];
    for (let a = lo; a <= hi; a += step) {
      if (!visible(a)) continue;
      const last = stretches[stretches.length - 1];
      if (last !== undefined && a - last[1] <= step * 1.5) last[1] = a;
      else stretches.push([a, a]);
    }
    for (const [from, to] of stretches) {
      let group = side.filter((l) => {
        const at = ringAngle(l.angle);
        return at >= from && at <= to;
      });
      // A crowd the stretch cannot hold loses its lowest-ranked members from
      // the spread, a round at a time, until what is left fits without any
      // label pushed past `maxShift`. Spreading room for labels that will be
      // left out anyway only moves the others away from their features.
      for (let round = 0; group.length >= 2; round++) {
        const { targets, overfull } = spreadStretch(group, from * radius, to * radius);
        if (overfull.length === 0 || round >= MAX_SPREAD_ROUNDS) {
          for (const [id, at] of targets) out.set(id, at / radius);
          break;
        }
        // A tenth of each crowd that did not fit, its lowest-ranked, so a
        // crowd of hundreds is trimmed in a few rounds rather than hundreds.
        const leave = new Set<string>();
        for (const members of overfull) {
          const lowest = [...members].sort((a, b) => a.rank - b.rank || tie(b, a));
          for (const l of lowest.slice(0, Math.max(1, Math.ceil(members.length / 10))))
            leave.add(l.id);
        }
        group = group.filter((l) => !leave.has(l.id));
      }
    }
  }

  /**
   * One spread of a stretch: each label's arc position, and the clusters
   * that did not fit, because they are longer than the stretch or pushed a
   * member further than `maxShift` from its anchor.
   */
  function spreadStretch(
    group: readonly LabelInput[],
    sFrom: number,
    sTo: number,
  ): { targets: Map<string, number>; overfull: LabelInput[][] } {
    const anchor = group.map((l) => ringAngle(l.angle) * radius);
    const gap = group.map((l, i) => {
      const next = group[i + 1];
      return next === undefined
        ? 0
        : need(l, next, (ringAngle(l.angle) + ringAngle(next.angle)) / 2);
    });
    // A cluster keeps what centring it needs, so a merge costs nothing per
    // member: its span (first member to last) and the sum of its members'
    // anchors less their offsets from its start.
    interface Cluster {
      first: number;
      last: number;
      span: number;
      sum: number;
      start: number;
    }
    const place = (c: Cluster): void => {
      const ideal = c.sum / (c.last - c.first + 1);
      c.start = Math.max(sFrom, Math.min(ideal, sTo - c.span));
    };
    const clusters: Cluster[] = group.map((_, i) => {
      const c = { first: i, last: i, span: 0, sum: anchor[i] ?? 0, start: 0 };
      place(c);
      return c;
    });
    // Merge left to right until no cluster reaches into the next; a merge
    // can only move a cluster back towards the one before it, so a step back
    // after each merge settles it.
    for (let k = 1; k < clusters.length;) {
      const prev = clusters[k - 1];
      const cur = clusters[k];
      if (prev === undefined || cur === undefined) break;
      const join = gap[prev.last] ?? 0;
      if (prev.start + prev.span + join <= cur.start) {
        k++;
        continue;
      }
      const shift = prev.span + join;
      prev.sum += cur.sum - shift * (cur.last - cur.first + 1);
      prev.span = shift + cur.span;
      prev.last = cur.last;
      place(prev);
      clusters.splice(k, 1);
      k = Math.max(1, k - 1);
    }
    // Offsets of each member from its cluster's start, now the clusters are final.
    const offset = new Array<number>(group.length).fill(0);
    for (const c of clusters) {
      let o = 0;
      for (let i = c.first; i <= c.last; i++) {
        if (i > c.first) o += gap[i - 1] ?? 0;
        offset[i] = o;
      }
    }
    const end = (c: Cluster): number => c.start + c.span;
    const targets = new Map<string, number>();
    const overfull: LabelInput[][] = [];
    for (const c of clusters) {
      let over = end(c) > sTo + 0.5 || c.start < sFrom - 0.5;
      for (let i = c.first; i <= c.last; i++) {
        const label = group[i];
        const a = anchor[i];
        if (label === undefined || a === undefined) continue;
        const s = c.start + (offset[i] ?? 0);
        if (Math.abs(s - a) > maxShift) over = true;
        targets.set(label.id, Math.max(a - maxShift, Math.min(a + maxShift, s)));
      }
      if (over && c.last > c.first) overfull.push(group.slice(c.first, c.last + 1));
    }
    return { targets, overfull };
  }
  return out;
}

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

/**
 * Whether a line segment passes through a box (Liang–Barsky clipping). The
 * box is taken a pixel smaller, so a leader that only grazes a label's
 * padding is not counted as running through it.
 */
function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, box: LabelBox): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, x0 - (box.left + 1)],
    [dx, box.right - 1 - x0],
    [-dy, y0 - (box.top + 1)],
    [dy, box.bottom - 1 - y0],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
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
 * of marching down across the map. A crowd is first spread about its centre
 * (`spreadTargets`, #24); then labels are placed in rank order and each
 * takes the free slot nearest where the spread put it, the slide charged
 * from its own anchor; one that finds no slot within
 * `maxShift`, or none that fits on the canvas, is dropped rather than
 * stacked on top of its neighbour. Ruler numbers are passed in as
 * obstacles: they are placed first, never move, and are never dropped.
 *
 * Two rules keep a slid label readable, both of them item 31:
 *
 * - **No leader may cross another.** A slot whose line back to the elbow
 *   would cut across a line already drawn is refused. Spacing the text is
 *   not enough on a crowded arc: labels that clear each other but took each
 *   other's places leave a fan of crossing leaders, and the reader can no
 *   longer tell which name belongs to which tick. Testing the lines
 *   themselves rather than keeping the labels in the ring's order allows
 *   the pair whose leaders happen to miss each other, which is a few more
 *   names on the map for the same clarity. It is a rule and not a law: a
 *   label it refuses is offered the room that is left in a second pass,
 *   because two neighbours whose leaders meet beside their own features
 *   are a blemish and a missing name is not (`rescueShift`). That pass
 *   keeps the ring's order all the same (#24): with crowds spread first,
 *   a rescue free to break it bought few names and most of the
 *   inversions.
 * - **The slide is charged for.** `maxShift` is a few line heights, not a
 *   pane's width, so a label is left out rather than towed to the far end
 *   of a crowded arc. Zooming in makes this bite: the ring's radius grows,
 *   so the same slide in pixels is a smaller angle, and a whole crowd could
 *   slide the same way without the angular spacing ever looking wrong.
 */
export function layoutLabels(
  labels: readonly LabelInput[],
  layout: CircularLayout,
  options: LabelLayoutOptions,
): LabelLayout {
  const { labelRadius, lineHeight, width, height } = options;
  const inset = options.inset ?? 0;
  const maxShift = options.maxShift ?? lineHeight * MAX_SHIFT_LINES;
  const rescueShift = options.rescueShift ?? lineHeight * RESCUE_SHIFT_LINES;
  const outerReach = options.outerReach ?? maxShift;
  // The outer ring is searched on a coarser grid than the first: it is
  // offered only what the first had no room for, which on a dense map is
  // hundreds of labels.
  const outerStep = Math.max(3, lineHeight * 0.75);
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
  /** Whether a straight leader passes through no label already placed. */
  const lineIsClear = (x0: number, y0: number, x1: number, y1: number): boolean => {
    const span = {
      left: Math.min(x0, x1),
      right: Math.max(x0, x1),
      top: Math.min(y0, y1),
      bottom: Math.max(y0, y1),
    };
    for (const i of bandsOf(span)) {
      for (const other of taken.get(i) ?? [])
        if (segmentHitsBox(x0, y0, x1, y1, other)) return false;
    }
    return true;
  };
  for (const box of options.obstacles ?? []) take(box);

  // The side is fixed by the anchor, so sliding never flips a label from
  // one side of the ring to the other under the reader. It is also why a
  // label may not slide past 12 or 6 o'clock: the text runs away from the
  // ring, so a right-hand label that slid onto the left half would be
  // written back across the map.
  const HALF_PI = Math.PI / 2;
  const elbowRadius = options.elbowRadius ?? labelRadius;
  const runs: PlacedRun[] = [];
  const placed: PlacedLabel[] = [];
  const dropped: LabelInput[] = [];
  // Each label's place in the ring's own order, which is the order the slots
  // they take have to keep. Ties are broken by text (`tie`), so the order is
  // the same each time the document is opened.
  const rung = new Map(
    [...labels]
      .sort((a, b) => ringAngle(a.angle) - ringAngle(b.angle) || tie(a, b))
      .map((label, index) => [label.id, index] as const),
  );
  // Slots taken on each side, kept in that order; the invariant is that
  // their angles run the same way.
  const slots: [Slot[], Slot[]] = [[], []];
  // Where each label of a crowd would sit if the crowd shared its room (#24):
  // the first pass looks for a slot from there, the rescue pass from the
  // label's own anchor.
  const targets = spreadTargets(labels, layout, options, maxShift);

  const attempt = (
    label: LabelInput,
    strict: boolean,
    limit = maxShift,
    outer = false,
  ): Attempt | null => {
    const at = ringAngle(label.angle);
    const start = targets.get(label.id) ?? at;
    const reach = limit + Math.abs(start - at) * radius;
    const right = at <= HALF_PI;
    const align = right ? 'left' : 'right';
    const taken = slots[right ? 0 : 1];
    const mine = rung.get(label.id) ?? 0;
    let after = 0;
    while (after < taken.length && (taken[after]?.rung ?? 0) < mine) after++;
    // Room the neighbours already placed leave: strictly between the slot
    // below and the slot above, so the order along the ring cannot break.
    // Both passes keep it (#24): with the crowds spread, a rescue that may
    // break the order bought few names and most of the inversions.
    const lo = Math.max(right ? -HALF_PI : HALF_PI, taken[after - 1]?.at ?? -Infinity);
    const hi = Math.min(right ? HALF_PI : Math.PI * 1.5, taken[after]?.at ?? Infinity);
    const ex = layout.cx + elbowRadius * Math.cos(at);
    const ey = layout.cy + elbowRadius * Math.sin(at);
    // What a leader may run from its elbow: to the ring and along it, or,
    // for the outer ring, the same length in any direction.
    const budget = labelRadius - elbowRadius + limit;
    for (let i = 0; i * step <= reach; i++) {
      for (const dir of i === 0 ? [0] : [1, -1]) {
        const angle = start + (dir * i * step) / radius;
        if (angle < lo || angle > hi) continue;
        // The slide is charged from the label's own anchor, wherever the search began.
        if (Math.abs(angle - at) * radius > limit) continue;
        for (
          let r = outer ? labelRadius + outerStep : labelRadius;
          r <= labelRadius + (outer ? outerReach : 0);
          r += outerStep
        ) {
          const ax = layout.cx + r * Math.cos(angle);
          const ay = layout.cy + r * Math.sin(angle);
          if (outer && Math.hypot(ax - ex, ay - ey) > budget) break;
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
          // A leader out to the second ring runs between the first ring's
          // labels, and must not run through one.
          if (outer && !lineIsClear(ex, ey, ax, ay)) continue;
          const run: PlacedRun = {
            lo: Math.min(at, angle),
            hi: Math.max(at, angle),
            ex,
            ey,
            ax,
            ay,
          };
          if (strict && !runIsClear(runs, run, ex, ey, ax, ay)) continue;
          return {
            label: { ...label, x, y: ay, align, anchorX: ax, anchorY: ay, box },
            run,
            slot: { rung: mine, at: angle },
            side: right ? 0 : 1,
            index: after,
          };
        }
      }
    }
    return null;
  };

  const keep = (got: Attempt): void => {
    placed.push(got.label);
    take(got.label.box);
    runs.push(got.run);
    slots[got.side].splice(got.index, 0, got.slot);
  };

  const order = [...labels].sort((a, b) => b.rank - a.rank || a.angle - b.angle || tie(a, b));
  const tangled: LabelInput[] = [];
  for (const label of order) {
    const got = attempt(label, true);
    if (got === null) tangled.push(label);
    else keep(got);
  }
  // A name the ring has room for is worth a crossed leader. What made the
  // reported map unreadable was a fan of long ones, and `maxShift` has
  // already ruled that out; a pair that meet near their own features is a
  // blemish, and losing the name of a feature is not. So everything the
  // rule refused is offered the room that is left.
  const left: LabelInput[] = [];
  for (const label of tangled) {
    const got = attempt(label, false, rescueShift);
    if (got === null) left.push(label);
    else keep(got);
  }
  // What the ring has no room for is offered a second ring outside it (#23),
  // under the first ring's rules: in order, no leader crossed, and a leader
  // no longer than one to the first ring may be. Near 12 and 6 o'clock that
  // is a second row a line or two out; at the sides it is a second column
  // beyond the first ring's labels, which only a wide canvas has room for.
  // In rank order, and given up once enough in a row have found no room:
  // by then the outer ring is full where the crowd is.
  let misses = 0;
  for (const label of left) {
    const got =
      outerReach > 0 && misses < OUTER_MISSES ? attempt(label, true, maxShift, true) : null;
    if (got === null) {
      dropped.push(label);
      misses++;
    } else {
      keep(got);
      misses = 0;
    }
  }
  return { placed, dropped };
}
