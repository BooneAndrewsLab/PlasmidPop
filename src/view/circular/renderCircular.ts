import {
  type CutSite,
  type DocumentDiff,
  type Feature,
  type Range,
  type SeqDocument,
  describeEnds,
  featureLength,
  rangePieces,
  sameFeatureLocation,
} from '@/core';

import { type DrawingContext } from '../drawingContext';
import { isTransparent } from '../svg/svgContext';
import { contrastingText, featureColor } from '../featureColors';
import { type LaneAssignment } from '../linear/lanes';
import { type OverlaySpan, overlayPieces } from '../overlay';
import { drawableFeatures, featuresToLabel } from '../visibleFeatures';
import {
  type CircularLayout,
  type LabelBox,
  type LabelInput,
  type PlacedLabel,
  labelBox,
  layoutLabels,
  tickInterval,
} from './circularLayout';

export interface CircularTheme {
  readonly ink: string;
  readonly inkMuted: string;
  readonly backbone: string;
  readonly tick: string;
  readonly selectionFill: string;
  readonly caret: string;
  readonly background: string;
  readonly leader: string;
  readonly cutSite: string;
  /** Spans previewed beside the document's own annotation, which are not in it. */
  readonly preview: string;
  /** Tracked changes: bases that are new, that replaced others, and that are gone. */
  readonly editInsert: string;
  readonly editChange: string;
  readonly editDelete: string;
}

export interface CircularRenderParams {
  readonly doc: SeqDocument;
  readonly layout: CircularLayout;
  readonly lanes: LaneAssignment;
  readonly selection: Range | null;
  readonly cutSites: readonly CutSite[];
  /** Transient spans drawn in a ring just inside the backbone; see `OverlaySpan`. */
  readonly overlay: readonly OverlaySpan[];
  readonly overlayLanes: LaneAssignment;
  /**
   * Tracked changes in this document's coordinates, drawn on the ring; the
   * same `DocumentDiff` the sequence view marks, so the two views answer the
   * question the same way. Null when there is nothing to mark.
   */
  readonly edits: DocumentDiff | null;
  readonly hoveredFeatureId: string | null;
  /** Top-strand cut position under the pointer, if any; its label is kept. */
  readonly hoveredCut: number | null;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly theme: CircularTheme;
  readonly sansFont: string;
  readonly titleFont: string;
  /**
   * How far a label may slide along the ring from the thing it names, in
   * line heights. On screen a name the ring has no room for is one hover
   * away, so the map keeps its leaders short and leaves the name out; an
   * export has no hover, so it pays the longer leader rather than lose it.
   */
  readonly labelShiftLines?: number;
}

interface MapMetrics {
  readonly fontSize: number;
  readonly lineHeight: number;
  /** Radial offsets from the backbone, for everything drawn outside it. */
  readonly tickOuter: number;
  readonly tickText: number;
  readonly elbow: number;
  readonly labelRing: number;
  /** Thickness of the tracked-changes arc laid over the backbone. */
  readonly editRing: number;
  /** Half-width of the wedge that marks bases which are gone. */
  readonly deletionWedge: number;
}

function fontSizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m === null ? 12 : Number.parseFloat(m[1] ?? '12');
}

/**
 * The room to leave outside the circle for the label ring drawn in `sansFont`
 * (#25): 110 px at the screen's 12 px, the margin the map has always had,
 * and in step with the rings `mapMetrics` measures in text, so a map drawn
 * in larger type keeps room for its labels rather than a constant's worth.
 */
export function labelMargin(sansFont: string): number {
  return Math.round((fontSizeOf(sansFont) * 110) / 12);
}

/**
 * Everything outside the backbone is measured in text, so an export drawn at
 * twice the type size moves its rings out with it. At the screen's 12 px
 * these come out at the offsets the map has always used (7, 12, 26, 34).
 */
function mapMetrics(p: CircularRenderParams): MapMetrics {
  const fontSize = fontSizeOf(p.sansFont);
  return {
    fontSize,
    lineHeight: Math.max(12, fontSize * 1.15),
    tickOuter: fontSize * 0.58,
    tickText: fontSize,
    elbow: fontSize * 2.15,
    labelRing: fontSize * 2.8,
    editRing: fontSize * 0.5,
    deletionWedge: fontSize / 3,
  };
}

function drawBackbone(ctx: DrawingContext, p: CircularRenderParams): void {
  const { layout, theme, doc } = p;
  ctx.strokeStyle = theme.backbone;
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (doc.topology === 'circular') {
    ctx.arc(layout.cx, layout.cy, layout.radius, 0, Math.PI * 2);
  } else {
    // A linear molecule is shown as an open ring with a gap at the origin.
    ctx.arc(
      layout.cx,
      layout.cy,
      layout.radius,
      layout.angleOf(0) + 0.06,
      layout.angleOf(doc.length) - 0.06,
    );
  }
  ctx.stroke();
  if (doc.topology === 'linear' && doc.ends !== null) drawEndTips(ctx, p);
}

/**
 * A stroke across the backbone at each tip of an open ring whose ends are
 * worth naming — cut by an enzyme, or sticky — so the gap reads as the cut
 * ends it is rather than as a gap in the drawing (#9). What the ends are is
 * written in the centre (`drawCentre`).
 */
function drawEndTips(ctx: DrawingContext, p: CircularRenderParams): void {
  const { layout, theme, doc } = p;
  ctx.strokeStyle = theme.cutSite;
  ctx.lineWidth = 2;
  for (const [position, nudge] of [
    [0, 0.06],
    [doc.length, -0.06],
  ] as const) {
    const a = layout.angleOf(position) + nudge;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(layout.cx + (layout.radius - 5) * cos, layout.cy + (layout.radius - 5) * sin);
    ctx.lineTo(layout.cx + (layout.radius + 5) * cos, layout.cy + (layout.radius + 5) * sin);
    ctx.stroke();
  }
}

