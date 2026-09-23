import {
  type CutSite,
  type DocumentDiff,
  type Range,
  type SeqDocument,
  CdsTranslations,
  isCodingFeature,
  rangeWraps,
} from '@/core';

import {
  type LinearTheme,
  DEFAULT_FONT_SIZE,
  LinearLayout,
  NO_LANES,
  assignLanes,
  endOverhangs,
  lanesPerRow,
  linearMetrics,
  linearWidth,
  renderLinearView,
} from '../linear';
import { NO_OVERLAY } from '../overlay';
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
  editInsert: '#1d7a4c',
  editChange: '#a86200',
  editDelete: '#b3261e',
  preview: '#6b4fd8',
  traceQuality: 'rgba(27, 110, 140, 0.12)',
  baseColors: {
    a: '#2f7d32',
    c: '#1b6ec8',
    g: '#8a5a00',
    t: '#c0392b',
    other: '#6b7280',
  },
};

/** Fonts with an advance width the SVG estimator can predict (Courier is exactly 0.6 em). */
const monoFontOf = (size: number): string => `${size}px "Courier New", Courier, monospace`;
const sansFontOf = (size: number): string => `${size - 2}px Helvetica, Arial, sans-serif`;
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
  /** Size of the strand text; the rest of the row scales with it. Default 13. */
  readonly fontSize?: number;
  /** Tint the bases by what they are, as the view can on screen. */
  readonly colorBases?: boolean;
  /** Repeat each row's position number beside the complement. */
  readonly numberComplement?: boolean;
  /** Highlight this range, as the selection is highlighted on screen. */
  readonly selection?: Range | null;
  readonly showComplement?: boolean;
  readonly showTranslations?: boolean;
  readonly cutSites?: readonly CutSite[];
  /** Changes to mark, as the sequence view marks them on screen. */
  readonly edits?: DocumentDiff | null;
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
  const fontSize = options.fontSize ?? DEFAULT_FONT_SIZE;
  const cutSites = options.cutSites ?? [];
  const monoFont = monoFontOf(fontSize);
  const charWidth = charWidthFor(monoFont);
  const overhangs = endOverhangs(doc);
  const metrics = linearMetrics({
    fontSize,
    basesPerRow,
    charWidth,
    showComplement: options.showComplement ?? true,
    // Room for the enzyme names above the strands, as in the on-screen view.
    cutSiteLabels: cutSites.length > 0,
    // A read's chromatogram is exported with it, as it is shown.
    trace: doc.read?.trace != null,
    // ...and for a sticky end drawn beside the first or last column.
    extraLeftGutter: overhangs.leftBottom * charWidth,
    extraRightGutter: overhangs.rightBottom * charWidth,
  });

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
  const width = linearWidth(metrics);

  const ctx = new SvgContext(width, height);
  renderLinearView(ctx, {
    doc,
    layout,
    lanes,
    translations: options.showTranslations === true ? new CdsTranslations(doc) : null,
    translationLanes,
    selection: options.selection ?? null,
    cutSites,
    // A preview is something the user is weighing up, not part of the
    // document; an exported figure shows the document.
    overlay: NO_OVERLAY,
    overlayLanes: NO_LANES,
    edits: options.edits ?? null,
    colorBases: options.colorBases ?? false,
    numberComplement: options.numberComplement ?? false,
    scrollTop: top,
    scrollLeft: 0,
    width,
    height,
    devicePixelRatio: 1,
    theme:
      options.transparent === true
        ? { ...PRINT_LINEAR_THEME, background: 'rgba(0,0,0,0)' }
        : PRINT_LINEAR_THEME,
    monoFont,
    sansFont: sansFontOf(fontSize),
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
