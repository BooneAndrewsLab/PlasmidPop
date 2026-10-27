import { type Range, type SeqDocument, featureExtent, rangePieces } from '@/core';

import { type DrawingContext } from '../drawingContext';
import { featureColor } from '../featureColors';
import { type LaneAssignment } from '../linear/lanes';
import { type OverlaySpan, overlayPieces } from '../overlay';
import { drawableFeatures } from '../visibleFeatures';

/**
 * The map strip (item 107, point 5): the whole document unrolled into one
 * ribbon a few tens of pixels high, for the layouts that have no room for
 * the map beside the primer workspace — a window of 601 to 1000 px and the
 * phone. It answers one question, "where does this land": the features in
 * their lanes, the selection as a band, and the preview — the search
 * windows, a pair and its product, the binding sites — in the preview
 * colour the map uses. No labels, no bases: those are the map's and the
 * sequence view's, a tap away.
 *
 * A circular document is drawn open at its origin, so a stretch that runs
 * over it is drawn as two pieces, one at each end, as the sequence view
 * draws it.
 */

export interface RibbonTheme {
  readonly background: string;
  /** The backbone and the ruler's ticks. */
  readonly rulerLine: string;
  readonly gutterText: string;
  readonly selectionFill: string;
  readonly preview: string;
  /** A previewed primer's mismatches. */
  readonly editChange: string;
}

export interface RibbonParams {
  readonly doc: SeqDocument;
  readonly width: number;
  readonly height: number;
  readonly theme: RibbonTheme;
  readonly selection: Range | null;
  readonly overlay: readonly OverlaySpan[];
  readonly featureLanes: LaneAssignment;
  readonly overlayLanes: LaneAssignment;
  readonly font: string;
}

/** Room at either end, so the first and last base are not on the edge. */
const PAD = 8;
/** The ruler's text and tick under the backbone. */
const RULER = 13;
const FEATURE_LANE = 7;
const OVERLAY_LANE = 6;
const LANE_GAP = 2;
/** Shortest anything is drawn, so a 20-mer on a 10 kb document can still be seen. */
const MIN_PX = 3;

/** Where the ribbon's parts sit, top down: feature lanes, overlay lanes, the backbone, the ruler. */
export function ribbonRows(
  height: number,
  featureLaneCount: number,
  overlayLaneCount: number,
): {
  readonly backbone: number;
  readonly overlayTop: (lane: number) => number;
  readonly featureTop: (lane: number) => number;
  /** How many feature lanes fit; the rest share the top one. */
  readonly featureLanesShown: number;
} {
  const backbone = height - RULER;
  const overlayBand = overlayLaneCount * (OVERLAY_LANE + LANE_GAP);
  const overlayTop = (lane: number): number =>
    backbone - 3 - (lane + 1) * (OVERLAY_LANE + LANE_GAP) + LANE_GAP;
  const roomAbove = backbone - 4 - overlayBand;
  const featureLanesShown = Math.max(
    1,
    Math.min(featureLaneCount, Math.floor(roomAbove / (FEATURE_LANE + LANE_GAP))),
  );
  const featureTop = (lane: number): number =>
    backbone -
    4 -
    overlayBand -
    (Math.min(lane, featureLanesShown - 1) + 1) * (FEATURE_LANE + LANE_GAP) +
    LANE_GAP;
  return { backbone, overlayTop, featureTop, featureLanesShown };
}

function xOf(position: number, seqLength: number, width: number): number {
  return PAD + (position / Math.max(1, seqLength)) * (width - 2 * PAD);
}

/** A block with an arrowhead at the end it reads towards, when there is room for one. */
function block(
  ctx: DrawingContext,
  x0: number,
  x1: number,
  top: number,
  h: number,
  strand: 'forward' | 'reverse' | 'none',
  head: boolean,
): void {
  const w = Math.max(MIN_PX, x1 - x0);
  const right = x0 + w;
  const arrow = head && w > h * 1.5 ? h * 0.7 : 0;
  ctx.beginPath();
  if (strand === 'forward' && arrow > 0) {
    ctx.moveTo(x0, top);
    ctx.lineTo(right - arrow, top);
    ctx.lineTo(right, top + h / 2);
    ctx.lineTo(right - arrow, top + h);
    ctx.lineTo(x0, top + h);
  } else if (strand === 'reverse' && arrow > 0) {
    ctx.moveTo(right, top);
    ctx.lineTo(x0 + arrow, top);
    ctx.lineTo(x0, top + h / 2);
    ctx.lineTo(x0 + arrow, top + h);
    ctx.lineTo(right, top + h);
  } else {
    ctx.moveTo(x0, top);
    ctx.lineTo(right, top);
    ctx.lineTo(right, top + h);
    ctx.lineTo(x0, top + h);
  }
  ctx.closePath();
  ctx.fill();
}