interface RulerTick {
  readonly position: number;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly align: 'left' | 'right' | 'center';
}

/**
 * Where the ruler's numbers go. They are worked out before the labels are
 * placed because the label pass spaces against them: a tick number is drawn
 * wherever the ruler says, and it is the label that gives way.
 */
function rulerTicks(p: CircularRenderParams, m: MapMetrics): RulerTick[] {
  const { layout, doc } = p;
  if (doc.length === 0) return [];
  // More ticks as the map zooms in, so their spacing on screen stays put.
  const step = tickInterval(doc.length, Math.round(16 * layout.zoom));
  const out: RulerTick[] = [];
  for (let pos = 0; pos < doc.length; pos += step) {
    const a = layout.angleOf(pos);
    const inner = layout.pointAt(pos, layout.radius + 1);
    if (!layout.isOnCanvas(inner.x, inner.y, 80)) continue;
    const at = layout.pointAt(pos, layout.radius + m.tickText);
    const cos = Math.cos(a);
    out.push({
      position: pos,
      text: pos === 0 ? '1' : pos.toLocaleString(),
      x: at.x,
      y: at.y + (Math.sin(a) < -0.9 ? -2 : 0),
      align: Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right',
    });
  }
  return out;
}

/**
 * The tick marks only. Their numbers are drawn with the labels, after the
 * leader lines, so that nothing is written through them.
 */
function drawTickMarks(
  ctx: DrawingContext,
  p: CircularRenderParams,
  m: MapMetrics,
  ticks: readonly RulerTick[],
): void {
  const { layout, theme } = p;
  ctx.strokeStyle = theme.tick;
  ctx.lineWidth = 1;
  for (const tick of ticks) {
    const inner = layout.pointAt(tick.position, layout.radius + 1);
    const outer = layout.pointAt(tick.position, layout.radius + m.tickOuter);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
  }
}

/** Shortest the selection band may be on screen, in pixels of arc. */
const MIN_SELECTION_PX = 7;

/**
 * The least arc a range segment is drawn over, in pixels (#26). A 2 bp site
 * on a 4 kb plasmid is half a pixel of ring, which is nothing; three is a
 * mark, still narrow enough not to be mistaken for something longer. The
 * map view hit-tests the same width, so what can be seen can be pointed at.
 */
export const MIN_FEATURE_PX = 3;

/**
 * Angular span of the drawn selection band. A one- or two-base selection of
 * a plasmid covers a fraction of a degree, so the span is widened about its
 * centre until it is `minPx` of arc at `radius`; `widened` tells the caller
 * the band alone is too thin to find, and a radial marker is drawn as well.
 */
export function selectionSweep(
  startAngle: number,
  endAngle: number,
  radius: number,
  minPx: number = MIN_SELECTION_PX,
): { readonly start: number; readonly end: number; readonly widened: boolean } {
  const raw = endAngle - startAngle;
  // A selection crossing the origin can end at a smaller angle than it
  // starts; the arc then sweeps clockwise the long way round.
  const span = raw >= 0 ? raw : raw + Math.PI * 2;
  const minAngle = radius > 0 ? Math.min(minPx / radius, Math.PI * 2) : 0;
  if (span >= minAngle) return { start: startAngle, end: endAngle, widened: false };
  const mid = startAngle + span / 2;
  return { start: mid - minAngle / 2, end: mid + minAngle / 2, widened: true };
}

/** Radius the selection marker points in to: just inside the lanes. */
function innerRadius(layout: CircularLayout): number {
  const r =
    layout.laneCount > 0
      ? layout.laneRadius(layout.laneCount - 1) - layout.ringWidth
      : layout.radius - 20;
  return Math.max(4, r);
}

/** Returns whether the band was too thin to stand on its own. */
function drawSelection(ctx: DrawingContext, p: CircularRenderParams): boolean {
  const { selection, layout, theme, doc } = p;
  if (selection === null || doc.length === 0) return false;
  // The caret is the needle a tiny selection gets, drawn over the features
  // (#26): a short tick on the backbone was lost under a feature's arc.
  if (selection.start === selection.end) return true;
  const outer = layout.radius + 8;
  const sweep = selectionSweep(
    layout.angleOf(selection.start),
    layout.angleOf(selection.end),
    outer,
  );
  ctx.strokeStyle = theme.selectionFill;
  ctx.lineWidth = 14 + layout.laneCount * layout.ringWidth;
  ctx.beginPath();
  ctx.arc(layout.cx, layout.cy, outer - ctx.lineWidth / 2, sweep.start, sweep.end);
  ctx.stroke();
  return sweep.widened;
}

/**
 * A short selection is drawn again on top of the features as a needle
 * running from outside the backbone in towards the centre, so that even a
 * 1 bp range is impossible to miss.
 */
function drawSelectionMarker(ctx: DrawingContext, p: CircularRenderParams): void {
  const { selection, layout, theme } = p;
  if (selection === null) return;
  const sweep = selectionSweep(
    layout.angleOf(selection.start),
    layout.angleOf(selection.end),
    layout.radius + 8,
  );
  const mid = (sweep.start + sweep.end) / 2;
  const cos = Math.cos(mid);
  const sin = Math.sin(mid);
  const from = innerRadius(layout);
  const to = layout.radius + 8;
  ctx.strokeStyle = theme.caret;
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(layout.cx + from * cos, layout.cy + from * sin);
  ctx.lineTo(layout.cx + to * cos, layout.cy + to * sin);
  ctx.stroke();
}

