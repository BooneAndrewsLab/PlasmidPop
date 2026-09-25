import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { type CutSite, type DocumentDiff, type SeqDocument } from '@/core';
import {
  type ChangeTarget,
  CircularLayout,
  changeAt,
  ghostFeatures,
  lanesWithGhosts,
  renderCircularMap,
  sameChange,
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
}

const NO_CUTS: readonly CutSite[] = [];

/**
 * The whole molecule with its changes marked, above the rows of bases. A
 * plasmid is read as a ring, so where a change landed — in the marker, in
 * the origin, in nothing at all — is the first thing to say about it, and a
 * column of sequence hunks says it last.
 *
 * It is the circular map with the same renderer, marks and colours as the
 * editor's own, at a fixed size and fitted to the whole circle, rather than
 * a second drawing routine.
 */
export function DiffMap({
  doc,
  diff = null,
  cutSites = NO_CUTS,
  size = SIZE,
  label,
  onPick,
  pointed = null,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<ChangeTarget | null>(null);

  const drawing = useMemo(() => {
    const features = drawableFeatures(doc.features.all());
    const lanes = lanesWithGhosts(
      features,
      assignLanes(features, doc.length),
      ghostFeatures(diff),
      doc.length,
    );
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: size,
      height: size,
      laneCount: lanes.laneCount,
      ringWidth: RING_WIDTH,
      outerMargin: OUTER_MARGIN,
    });
    return { lanes, layout };
  }, [doc, diff, size]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    renderCircularMap(ctx, {
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
      hoveredFeatureId: null,
      hoveredCut: null,
      hoveredChange: hovered ?? pointed,
      width: size,
      height: size,
      devicePixelRatio: dpr,
      theme: readCircularTheme(canvas),
      sansFont: SANS_FONT,
      titleFont: TITLE_FONT,
    });
  }, [doc, diff, cutSites, drawing, size, hovered, pointed]);

  const targetAt = (e: ReactPointerEvent<HTMLCanvasElement>): ChangeTarget | null => {
    const rect = e.currentTarget.getBoundingClientRect();
    return changeAt(
      { layout: drawing.layout, lanes: drawing.lanes, edits: diff, sansFont: SANS_FONT },
      e.clientX - rect.left,
      e.clientY - rect.top,
    );
  };

  const pointer =
    onPick === undefined
      ? {}
      : {
          onPointerMove: (e: ReactPointerEvent<HTMLCanvasElement>) => {
            const next = targetAt(e);
            setHovered((prev) => (sameChange(prev, next) ? prev : next));
          },
          onPointerLeave: () => {
            setHovered(null);
          },
          onPointerDown: (e: ReactPointerEvent<HTMLCanvasElement>) => {
            if (e.button !== 0) return;
            const target = targetAt(e);
            if (target !== null) onPick(target);
          },
        };

  return (
    <canvas
      ref={canvasRef}
      className="diff-map__canvas"
      style={{ width: size, height: size, cursor: hovered === null ? 'default' : 'pointer' }}
      {...pointer}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
}