export function renderRibbon(ctx: DrawingContext, p: RibbonParams): void {
  const { doc, width, height, theme, selection, overlay, featureLanes, overlayLanes } = p;
  const L = doc.length;
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, width, height);
  if (L === 0 || width <= 2 * PAD) return;
  const rows = ribbonRows(height, featureLanes.laneCount, overlayLanes.laneCount);
  const x = (position: number): number => xOf(position, L, width);

  // The selection first, a band behind everything.
  if (selection !== null && selection.end > selection.start) {
    ctx.fillStyle = theme.selectionFill;
    for (const piece of rangePieces(selection, L)) {
      const x0 = x(piece.start);
      ctx.fillRect(x0, 2, Math.max(MIN_PX, x(piece.end) - x0), rows.backbone - 2);
    }
  }

  // The backbone and a ruler of its two ends.
  ctx.strokeStyle = theme.rulerLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(PAD, rows.backbone + 0.5);
  ctx.lineTo(width - PAD, rows.backbone + 0.5);
  ctx.stroke();
  ctx.fillStyle = theme.gutterText;
  ctx.font = p.font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('1', PAD, rows.backbone + 3);
  ctx.textAlign = 'right';
  ctx.fillText(L.toLocaleString(), width - PAD, rows.backbone + 3);

  // The features, in the lanes the sequence view would give them.
  for (const f of drawableFeatures(doc.features.all())) {
    const extent = featureExtent(f);
    if (extent === null) continue;
    const lane = featureLanes.laneOf.get(f.id) ?? 0;
    const top = rows.featureTop(lane);
    ctx.fillStyle = featureColor(f);
    const pieces = rangePieces(extent, L);
    pieces.forEach((piece, i) => {
      const headHere = f.strand === 'forward' ? i === pieces.length - 1 : i === 0;
      block(ctx, x(piece.start), x(piece.end), top, FEATURE_LANE, f.strand, headHere);
    });
  }

  // The preview, nearest the backbone, in the one colour that belongs to nothing in the document.
  for (const span of overlay) {
    const lane = overlayLanes.laneOf.get(span.id) ?? 0;
    const top = rows.overlayTop(lane);
    const pieces = overlayPieces(span, L);
    if (span.shape === 'span') {
      // A bracket: a dashed line with a tick at each end.
      ctx.strokeStyle = theme.preview;
      ctx.lineWidth = 1.5;
      const mid = top + OVERLAY_LANE / 2;
      pieces.forEach((piece, i) => {
        const x0 = x(piece.start);
        const x1 = Math.max(x0 + MIN_PX, x(piece.end));
        ctx.setLineDash([3, 2]);
        ctx.beginPath();
        ctx.moveTo(x0, mid);
        ctx.lineTo(x1, mid);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [tick, draw] of [
          [x0, i === 0],
          [x1, i === pieces.length - 1],
        ] as const) {
          if (!draw) continue;
          ctx.beginPath();
          ctx.moveTo(tick, top);
          ctx.lineTo(tick, top + OVERLAY_LANE);
          ctx.stroke();
        }
      });
      continue;
    }
    ctx.fillStyle = theme.preview;
    pieces.forEach((piece, i) => {
      const headHere =
        span.strand === 'forward'
          ? i === pieces.length - 1
          : span.strand === 'reverse'
            ? i === 0
            : false;
      block(ctx, x(piece.start), x(piece.end), top, OVERLAY_LANE, span.strand, headHere);
    });
    // A primer's mismatches, a tick across it each (#32).
    ctx.strokeStyle = theme.editChange;
    ctx.lineWidth = 1.5;
    for (const mark of span.marks ?? []) {
      const at = x((((mark % L) + L) % L) + 0.5);
      ctx.beginPath();
      ctx.moveTo(at, top - 1);
      ctx.lineTo(at, top + OVERLAY_LANE + 1);
      ctx.stroke();
    }
  }
}
