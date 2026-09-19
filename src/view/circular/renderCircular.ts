import { type CutSite, type Feature, type Range, type SeqDocument, rangePieces } from '@/core';

import { type DrawingContext } from '../drawingContext';
import { contrastingText, featureColor } from '../featureColors';
import { type LaneAssignment } from '../linear/lanes';
import { drawableFeatures, featuresToLabel } from '../visibleFeatures';
import { type CircularLayout, type LabelInput, layoutLabels, tickInterval } from './circularLayout';

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
}

export interface CircularRenderParams {
  readonly doc: SeqDocument;
  readonly layout: CircularLayout;
  readonly lanes: LaneAssignment;
  readonly selection: Range | null;
  readonly cutSites: readonly CutSite[];
  readonly hoveredFeatureId: string | null;
  readonly width: number;
  readonly height: number;
  readonly devicePixelRatio: number;
  readonly theme: CircularTheme;
  readonly sansFont: string;
  readonly titleFont: string;
}

const LABEL_LINE_HEIGHT = 14;

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

  if (doc.length === 0) return;
  // More ticks as the map zooms in, so their spacing on screen stays put.
  const step = tickInterval(doc.length, Math.round(16 * layout.zoom));
  ctx.font = p.sansFont;
  ctx.fillStyle = theme.inkMuted;
  ctx.strokeStyle = theme.tick;
  ctx.lineWidth = 1;
  ctx.textBaseline = 'middle';
  for (let pos = 0; pos < doc.length; pos += step) {
    const a = layout.angleOf(pos);
    const inner = layout.pointAt(pos, layout.radius + 1);
    if (!layout.isOnCanvas(inner.x, inner.y, 80)) continue;
    const outer = layout.pointAt(pos, layout.radius + 7);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
    const label = layout.pointAt(pos, layout.radius + 12);
    const cos = Math.cos(a);
    ctx.textAlign = Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right';
    ctx.fillText(
      pos === 0 ? '1' : pos.toLocaleString(),
      label.x,
      label.y + (Math.sin(a) < -0.9 ? -2 : 0),
    );
  }
}

/** Shortest the selection band may be on screen, in pixels of arc. */
const MIN_SELECTION_PX = 7;

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
  if (selection.start === selection.end) {
    const a = layout.pointAt(selection.start, layout.radius - 8);
    const b = layout.pointAt(selection.start, layout.radius + 8);
    ctx.strokeStyle = theme.caret;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    return false;
  }
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
    let a0 = layout.angleOf(seg.start);
    let a1 = layout.angleOf(seg.end);
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

  if (hovered) {
    ctx.strokeStyle = contrastingText(color);
    ctx.lineWidth = 1.5;
    for (const seg of feature.segments) {
      if (seg.kind !== 'range') continue;
      for (const edge of [r - half + 0.75, r + half - 0.75]) {
        ctx.beginPath();
        ctx.arc(layout.cx, layout.cy, edge, layout.angleOf(seg.start), layout.angleOf(seg.end));
        ctx.stroke();
      }
    }
  }
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

/**
 * Labels for features and for cut sites share one ring so they are spaced
 * against each other. Cut-site labels list the enzymes sharing a position.
 */
function drawLabels(
  ctx: DrawingContext,
  p: CircularRenderParams,
  visible: readonly Feature[],
): void {
  const { layout, theme, doc } = p;
  ctx.font = p.sansFont;
  const labelRadius = layout.radius + 34;
  // Labels anchored well off the canvas are dropped before spacing, so
  // that on a zoomed-in map the visible ones are spaced only against each
  // other and the clamp to the canvas height does not drag in stragglers.
  const nearCanvas = (angle: number, textWidth: number): boolean =>
    layout.isOnCanvas(
      layout.cx + labelRadius * Math.cos(angle),
      layout.cy + labelRadius * Math.sin(angle),
      textWidth + 4 * LABEL_LINE_HEIGHT,
    );
  const inputs: LabelInput[] = [];
  for (const f of featuresToLabel(visible, doc.length)) {
    const angle = featureMidAngle(f, layout, doc.length);
    if (angle === null) continue;
    const textWidth = ctx.measureText(f.name).width;
    if (!nearCanvas(angle, textWidth)) continue;
    inputs.push({ id: f.id, text: f.name, angle, textWidth });
  }
  const cutsByPosition = new Map<number, string[]>();
  for (const s of p.cutSites) {
    const list = cutsByPosition.get(s.cut) ?? [];
    list.push(s.enzyme);
    cutsByPosition.set(s.cut, list);
  }
  for (const [cut, names] of cutsByPosition) {
    const text = `${names.join(', ')} (${(cut + 1).toLocaleString()})`;
    const angle = layout.angleOf(cut);
    const textWidth = ctx.measureText(text).width;
    if (!nearCanvas(angle, textWidth)) continue;
    inputs.push({ id: `${CUT_PREFIX}${cut}`, text, angle, textWidth });
  }

  const placed = layoutLabels(inputs, layout, labelRadius, LABEL_LINE_HEIGHT, p.height);
  const byId = new Map(visible.map((f) => [f.id, f] as const));
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  for (const label of placed) {
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
      ctx.lineWidth = 1;
    } else {
      const feature = byId.get(label.id);
      if (feature === undefined) continue;
      const lane = p.lanes.laneOf.get(feature.id) ?? 0;
      const r = layout.laneRadius(lane) + layout.ringWidth / 2;
      start = {
        x: layout.cx + r * Math.cos(label.angle),
        y: layout.cy + r * Math.sin(label.angle),
      };
    }
    const elbow = {
      x: layout.cx + (layout.radius + 26) * Math.cos(label.angle),
      y: layout.cy + (layout.radius + 26) * Math.sin(label.angle),
    };
    const highlighted = label.id === p.hoveredFeatureId;
    ctx.strokeStyle = isCut ? theme.cutSite : highlighted ? theme.ink : theme.leader;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(elbow.x, elbow.y);
    ctx.lineTo(label.anchorX, label.y);
    ctx.stroke();
    ctx.fillStyle = isCut ? theme.cutSite : highlighted ? theme.ink : theme.inkMuted;
    ctx.textAlign = label.align;
    const maxWidth = label.align === 'left' ? p.width - label.x - 4 : label.x - 4;
    ctx.fillText(label.text, label.x, label.y, Math.max(20, maxWidth));
  }
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
  ctx.fillText(doc.name, layout.cx, layout.cy - 9, maxWidth);
  ctx.font = p.sansFont;
  ctx.fillStyle = theme.inkMuted;
  ctx.fillText(`${doc.length.toLocaleString()} bp`, layout.cx, layout.cy + 9, maxWidth);
}

export function renderCircularMap(ctx: DrawingContext, p: CircularRenderParams): void {
  const { width, height, devicePixelRatio: dpr, doc, lanes } = p;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = p.theme.background;
  ctx.fillRect(0, 0, width, height);

  const tinySelection = drawSelection(ctx, p);
  drawBackbone(ctx, p);
  const features = drawableFeatures(doc.features.all());
  for (const f of features) {
    const lane = lanes.laneOf.get(f.id);
    if (lane !== undefined) drawFeature(ctx, p, f, lane);
  }
  if (tinySelection) drawSelectionMarker(ctx, p);
  drawLabels(ctx, p, features);
  drawCentre(ctx, p);
  ctx.restore();
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
