import {
  type CutSite,
  type Range,
  type SeqDocument,
  CdsTranslations,
  isCodingFeature,
  rangeWraps,
} from '@/core';

import {
  type LinearMetrics,
  type LinearTheme,
  LinearLayout,
  assignLanes,
  lanesPerRow,
  renderLinearView,
} from '../linear';
import { drawableFeatures } from '../visibleFeatures';
import { SvgContext } from './svgContext';

/** Colours for print: white paper, dark ink, no caret. */
export const PRINT_LINEAR_THEME: LinearTheme = {
  ink: '#1c2430',
  inkMuted: '#5b6675',
  gutterText: '#5b6675',
  rulerLine: '#9aa5b1',
  selectionFill: 'rgba(27, 110, 140, 0.18)',
  caret: 'rgba(0,0,0,0)',
  background: '#ffffff',
  cutSite: '#b3261e',
};

/** Fonts with an advance width the SVG estimator can predict (Courier is exactly 0.6 em). */
const MONO_FONT = '13px "Courier New", Courier, monospace';
const SANS_FONT = '11px Helvetica, Arial, sans-serif';
const LEFT_GUTTER = 72;
const RIGHT_PADDING = 24;
const DEFAULT_BASES_PER_ROW = 60;
/** One row per 60 bases makes a tall page; refuse to write an unusable file. */
const MAX_EXPORT_BASES = 100_000;

export interface LinearExportOptions {
  /**
   * Export only the rows that hold this range, numbered as in the document.
   * The whole sequence when absent, or when the range wraps the origin (the
   * rows are not contiguous then).
   */
  readonly range?: Range | null;
  /** Bases per row; the page width follows from it. Default 60. */
  readonly basesPerRow?: number;
  /** Highlight this range, as the selection is highlighted on screen. */
  readonly selection?: Range | null;
  readonly showComplement?: boolean;
  readonly showTranslations?: boolean;
  readonly cutSites?: readonly CutSite[];
  readonly transparent?: boolean;
}

/** Advance width of one character of `font`, as SvgContext will estimate it. */
function charWidthFor(font: string): number {
  const probe = new SvgContext(0, 0);
  probe.font = font;
  return probe.measureText('ACGTACGTAC').width / 10;
}

/**
 * The linear sequence view as a standalone SVG document: ruler, strands,
 * translations, cut sites and feature lanes, laid out exactly as on screen
 * but at a fixed row width so the file is reproducible.
 */
export function exportLinearSvg(doc: SeqDocument, options: LinearExportOptions = {}): string {
  const basesPerRow = Math.max(10, Math.round(options.basesPerRow ?? DEFAULT_BASES_PER_ROW));
  const cutSites = options.cutSites ?? [];
  const charWidth = charWidthFor(MONO_FONT);
  const metrics: LinearMetrics = {
    basesPerRow,
    charWidth,
    lineHeight: 18,
    showComplement: options.showComplement ?? true,
    // Room for the enzyme names above the strands, as in the on-screen view.
    rulerHeight: cutSites.length > 0 ? 30 : 16,
    laneHeight: 20,
    translationHeight: 16,
    rowGap: 14,
    leftGutter: LEFT_GUTTER,
    topPadding: 12,
  };

  const features = drawableFeatures(doc.features.all());
  const lanes = assignLanes(features, doc.length);
  const coding = options.showTranslations === true ? features.filter(isCodingFeature) : [];
  const translationLanes = assignLanes(coding, doc.length);
  const layout = new LinearLayout(
    doc.length,
    metrics,
    lanesPerRow(features, lanes, doc.length, basesPerRow),
    lanesPerRow(coding, translationLanes, doc.length, basesPerRow),
  );

  const range =
    options.range === undefined || options.range === null || rangeWraps(options.range, doc.length)
      ? null
      : options.range;
  const first =
    (range === null ? layout.rows[0] : layout.rowOfPosition(range.start)) ?? layout.rows[0];
  const last =
    (range === null
      ? layout.rows[layout.rows.length - 1]
      : layout.rowOfPosition(Math.max(range.start, range.end - 1))) ??
    layout.rows[layout.rows.length - 1];
  if (first === undefined || last === undefined) throw new Error('There is nothing to export.');
  if (last.end - first.start > MAX_EXPORT_BASES)
    throw new Error(
      `The sequence view export is limited to ${MAX_EXPORT_BASES.toLocaleString()} bases; select a shorter range.`,
    );

  // Start the page at the first exported row (row 0 keeps the layout's top
  // padding); a row's height already carries the gap below it.
  const top = first.index === 0 ? 0 : first.top;
  const height = last.top + last.height - top;
  const width = metrics.leftGutter + basesPerRow * charWidth + RIGHT_PADDING;

  const ctx = new SvgContext(width, height);
  renderLinearView(ctx, {
    doc,
    layout,
    lanes,
    translations: options.showTranslations === true ? new CdsTranslations(doc) : null,
    translationLanes,
    selection: options.selection ?? null,
    cutSites,
    scrollTop: top,
    width,
    height,
    devicePixelRatio: 1,
    theme:
      options.transparent === true
        ? { ...PRINT_LINEAR_THEME, background: 'rgba(0,0,0,0)' }
        : PRINT_LINEAR_THEME,
    monoFont: MONO_FONT,
    sansFont: SANS_FONT,
  });
  const shown =
    range === null
      ? `${doc.length.toLocaleString()} bp`
      : `bases ${(first.start + 1).toLocaleString()}–${last.end.toLocaleString()} of ${doc.length.toLocaleString()} bp`;
  return ctx.toSvg({
    title: `${doc.name} sequence`,
    description: `${shown}, ${doc.topology}. Exported from PlasmidPop.`,
  });
}
