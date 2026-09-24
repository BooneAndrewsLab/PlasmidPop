import { useEffect, useMemo, useRef } from 'react';

import { type CutSite, type DocumentDiff, type SeqDocument } from '@/core';
import { CircularLayout, renderCircularMap } from '@/view/circular';
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
export function DiffMap({ doc, diff = null, cutSites = NO_CUTS, size = SIZE, label }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawing = useMemo(() => {
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: size,
      height: size,
      laneCount: lanes.laneCount,
      ringWidth: RING_WIDTH,
      outerMargin: OUTER_MARGIN,
    });
    return { lanes, layout };
  }, [doc, size]);

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
      width: size,
      height: size,
      devicePixelRatio: dpr,
      theme: readCircularTheme(canvas),
      sansFont: SANS_FONT,
      titleFont: TITLE_FONT,
    });
  }, [doc, diff, cutSites, drawing, size]);

  return (
    <canvas
      ref={canvasRef}
      className="diff-map__canvas"
      style={{ width: size, height: size }}
      {...(label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label })}
    />
  );
}
