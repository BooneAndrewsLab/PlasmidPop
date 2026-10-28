import { type CutSite, type DocumentDiff, type SeqDocument } from '@/core';

import {
  type CircularTheme,
  CircularLayout,
  ghostFeatures,
  lanesWithGhosts,
  renderCircularMap,
} from '../circular';
import { type GcTrack, NO_LANES, assignLanes } from '../linear';
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
  editInsert: '#1d7a4c',
  editChange: '#a86200',
  editDelete: '#b3261e',
  gc: '#2a8f7a',
};

export interface MapExportOptions {
  readonly size?: number; // default 900
  readonly cutSites?: readonly CutSite[];
  readonly transparent?: boolean;
  /** Tracked changes to mark on the ring, as the sequence-view export takes. */
  readonly edits?: DocumentDiff | null;
  /** The GC ring inside the lanes (item 75); none when omitted. */
  readonly gc?: GcTrack | null;
  /** Only features of these types are drawn; every type when null or omitted (item 89). */
  readonly featureTypes?: ReadonlySet<string> | null;
  /** Whether the name and length are written in the middle; true when omitted. */
  readonly showCentre?: boolean;
  /** Multiplies the label and title text size; 1 when omitted. */
  readonly fontScale?: number;
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
  const types = options.featureTypes ?? null;
  const features = drawableFeatures(doc.features.all()).filter(
    (f) => types === null || types.has(f.type),
  );
  const fontScale = options.fontScale ?? 1;
  const edits = options.edits ?? null;
  // Removed features are drawn as ghosts in the lanes, after the live ones (#27).
  const lanes = lanesWithGhosts(
    features,
    assignLanes(features, doc.length),
    ghostFeatures(edits).filter((g) => types === null || types.has(g.type)),
    doc.length,
  );
  const ringWidth = Math.max(12, size / 60);

  // Every lane needs its own ring, so a map with hundreds of lanes has a
  // circle bigger than `size`. The layout then centres it on a canvas it
  // overflows and every label anchors off the page, which is not counted as
  // dropped: the export came out blank and said nothing (#158). Buy the room
  // for the whole circle first; the steps below add the room for the labels.
  const basePad = Math.max(0, 40 + lanes.laneCount * ringWidth - size / 3);

  const render = (step: number): { svg: string; dropped: number } => {
    const pad = basePad + step;
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
      edits,
      gc: options.gc ?? null,
      showCentre: options.showCentre !== false,
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
      sansFont: `${String(Math.max(11, size / 70) * fontScale)}px Helvetica, Arial, sans-serif`,
      titleFont: `600 ${String(Math.max(14, size / 50) * fontScale)}px Helvetica, Arial, sans-serif`,
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
