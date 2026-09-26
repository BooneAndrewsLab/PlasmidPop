import { useEffect, useMemo, useRef } from 'react';

import { type DiffHunk, type DocumentDiff, type SeqDocument } from '@/core';
import {
  LinearLayout,
  assignLanes,
  endOverhangs,
  lanesPerRow,
  linearMetrics,
  linearWidth,
  measureCharWidth,
  monoFontOf,
  renderLinearView,
  sansFontOf,
} from '@/view/linear';
import { NO_OVERLAY } from '@/view/overlay';
import { drawableFeatures } from '@/view/visibleFeatures';

import { readLinearTheme } from './linearTheme';

/** Row width of the review, wide enough to read a change in context. */
const BASES_PER_ROW = 60;
const FONT_SIZE = 12;

interface Props {
  /** The edited document; the hunk's coordinates are its own. */
  readonly doc: SeqDocument;
  /** Changes against the file the document came from, drawn as marks. */
  readonly diff: DocumentDiff;
  readonly hunk: DiffHunk;
}

/**
 * One neighbourhood of changes, drawn with the same renderer and the same
 * marks as the sequence view: a few rows of the edited document with the
 * inserted, changed and deleted bases called out.
 *
 * It is the sequence view rendered at a fixed row width and scrolled to the
 * hunk, rather than a second drawing routine, so what the review shows and
 * what the editor shows cannot drift apart.
 */
export function DiffStrip({ doc, diff, hunk }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawing = useMemo(() => {
    const monoFont = monoFontOf(FONT_SIZE);
    const charWidth = measureCharWidth(monoFont);
    // A sticky end's bottom strand is drawn beside the first or last column,
    // so the gutter there has to hold it, as in the sequence view.
    const overhangs = endOverhangs(doc);
    const metrics = linearMetrics({
      fontSize: FONT_SIZE,
      basesPerRow: BASES_PER_ROW,
      charWidth,
      showComplement: true,
      cutSiteLabels: false,
      extraLeftGutter: overhangs.leftBottom * charWidth,
      extraRightGutter: overhangs.rightBottom * charWidth,
    });
    const features = drawableFeatures(doc.features.all());
    const lanes = assignLanes(features, doc.length);
    // Translations are off in the review: it is about the bases that changed.
    const noLanes = assignLanes([], doc.length);
    const layout = new LinearLayout(
      doc.length,
      metrics,
      lanesPerRow(features, lanes, doc.length, metrics.basesPerRow),
      lanesPerRow([], noLanes, doc.length, metrics.basesPerRow),
    );
    // Every row the hunk touches, including the one holding a change that
    // ends exactly on a boundary.
    const rows = layout.rows.filter((r) => r.end > hunk.start && r.start < Math.max(hunk.end, 1));
    const first = rows[0] ?? layout.rows[0];
    const last = rows[rows.length - 1] ?? first;
    return {
      layout,
      lanes,
      noLanes,
      monoFont,
      sansFont: sansFontOf(FONT_SIZE),
      width: linearWidth(metrics),
      height: first === undefined || last === undefined ? 0 : last.top + last.height - first.top,
      scrollTop: first?.top ?? 0,
    };
  }, [doc, hunk]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || drawing.height === 0) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(drawing.width * dpr);
    canvas.height = Math.round(drawing.height * dpr);
    renderLinearView(ctx, {
      doc,
      layout: drawing.layout,
      lanes: drawing.lanes,
      translations: null,
      translationLanes: drawing.noLanes,
      selection: null,
      cutSites: [],
      // The review shows what changed, not what a panel is pointing at.
      overlay: NO_OVERLAY,
      overlayLanes: drawing.noLanes,
      edits: diff,
      colorBases: false,
      numberComplement: false,
      residueNumbering: 'off',
      scrollTop: drawing.scrollTop,
      scrollLeft: 0,
      width: drawing.width,
      height: drawing.height,
      devicePixelRatio: dpr,
      theme: readLinearTheme(canvas),
      monoFont: drawing.monoFont,
      sansFont: drawing.sansFont,
    });
  }, [doc, diff, drawing]);

  return (
    <canvas
      ref={canvasRef}
      className="diff-strip__canvas"
      style={{ width: drawing.width, height: drawing.height }}
      aria-hidden="true"
    />
  );
}
