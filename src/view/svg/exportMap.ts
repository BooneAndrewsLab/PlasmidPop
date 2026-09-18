import { type SeqDocument, type CutSite } from '@/core';

import { type CircularTheme, CircularLayout, renderCircularMap } from '../circular';
import { assignLanes } from '../linear';
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
};

export interface MapExportOptions {
  readonly size?: number; // default 900
  readonly cutSites?: readonly CutSite[];
  readonly transparent?: boolean;
}

/** The plasmid map as a standalone SVG document. */
export function exportMapSvg(doc: SeqDocument, options: MapExportOptions = {}): string {
  const size = options.size ?? 900;
  const features = drawableFeatures(doc.features.all());
  const lanes = assignLanes(features, doc.length);
  const layout = new CircularLayout(doc.length, doc.topology, {
    width: size,
    height: size,
    laneCount: lanes.laneCount,
    ringWidth: Math.max(12, size / 60),
    outerMargin: size / 6,
  });
  const ctx = new SvgContext(size, size);
  renderCircularMap(ctx, {
    doc,
    layout,
    lanes,
    selection: null,
    cutSites: options.cutSites ?? [],
    hoveredFeatureId: null,
    width: size,
    height: size,
    devicePixelRatio: 1,
    theme:
      options.transparent === true ? { ...PRINT_THEME, background: 'rgba(0,0,0,0)' } : PRINT_THEME,
    sansFont: `${Math.max(11, size / 70)}px Helvetica, Arial, sans-serif`,
    titleFont: `600 ${Math.max(14, size / 50)}px Helvetica, Arial, sans-serif`,
  });
  return ctx.toSvg({
    title: `${doc.name} map`,
    description: `${doc.length.toLocaleString()} bp ${doc.topology} sequence with ${features.length} features. Exported from PlasmidPop.`,
  });
}
