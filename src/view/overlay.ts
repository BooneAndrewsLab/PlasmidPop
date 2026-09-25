import { type Range, type Strand, rangePieces } from '@/core';

import { type LaneAssignment, type LaneItem, itemLanesPerRow, packLanes } from './linear/lanes';
import { type RowBreaks } from './linear/rowBreaks';

/**
 * A transient span drawn beside the document's own annotation: a primer pair
 * being weighed up, the product it would give, every match of a find. None
 * of it is in the document and none of it survives an edit — it is what the
 * user is *thinking about*, drawn in the views so they can see where it sits
 * without annotating the molecule to find out.
 *
 * The channel is deliberately not primer-shaped: both renderers take a plain
 * list of spans, so the next panel that wants to point at a stretch of
 * sequence needs no rendering work of its own.
 */
export interface OverlaySpan {
  /** Stable within one preview; used for lane assignment only. */
  readonly id: string;
  /** Shown on or above the span where there is room for it. */
  readonly label: string;
  /** Forward-strand coordinates, unrolled past the end when it wraps the origin. */
  readonly range: Range;
  /** Which way the arrowhead points; 'none' draws none. */
  readonly strand: Strand | 'none';
  /**
   * `arrow` is the thing itself (a primer, a match); `span` is the stretch
   * between things (an amplicon), drawn as a thin bracket so it cannot be
   * mistaken for an annotation.
   */
  readonly shape: 'arrow' | 'span';
  /**
   * Whether clicking it does something. The panel that drew the span decides
   * what (`editorStore.activatePreview`), and a span without this stays
   * inert, so a find match or a primer site keeps whatever the view does
   * where it is drawn.
   */
  readonly clickable?: boolean;
  /**
   * Bases to mark inside it, forward coordinates like `range`: where a
   * previewed primer does not pair with the template (#32), which is the
   * thing a scientist squints at. Drawn in the colour of a changed base.
   */
  readonly marks?: readonly number[];
}

/** The clickable span at `position`, in `lane` where the caller knows one. */
export function overlayAt(
  spans: readonly OverlaySpan[],
  seqLength: number,
  position: number,
  lanes?: LaneAssignment,
  lane?: number,
): OverlaySpan | undefined {
  return spans.find(
    (span) =>
      span.clickable === true &&
      (lanes === undefined || lane === undefined || lanes.laneOf.get(span.id) === lane) &&
      overlayPieces(span, seqLength).some((p) => position >= p.start && position < p.end),
  );
}

/** Stable empty preview, so a view that has none re-renders no more than it must. */
export const NO_OVERLAY: readonly OverlaySpan[] = [];

/** The pieces a span covers, split where it wraps the origin. */
export function overlayPieces(span: OverlaySpan, seqLength: number): Range[] {
  return rangePieces(span.range, seqLength).filter((p) => p.end > p.start);
}

function overlayItems(spans: readonly OverlaySpan[], seqLength: number): LaneItem[] {
  return spans.map((span) => ({ id: span.id, pieces: overlayPieces(span, seqLength) }));
}

/** Lanes for the preview, stacked the same way the feature lanes are. */
export function overlayLanes(spans: readonly OverlaySpan[], seqLength: number): LaneAssignment {
  return packLanes(overlayItems(spans, seqLength));
}

/** Preview lanes needed by each row of the linear view. */
export function overlaysPerRow(
  spans: readonly OverlaySpan[],
  lanes: LaneAssignment,
  seqLength: number,
  rows: number | RowBreaks,
): number[] {
  return itemLanesPerRow(overlayItems(spans, seqLength), lanes, seqLength, rows);
}