function arrowHead(
  ctx: DrawingContext,
  layout: CircularLayout,
  position: number,
  r: number,
  clockwise: boolean,
  half: number,
): void {
  // Triangle whose tip is `half*1.4` px further along the arc.
  const dir = clockwise ? 1 : -1;
  const tipAngle = layout.angleOf(position) + (dir * (half * 1.4)) / r;
  const baseAngle = layout.angleOf(position);
  const tip = { x: layout.cx + r * Math.cos(tipAngle), y: layout.cy + r * Math.sin(tipAngle) };
  const o = {
    x: layout.cx + (r + half) * Math.cos(baseAngle),
    y: layout.cy + (r + half) * Math.sin(baseAngle),
  };
  const i = {
    x: layout.cx + (r - half) * Math.cos(baseAngle),
    y: layout.cy + (r - half) * Math.sin(baseAngle),
  };
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(i.x, i.y);
  ctx.closePath();
  ctx.fill();
}

function drawFeature(
  ctx: DrawingContext,
  p: CircularRenderParams,
  feature: Feature,
  lane: number,
): void {
  const { layout, doc } = p;
  const r = layout.laneRadius(lane);
  const thickness = layout.ringWidth - 4;
  const half = thickness / 2;
  const color = featureColor(feature);
  const hovered = feature.id === p.hoveredFeatureId;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';

  feature.segments.forEach((seg, index) => {
    if (seg.kind === 'site') {
      const a = layout.pointAt(seg.position, r - half);
      const b = layout.pointAt(seg.position, r + half);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      return;
    }
    const first = index === 0;
    const last = index === feature.segments.length - 1;
    const forward = feature.strand === 'forward';
    const arcLength = ((seg.end - seg.start) / Math.max(1, doc.length)) * Math.PI * 2 * r;
    const arrow = arcLength > half * 3 ? half * 1.4 : 0;
    // Too short to see is widened about its middle to a mark (#26).
    const sweep = selectionSweep(
      layout.angleOf(seg.start),
      layout.angleOf(seg.end),
      r,
      MIN_FEATURE_PX,
    );
    let a0 = sweep.start;
    let a1 = sweep.end;
    if (forward && last && arrow > 0) a1 -= arrow / r;
    if (!forward && first && arrow > 0) a0 += arrow / r;
    ctx.lineWidth = thickness;
    ctx.beginPath();
    ctx.arc(layout.cx, layout.cy, r, a0, Math.max(a0, a1));
    ctx.stroke();
    if (arrow > 0) {
      if (forward && last)
        arrowHead(ctx, layout, seg.end - (arrow / r) * (doc.length / (Math.PI * 2)), r, true, half);
      if (!forward && first)
        arrowHead(
          ctx,
          layout,
          seg.start + (arrow / r) * (doc.length / (Math.PI * 2)),
          r,
          false,
          half,
        );
    }
  });

  // An annotation that was added or edited is outlined in the colour of the
  // change, as it is in the sequence view. That outranks the hover outline:
  // the pointer is already saying which feature it is on, and the colour is
  // saying something the reader cannot get any other way.
  const outline = editOutline(p, feature);
  if (hovered || outline !== null) {
    ctx.strokeStyle = outline?.color ?? contrastingText(color);
    ctx.lineWidth = outline === null ? 1.5 : 2;
    ctx.setLineDash(outline?.dashed === true ? EDIT_DASH : []);
    for (const seg of feature.segments) {
      if (seg.kind !== 'range') continue;
      for (const edge of [r - half + 0.75, r + half - 0.75]) {
        ctx.beginPath();
        ctx.arc(layout.cx, layout.cy, edge, layout.angleOf(seg.start), layout.angleOf(seg.end));
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
}

/** Dash for the outline of a feature whose bases did not change, only its label. */
const EDIT_DASH = [3, 2];

/** The colour a changed annotation is outlined in, and the line it is drawn with. */
interface EditOutline {
  readonly color: string;
  /** Broken, for a feature whose bases are the same and whose label is not. */
  readonly dashed: boolean;
}

/**
 * How an annotation that changed since the baseline is outlined: the colour
 * of the change, and whether the line is broken.
 *
 * A solid line means the feature covers different bases than it did. A
 * broken one means the same bases, described differently — retyped, renamed,
 * a qualifier edited. That is the one distinction a line can carry, and it
 * is the one worth carrying: the first can break a construct, the second
 * cannot.
 */
function editOutline(p: CircularRenderParams, feature: Feature): EditOutline | null {
  const { edits, theme } = p;
  if (edits === null) return null;
  if (edits.featuresAdded.has(feature.id)) return { color: theme.editInsert, dashed: false };
  const before = edits.featuresChanged.get(feature.id);
  if (before === undefined) return null;
  return { color: theme.editChange, dashed: sameFeatureLocation(before, feature) };
}

/** Shortest an edit arc may be on screen, as a short selection has. */
const MIN_EDIT_PX = 7;

/**
 * Tracked changes on the ring: arcs over the backbone where bases are new or
 * stand where others used to, and a marker at every boundary where bases
 * closed up.
 *
 * They are drawn *as* the backbone rather than in a ring of their own
 * because that is what they are — a stretch of changed bases is a stretch of
 * the molecule — and because it is the one radius left: the feature lanes
 * are inside it, the preview ring just under it, the ruler just outside.
 */
function drawEditMarks(ctx: DrawingContext, p: CircularRenderParams, m: MapMetrics): void {
  const { edits, layout, theme, doc } = p;
  if (edits === null || doc.length === 0) return;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  for (const mark of edits.marks) {
    for (const piece of rangePieces({ start: mark.start, end: mark.end }, doc.length)) {
      if (piece.end <= piece.start) continue;
      // A single inserted base is a thousandth of a turn on a plasmid, so a
      // short arc is widened about its centre the way a short selection is.
      const sweep = selectionSweep(
        layout.angleOf(piece.start),
        layout.angleOf(piece.end),
        layout.radius,
        MIN_EDIT_PX,
      );
      ctx.strokeStyle = mark.kind === 'inserted' ? theme.editInsert : theme.editChange;
      ctx.lineWidth = m.editRing;
      ctx.beginPath();
      ctx.arc(layout.cx, layout.cy, layout.radius, sweep.start, Math.max(sweep.start, sweep.end));
      ctx.stroke();
    }
  }
  for (const deletion of edits.deletions) drawDeletion(ctx, p, m, deletion.position);
}

/**
 * Where bases closed up. A deletion has no width on the ring — the bases it
 * took are not on the molecule any more — so there is nothing to sweep, only
 * a place to point at: a line across the ring at the join, and a wedge
 * inside pointing out at it, as the sequence view puts one over the strands.
 *
 * The wedge goes inside because outside is the ruler's: its numbers sit a
 * dozen pixels out and are placed before anything else is.
 */
function drawDeletion(
  ctx: DrawingContext,
  p: CircularRenderParams,
  m: MapMetrics,
  position: number,
): void {
  const { layout, theme } = p;
  const angle = layout.angleOf(position);
  const at = (r: number, a: number = angle): { x: number; y: number } => ({
    x: layout.cx + r * Math.cos(a),
    y: layout.cy + r * Math.sin(a),
  });
  const tipR = layout.radius - m.editRing / 2 - 1;
  const baseR = tipR - m.deletionWedge * 1.6;
  ctx.strokeStyle = theme.editDelete;
  ctx.fillStyle = theme.editDelete;
  ctx.lineCap = 'butt';
  ctx.setLineDash([]);
  // Thinner than the arc it crosses, and scaled with it: at the screen's
  // 12 px this is the 2 px the sequence view draws the same line at.
  ctx.lineWidth = m.editRing / 3;
  const inner = at(tipR);
  const outer = at(layout.radius + m.editRing / 2 + 1);
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.lineTo(outer.x, outer.y);
  ctx.stroke();
  // The wedge is as wide in pixels wherever it is drawn, so its half-width
  // is an angle that shrinks as the map zooms in and the radius grows.
  const half = m.deletionWedge / Math.max(1, baseR);
  const left = at(baseR, angle - half);
  const right = at(baseR, angle + half);
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fill();
}

/** Radial pitch of the preview ring, which stacks inwards from the backbone. */
const PREVIEW_RING = 7;

/**
 * Where a previewed span in `lane` is drawn, counting inwards from the
 * backbone. Exported so hit-testing asks the same question the drawing
 * answers rather than keeping a second copy of these numbers.
 */
export function overlayRingRadius(radius: number, lane: number, laneCount: number): number {
  const ring = Math.max(0, laneCount - 1 - lane);
  return Math.max(6, radius - 6 - ring * PREVIEW_RING);
}
/** Shortest a preview arc may be on screen, as the selection band has. */
const MIN_PREVIEW_PX = 7;

/**
 * The preview: transient spans in a ring of their own between the backbone
 * and the first feature lane, in one colour that belongs to nothing in the
 * document. A short one is widened the way a short selection is, so a 20 nt
 * primer on a 4 kb plasmid can still be seen. Labels are left to the panel
 * that asked for the preview — the map's own label ring is busy enough.
 */
function drawOverlays(ctx: DrawingContext, p: CircularRenderParams): void {
  const { layout, theme, doc, overlay, overlayLanes } = p;
  if (overlay.length === 0 || doc.length === 0) return;
  ctx.lineCap = 'butt';
  for (const span of overlay) {
    // The rings stack inwards, but the *last* lane takes the clear gap just
    // inside the backbone: lane 0 holds the longest span (the bracket of a
    // product, say), and a thin dashed line crossing the feature lanes
    // hides less of them than a primer's solid arc would.
    const lane = overlayLanes.laneOf.get(span.id) ?? 0;
    const r = overlayRingRadius(layout.radius, lane, overlayLanes.laneCount);
    const bracket = span.shape === 'span';
    const half = bracket ? 3 : 2.5;
    const pieces = overlayPieces(span, doc.length);
    pieces.forEach((piece, index) => {
      const sweep = selectionSweep(
        layout.angleOf(piece.start),
        layout.angleOf(piece.end),
        r,
        MIN_PREVIEW_PX,
      );
      // Which way a primer reads is the point of drawing it, so a head goes
      // on as soon as there is room for one, as a feature's does.
      const arrow = !bracket && (sweep.end - sweep.start) * r > half * 3 ? half * 1.4 : 0;
      const forward = span.strand === 'forward';
      const first = index === 0;
      const last = index === pieces.length - 1;
      let a0 = sweep.start;
      let a1 = sweep.end;
      if (arrow > 0 && forward && last) a1 -= arrow / r;
      if (arrow > 0 && !forward && first) a0 += arrow / r;
      ctx.strokeStyle = theme.preview;
      ctx.fillStyle = theme.preview;
      ctx.lineWidth = bracket ? 1.5 : half * 2;
      ctx.setLineDash(bracket ? [4, 3] : []);
      ctx.beginPath();
      ctx.arc(layout.cx, layout.cy, r, a0, Math.max(a0, a1));
      ctx.stroke();
      ctx.setLineDash([]);
      if (bracket) {
        // End ticks, so a bracket's limits read even where it is faint.
        for (const [angle, draw] of [
          [sweep.start, first],
          [sweep.end, last],
        ] as const) {
          if (!draw) continue;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(layout.cx + (r - 4) * Math.cos(angle), layout.cy + (r - 4) * Math.sin(angle));
          ctx.lineTo(layout.cx + (r + 4) * Math.cos(angle), layout.cy + (r + 4) * Math.sin(angle));
          ctx.stroke();
        }
      } else if (arrow > 0) {
        const at = (angle: number): number => ((angle + Math.PI / 2) / (Math.PI * 2)) * doc.length;
        if (forward && last) arrowHead(ctx, layout, at(a1), r, true, half);
        if (!forward && first) arrowHead(ctx, layout, at(a0), r, false, half);
      }
    });
  }
}

/** Smallest angle between two directions, in radians. */
function angleGap(a: number, b: number): number {
  const twoPi = Math.PI * 2;
  let d = (a - b + Math.PI) % twoPi;
  if (d < 0) d += twoPi;
  return Math.abs(d - Math.PI);
}

function featureMidAngle(
  feature: Feature,
  layout: CircularLayout,
  seqLength: number,
): number | null {
  let total = 0;
  let weighted = 0;
  for (const seg of feature.segments) {
    if (seg.kind !== 'range') continue;
    const len = seg.end - seg.start;
    total += len;
    weighted += len * (seg.start + len / 2);
  }
  if (total === 0) return null;
  return layout.angleOf((weighted / total) % Math.max(1, seqLength));
}

const CUT_PREFIX = 'cut:';

/** Narrowest a label may be shortened to before it is left out instead. */
const MIN_LABEL_WIDTH = 34;
const ELLIPSIS = '…';

/**
 * Who keeps their place when the ring cannot hold everything: features
 * longest first, then cut sites rarest first — the unique cutter is the one
 * a cloner is looking for. A feature outranks a cut site because it is the
 * document's own annotation, while the cut sites are an analysis the Enzymes
 * tab can narrow at will.
 *
 * What the pointer is on is deliberately *not* in this: ranking it first
 * would let it take the slot nearest its anchor and shuffle its neighbours,
 * so labels swapped places as the pointer moved between two features. A
 * hovered label whose ring had no room is brought back by
 * `drawFloatingLabel` instead, which costs the layout nothing.
 */
const RANK_FEATURE = 2e9;
const RANK_CUT = 1e9;

/** The text, shortened with an ellipsis, or null if even that will not fit. */
function fitText(
  ctx: DrawingContext,
  text: string,
  maxWidth: number,
): { readonly text: string; readonly width: number } | null {
  const full = ctx.measureText(text).width;
  if (full <= maxWidth) return { text, width: full };
  if (maxWidth < MIN_LABEL_WIDTH) return null;
  let lo = 0;
  let hi = text.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ELLIPSIS).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  if (lo === 0) return null;
  const cut = text.slice(0, lo) + ELLIPSIS;
  return { text: cut, width: ctx.measureText(cut).width };
}

/**
 * The background behind a piece of text, so a leader line that passes under
 * it does not read as a strike-through. An export asked for a transparent
 * background paints nothing here, which is the right answer for one.
 */
function drawPlate(ctx: DrawingContext, p: CircularRenderParams, box: LabelBox): void {
  if (isTransparent(p.theme.background)) return;
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(box.left - 2, box.top, box.right - box.left + 4, box.bottom - box.top);
}

/**
/**
 * Room kept clear at the canvas edges. The hovered label's outline stands a
 * little outside its box, and a label allowed to end exactly at the edge
 * would have that outline clipped.
 */
const EDGE_INSET = 5;

/** Corners and padding of the outline the hovered label is drawn in. */
const BUBBLE_RADIUS = 4;
const BUBBLE_PAD_X = 4;
const BUBBLE_PAD_Y = 1.5;

/**
 * The label under the pointer, drawn in a rounded outline rather than as
 * text on a bare plate. It is the one label that may sit over its
 * neighbours — a label the ring had no room for has nowhere of its own to
 * go — and a plain rectangle of background over them reads as a hole
 * punched in the map rather than as something lying on top of it. The
 * leader line joins it as it does any other label, so it needs no tail of
 * its own.
 */
function drawBubble(
  ctx: DrawingContext,
  p: CircularRenderParams,
  box: LabelBox,
  color: string,
): void {
  const r = BUBBLE_RADIUS;
  const left = box.left - BUBBLE_PAD_X;
  const right = box.right + BUBBLE_PAD_X;
  const top = box.top - BUBBLE_PAD_Y;
  const bottom = box.bottom + BUBBLE_PAD_Y;
  ctx.beginPath();
  ctx.moveTo(left + r, top);
  ctx.lineTo(right - r, top);
  ctx.arc(right - r, top + r, r, -Math.PI / 2, 0);
  ctx.lineTo(right, bottom - r);
  ctx.arc(right - r, bottom - r, r, 0, Math.PI / 2);
  ctx.lineTo(left + r, bottom);
  ctx.arc(left + r, bottom - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(left, top + r);
  ctx.arc(left + r, top + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
  if (!isTransparent(p.theme.background)) {
    ctx.fillStyle = p.theme.background;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * A label the ring had no room for, drawn in a bubble on top of whatever is
 * there because the pointer is on the thing it names. This is the way back
 * to a name the map left out.
 */
function drawFloatingLabel(
  ctx: DrawingContext,
  p: CircularRenderParams,
  m: MapMetrics,
  text: string,
  angle: number,
  color: string,
  start: { readonly x: number; readonly y: number },
): void {
  const { layout } = p;
  const labelRadius = layout.radius + m.labelRing;
  const ax = layout.cx + labelRadius * Math.cos(angle);
  const ay = layout.cy + labelRadius * Math.sin(angle);
  const width = ctx.measureText(text).width;
  const ideal = Math.cos(angle) >= 0 ? ax + 4 : ax - 4 - width;
  // Clamped onto the canvas: beside the wrong part of the ring beats off
  // the edge, and this only happens where the ring had no room at all.
  const x = Math.min(
    Math.max(ideal, BUBBLE_PAD_X + EDGE_INSET),
    Math.max(EDGE_INSET, p.width - width - BUBBLE_PAD_X - EDGE_INSET),
  );
  const y = Math.min(Math.max(ay, m.lineHeight), p.height - m.lineHeight);
  const box = labelBox(x, y, width, m.lineHeight, 'left');
  const elbow = {
    x: layout.cx + (layout.radius + m.elbow) * Math.cos(angle),
    y: layout.cy + (layout.radius + m.elbow) * Math.sin(angle),
  };
  // The leader runs to whichever side of the outline faces the map, so a
  // label the clamp moved is still tied to the thing it names.
  const join = elbow.x <= box.left ? box.left - BUBBLE_PAD_X : box.right + BUBBLE_PAD_X;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(join, y);
  ctx.stroke();
  drawBubble(ctx, p, box, color);
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/**
 * Labels for features and for cut sites share one ring, so they are spaced
 * against each other and against the ruler's numbers. Returns how many were
 * left out for want of room; the map says so in the corner, and the one
 * under the pointer comes back on top (`drawFloatingLabel`).
 */
function drawLabels(
  ctx: DrawingContext,
  p: CircularRenderParams,
  m: MapMetrics,
  visible: readonly Feature[],
  ticks: readonly RulerTick[],
): { readonly dropped: number; readonly drawn: DrawnLabel[] } {
  const { layout, theme, doc } = p;
  ctx.font = p.sansFont;
  const labelRadius = layout.radius + m.labelRing;
  const obstacles = ticks.map((t) =>
    labelBox(t.x, t.y, ctx.measureText(t.text).width, m.lineHeight, t.align),
  );

  const inputs: LabelInput[] = [];
  let unfit = 0;
  const add = (id: string, text: string, angle: number, rank: number): void => {
    if (text === '') return;
    const ax = layout.cx + labelRadius * Math.cos(angle);
    const ay = layout.cy + labelRadius * Math.sin(angle);
    // A label anchored off the canvas is not "left out" — the thing it names
    // is off screen too, and counting it would make the tally meaningless on
    // a zoomed-in map.
    if (!layout.isOnCanvas(ax, ay, m.lineHeight * 2)) return;
    // The text runs outwards from the ring, so what is left of the canvas on
    // that side is all the room there is. Long names on the left used to run
    // off the edge because only the anchor was tested.
    const room = (Math.cos(angle) >= 0 ? p.width - ax : ax) - 8 - EDGE_INSET;
    const fitted = fitText(ctx, text, room);
    if (fitted === null) {
      unfit++;
      return;
    }
    inputs.push({ id, text: fitted.text, angle, textWidth: fitted.width, rank });
  };

  const labelled = featuresToLabel(visible, doc.length);
  const angleOf = new Map<string, number>();
  for (const f of labelled) {
    const angle = featureMidAngle(f, layout, doc.length);
    if (angle === null) continue;
    angleOf.set(f.id, angle);
    add(f.id, f.name, angle, RANK_FEATURE + Math.min(featureLength(f), 1e6));
  }

  const cutsByPosition = new Map<number, string[]>();
  const cutsPerEnzyme = new Map<string, number>();
  for (const s of p.cutSites) {
    const list = cutsByPosition.get(s.cut) ?? [];
    list.push(s.enzyme);
    cutsByPosition.set(s.cut, list);
    cutsPerEnzyme.set(s.enzyme, (cutsPerEnzyme.get(s.enzyme) ?? 0) + 1);
  }
  for (const [cut, names] of cutsByPosition) {
    const text = `${names.join(', ')} (${(cut + 1).toLocaleString()})`;
    const rarity = Math.min(...names.map((n) => cutsPerEnzyme.get(n) ?? 1));
    const rank = RANK_CUT + 1e6 - Math.min(rarity, 1e3) * 1e3;
    add(`${CUT_PREFIX}${cut}`, text, layout.angleOf(cut), rank);
  }

  const { placed, dropped } = layoutLabels(inputs, layout, {
    labelRadius,
    elbowRadius: layout.radius + m.elbow,
    lineHeight: m.lineHeight,
    // A caller that asks for a longer slide is a figure, not a screen: it
    // also wants the label the rules refused rather than a gap, so the
    // rescue pass gets the whole budget too.
    ...(p.labelShiftLines === undefined
      ? {}
      : {
          maxShift: m.lineHeight * p.labelShiftLines,
          rescueShift: m.lineHeight * p.labelShiftLines,
        }),
    width: p.width,
    height: p.height,
    obstacles,
    inset: EDGE_INSET,
  });

  const byId = new Map(visible.map((f) => [f.id, f] as const));
  const hoveredFeature = p.hoveredFeatureId === null ? undefined : byId.get(p.hoveredFeatureId);
  const hoveredAngle =
    hoveredFeature === undefined ? null : featureMidAngle(hoveredFeature, layout, doc.length);
  /**
   * The label that speaks for whatever the pointer is on. `featuresToLabel`
   * collapses features that share a name into one label, so the feature
   * under the pointer often has no label of its own — a gene and the CDS
   * inside it, say. The nearest label of the same name is the one to
   * highlight; drawing a second copy of the same name beside it, which is
   * what happened before, says nothing and covers its neighbours.
   */
  const hoveredLabelId = ((): string | null => {
    if (p.hoveredFeatureId !== null) {
      if (angleOf.has(p.hoveredFeatureId)) return p.hoveredFeatureId;
      if (hoveredFeature === undefined || hoveredFeature.name === '' || hoveredAngle === null)
        return null;
      let best: string | null = null;
      let bestGap = Infinity;
      for (const f of labelled) {
        if (f.name !== hoveredFeature.name) continue;
        const angle = angleOf.get(f.id);
        if (angle === undefined) continue;
        const gap = angleGap(angle, hoveredAngle);
        if (gap < bestGap) {
          bestGap = gap;
          best = f.id;
        }
      }
      return best;
    }
    if (p.hoveredCut !== null) return `${CUT_PREFIX}${p.hoveredCut}`;
    return null;
  })();
  ctx.textBaseline = 'middle';

  /**
   * A label's leader: from the feature's lane (or the cut site's tick)
   * out to the ring. The elbow stays at the anchor's own angle, so a label
   * that slid along the ring is joined to its feature by a line that runs
   * beside the ring rather than across the map.
   */
  const lanePoint = (feature: Feature, angle: number): { x: number; y: number } => {
    const lane = p.lanes.laneOf.get(feature.id) ?? 0;
    const r = layout.laneRadius(lane) + layout.ringWidth / 2;
    return { x: layout.cx + r * Math.cos(angle), y: layout.cy + r * Math.sin(angle) };
  };

  const drawLeader = (
    label: PlacedLabel,
    highlighted: boolean,
    /**
     * Where the leader begins, when that is not the labelled feature's own
     * lane: the pointer may be on a feature that shares the label (a CDS and
     * the mat_peptide inside it), and the line has to reach the arc under it
     * rather than stopping at the arc that happens to own the label.
     */
    from?: { x: number; y: number },
  ): void => {
    const isCut = label.id.startsWith(CUT_PREFIX);
    let start: { x: number; y: number };
    if (isCut) {
      const cut = Number(label.id.slice(CUT_PREFIX.length));
      const inner = layout.pointAt(cut, layout.radius - 6);
      start = layout.pointAt(cut, layout.radius + 8);
      ctx.strokeStyle = theme.cutSite;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(inner.x, inner.y);
      ctx.lineTo(start.x, start.y);
      ctx.stroke();
    } else {
      const feature = byId.get(label.id);
      if (feature === undefined) return;
      start = from ?? lanePoint(feature, label.angle);
    }
    const elbow = {
      x: layout.cx + (layout.radius + m.elbow) * Math.cos(label.angle),
      y: layout.cy + (layout.radius + m.elbow) * Math.sin(label.angle),
    };
    ctx.strokeStyle = isCut ? theme.cutSite : highlighted ? theme.ink : theme.leader;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(label.anchorX, label.anchorY);
    ctx.stroke();
  };

  // Leaders first, then every piece of text over them: a label that a
  // neighbour's leader ran through was as hard to read as one a neighbour's
  // name ran through, and the spacing pass cannot help with a line. The
  // hovered label's own leader waits for the end, with its label — drawn
  // here it would be painted over by every muted leader that crosses it,
  // which left a highlight visible only where nothing else ran.
  for (const label of placed) if (label.id !== hoveredLabelId) drawLeader(label, false);

  ticks.forEach((tick, i) => {
    const box = obstacles[i];
    if (box !== undefined) drawPlate(ctx, p, box);
    ctx.fillStyle = theme.inkMuted;
    ctx.textAlign = tick.align;
    ctx.fillText(tick.text, tick.x, tick.y);
  });

  // The hovered label is drawn last, in its outline, so that no neighbour's
  // plate clips it.
  let hovered: PlacedLabel | null = null;
  for (const label of placed) {
    if (label.id === hoveredLabelId) {
      hovered = label;
      continue;
    }
    drawPlate(ctx, p, label.box);
    ctx.fillStyle = label.id.startsWith(CUT_PREFIX) ? theme.cutSite : theme.inkMuted;
    ctx.textAlign = label.align;
    ctx.fillText(label.text, label.x, label.y);
  }
  if (hovered !== null) {
    const color = hovered.id.startsWith(CUT_PREFIX) ? theme.cutSite : theme.ink;
    drawLeader(
      hovered,
      true,
      hoveredFeature === undefined || hoveredAngle === null
        ? undefined
        : lanePoint(hoveredFeature, hoveredAngle),
    );
    drawBubble(ctx, p, hovered.box, color);
    ctx.fillStyle = color;
    ctx.textAlign = hovered.align;
    ctx.fillText(hovered.text, hovered.x, hovered.y);
  }

  // Whatever the pointer is on says its name even when the ring had no room
  // for it, with a leader of its own back to the thing it names.
  if (hovered === null) {
    if (hoveredFeature !== undefined && hoveredFeature.name !== '' && hoveredAngle !== null) {
      const start = lanePoint(hoveredFeature, hoveredAngle);
      drawFloatingLabel(ctx, p, m, hoveredFeature.name, hoveredAngle, theme.ink, start);
    } else if (p.hoveredCut !== null) {
      const names = cutsByPosition.get(p.hoveredCut);
      if (names !== undefined)
        drawFloatingLabel(
          ctx,
          p,
          m,
          `${names.join(', ')} (${(p.hoveredCut + 1).toLocaleString()})`,
          layout.angleOf(p.hoveredCut),
          theme.cutSite,
          layout.pointAt(p.hoveredCut, layout.radius - 6),
        );
    }
  }

  const drawn: DrawnLabel[] = placed.map((label) => ({
    box: label.box,
    target: label.id.startsWith(CUT_PREFIX)
      ? { kind: 'cut', position: Number(label.id.slice(CUT_PREFIX.length)) }
      : { kind: 'feature', featureId: label.id },
  }));
  return { dropped: dropped.length + unfit, drawn };
}

/**
 * How many labels the map left out. Saying nothing would be the old
 * behaviour in a new disguise: a name the reader has no way to know was
 * there. Hovering the feature or the cut site brings its own back.
 */
function drawDroppedCount(
  ctx: DrawingContext,
  p: CircularRenderParams,
  m: MapMetrics,
  dropped: number,
): void {
  if (dropped <= 0) return;
  const text = `+${dropped.toLocaleString()} label${dropped === 1 ? '' : 's'} not shown`;
  ctx.font = p.sansFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const width = ctx.measureText(text).width;
  const y = p.height - m.lineHeight;
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(4, y - m.lineHeight / 2 - 2, width + 8, m.lineHeight + 4);
  ctx.fillStyle = p.theme.inkMuted;
  ctx.fillText(text, 8, y);
}

function drawCentre(ctx: DrawingContext, p: CircularRenderParams): void {
  const { layout, theme, doc } = p;
  if (!layout.isOnCanvas(layout.cx, layout.cy, 40)) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.ink;
  ctx.font = p.titleFont;
  const innerRadius =
    layout.laneCount > 0
      ? layout.laneRadius(layout.laneCount - 1) - layout.ringWidth
      : layout.radius - 20;
  const maxWidth = Math.max(40, innerRadius * 1.8);
  // The room inside the lanes is what it is. A name wider than it is set
  // smaller, down to a floor, and past that it is left out: the toolbar has
  // the name, and "SYN…" says nothing it does not. Never handed to `fillText`
  // as its `maxWidth`, which condenses the glyphs sideways (the SVG export the
  // same, through `lengthAdjust`) — on a narrow map "SYNPBR322 copy" came out
  // as a squeezed script. The length is whole or absent for the same reason,
  // and takes the middle when the name is gone.
  const title = fitTitle(ctx, p.titleFont, doc.name, maxWidth);
  if (title !== null) {
    ctx.font = title;
    ctx.fillText(doc.name, layout.cx, layout.cy - 9);
  }
  ctx.font = p.sansFont;
  ctx.fillStyle = theme.inkMuted;
  const length = `${doc.length.toLocaleString()} bp`;
  const lengthY = title === null ? layout.cy : layout.cy + 9;
  if (ctx.measureText(length).width <= maxWidth) {
    ctx.fillText(length, layout.cx, lengthY);
  }
  // A linear molecule's ends under its length, left end first, in the words
  // the toolbar uses. Whole or not at all, like the title.
  if (doc.topology === 'linear' && doc.ends !== null) {
    const ends = describeEnds(doc.ends);
    if (ctx.measureText(ends).width <= maxWidth) {
      ctx.fillText(ends, layout.cx, lengthY + fontSizeOf(p.sansFont) * 1.4);
    }
  }
}

/** Smallest the centre title is set before it is left out instead. */
const MIN_TITLE_PX = 11;

/** The title font at the largest size down to the floor that the name fits in, or null. */
function fitTitle(
  ctx: DrawingContext,
  font: string,
  text: string,
  maxWidth: number,
): string | null {
  const at = (px: number): string => font.replace(/\d+(?:\.\d+)?px/, `${px}px`);
  for (let px = fontSizeOf(font); px >= MIN_TITLE_PX; px -= 1) {
    ctx.font = at(px);
    if (ctx.measureText(text).width <= maxWidth) return at(px);
  }
  return null;
}

/** A label as drawn, and what it names: a feature, or the cut sites at one position. */
export interface DrawnLabel {
  readonly box: LabelBox;
  readonly target:
    | { readonly kind: 'feature'; readonly featureId: string }
    | { readonly kind: 'cut'; readonly position: number };
}

export interface MapRenderResult {
  /** Labels the ring had no room for; the map draws the count in the corner. */
  readonly droppedLabels: number;
  /** Where each drawn label is, so the view can make it a click target (#25). */
  readonly labels: readonly DrawnLabel[];
}

export function renderCircularMap(ctx: DrawingContext, p: CircularRenderParams): MapRenderResult {
  const { width, height, devicePixelRatio: dpr, doc, lanes } = p;
  const m = mapMetrics(p);
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(0, 0, width, height);

  const tinySelection = drawSelection(ctx, p);
  drawBackbone(ctx, p);
  const ticks = rulerTicks(p, m);
  drawTickMarks(ctx, p, m, ticks);
  const features = drawableFeatures(doc.features.all());
  for (const f of features) {
    const lane = lanes.laneOf.get(f.id);
    if (lane !== undefined) drawFeature(ctx, p, f, lane);
  }
  if (tinySelection) drawSelectionMarker(ctx, p);
  drawEditMarks(ctx, p, m);
  drawOverlays(ctx, p);
  const { dropped: droppedLabels, drawn } = drawLabels(ctx, p, m, features, ticks);
  drawCentre(ctx, p);
  drawDroppedCount(ctx, p, m, droppedLabels);
  ctx.restore();
  return { droppedLabels, labels: drawn };
}

/** Bases covered by a clockwise drag from `anchor` to `focus`. */
export function clockwiseSelection(anchor: number, focus: number, seqLength: number): Range {
  if (focus >= anchor) return { start: anchor, end: focus };
  return { start: anchor, end: focus + seqLength };
}

export function featurePiecesForHit(feature: Feature, seqLength: number): Range[] {
  const out: Range[] = [];
  for (const seg of feature.segments)
    if (seg.kind === 'range') out.push(...rangePieces(seg, seqLength));
  return out;
}
