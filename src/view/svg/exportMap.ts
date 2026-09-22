import { type SeqDocument, type CutSite } from '@/core';

import { type CircularTheme, CircularLayout, renderCircularMap } from '../circular';
import { NO_LANES, assignLanes } from '../linear';
import { NO_OVERLAY } from '../overlay';
import { drawableFeatures } from '../visibleFeatures';
import { SvgContext } from './svgContext';

/** Colours for print: white background, dark ink, whatever the screen theme is. */
export const PRINT_THEME: CircularTheme = {
  ink: '#1c2430',
  inkMuted: '#5b6675',
  backbone: '#3a4452',
  tick: '#9aa5b1',
  selectionFill: 'rgba(0,0,0,0)',
  caret: 'rgba(0,0,0,0)',
  background: '#ffffff',
  leader: '#b8c0ca',
  cutSite: '#b3261e',
  preview: '#6b4fd8',
};

export interface MapExportOptions {
  readonly size?: number; // default 900
  readonly cutSites?: readonly CutSite[];
  readonly transparent?: boolean;
}

/**
 * How much room the export may add around the map so that every label fits.
 * The canvas grows while the circle stays exactly where it was, which is
 * what an SVG can do and a fixed screen pane cannot: on paper a name that
 * did not fit is lost for good, so the export buys room rather than
 * dropping labels the way the map on screen does.
 */
const PAD_STEPS = [0, 48, 120, 260];

/** The plasmid map as a standalone SVG document. */
export function exportMapSvg(doc: SeqDocument, options: MapExportOptions = {}): string {
  const size = options.size ?? 900;
  const features = drawableFeatures(doc.features.all());
  const lanes = assignLanes(features, doc.length);
  const ringWidth = Math.max(12, size / 60);

  const render = (pad: number): { svg: string; dropped: number } => {
    const canvas = size + 2 * pad;
    const layout = new CircularLayout(doc.length, doc.topology, {
      width: canvas,
      height: canvas,
      laneCount: lanes.laneCount,
      ringWidth,
      // The margin grows with the canvas, so the circle keeps the radius it
      // would have had and only the room around it changes.
      outerMargin: size / 6 + pad,
    });
    const ctx = new SvgContext(canvas, canvas);
    const { droppedLabels } = renderCircularMap(ctx, {
      doc,
      layout,
      lanes,
      selection: null,
      cutSites: options.cutSites ?? [],
      // As in the sequence-view export: a preview is not part of the document.
      overlay: NO_OVERLAY,
      overlayLanes: NO_LANES,
      hoveredFeatureId: null,
      hoveredCut: null,
      width: canvas,
      height: canvas,
      devicePixelRatio: 1,
      theme:
        options.transparent === true
          ? { ...PRINT_THEME, background: 'rgba(0,0,0,0)' }
          : PRINT_THEME,
      // A figure has no pointer, so a label the ring has no room for beside
      // its own feature is lost rather than one hover away: the export buys
      // the long leader the screen refuses (item 31).
      labelShiftLines: 16,
      sansFont: `${Math.max(11, size / 70)}px Helvetica, Arial, sans-serif`,
      titleFont: `600 ${Math.max(14, size / 50)}px Helvetica, Arial, sans-serif`,
    });
    return {
      svg: ctx.toSvg({
        title: `${doc.name} map`,
        description: `${doc.length.toLocaleString()} bp ${doc.topology} sequence with ${features.length} features. Exported from PlasmidPop.`,
      }),
      dropped: droppedLabels,
    };
  };

  let best: { svg: string; dropped: number } | null = null;
  for (const pad of PAD_STEPS) {
    const attempt = render(pad);
    if (attempt.dropped === 0) return attempt.svg;
    if (best === null || attempt.dropped < best.dropped) best = attempt;
  }
  return (best ?? render(0)).svg;
}
