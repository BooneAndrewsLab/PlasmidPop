import {
  type CutSite,
  type DocumentDiff,
  type Range,
  type SeqDocument,
  CdsTranslations,
  isCodingFeature,
  rangePieces,
  rangeWraps,
} from '@/core';

import {
  type LinearTheme,
  type RowLayout,
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
import { SvgContext, escapeSvgText } from './svgContext';

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
/** The bases-per-row the export dialog offers (#30). */
export const MIN_EXPORT_BASES_PER_ROW = 10;
export const MAX_EXPORT_BASES_PER_ROW = 200;
/** One row per 60 bases makes a tall page; refuse to write an unusable file. */
const MAX_EXPORT_BASES = 100_000;

export interface LinearExportOptions {
  /**
   * Export only the rows that hold this range, numbered as in the document;
   * the whole sequence when absent. A range through the origin of a circle
   * (`end` past the length) is its two stretches, the rows up to the end
   * and then those from base 1 (#30). Rows stay whole rows.
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
  /** The base colours the user chose, which a figure keeps (#29); the print palette's otherwise. */
  readonly baseColors?: {
    readonly a: string;
    readonly c: string;
    readonly g: string;
    readonly t: string;
  } | null;
  /** How tall a read's trace is drawn, as the view's Format menu has it (#55). Default short. */
  readonly trace?: 'off' | 'short' | 'tall';
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

/** A stretch of whole rows drawn together; contiguous in the document. */
type Run = readonly RowLayout[];

/** What an export draws, laid out but not yet drawn. */
interface Plan {
  readonly width: number;
  /** One run, or two for a range through the origin. */
  readonly runs: readonly Run[];
  /** Draws `rows` (contiguous), as the view would with them scrolled to the top. */
  readonly draw: (rows: Run) => { readonly body: string; readonly height: number };
}

/** Where a run of rows starts on its own drawing: row 0 keeps the layout's top padding. */
function topOf(rows: Run): number {
  const first = rows[0];
  return first === undefined || first.index === 0 ? 0 : first.top;
}

function heightOf(rows: Run): number {
  const last = rows[rows.length - 1];
  return last === undefined ? 0 : last.top + last.height - topOf(rows);
}

function plan(doc: SeqDocument, options: LinearExportOptions): Plan {
  const basesPerRow = Math.max(
    MIN_EXPORT_BASES_PER_ROW,
    Math.round(options.basesPerRow ?? DEFAULT_BASES_PER_ROW),
  );
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
    // A read's chromatogram is exported with it, at the height it has on screen.
    trace: doc.read?.trace == null || options.trace === 'off' ? false : (options.trace ?? 'short'),
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

  const range = options.range ?? null;
  if (range !== null && rangeWraps(range, doc.length) && !doc.isCircular) {
    throw new Error('Only a circular sequence has a range through its origin.');
  }
  const pieces = range === null ? [{ start: 0, end: doc.length }] : rangePieces(range, doc.length);
  const runs: Run[] = [];
  for (const piece of pieces) {
    const first = layout.rowOfPosition(piece.start) ?? layout.rows[0];
    const last = layout.rowOfPosition(Math.max(piece.start, piece.end - 1)) ?? first;
    if (first === undefined || last === undefined) continue;
    runs.push(layout.rows.slice(first.index, last.index + 1));
  }
  if (runs.length === 0) throw new Error('There is nothing to export.');
  const bases = runs.reduce(
    (n, rows) => n + (rows[rows.length - 1]?.end ?? 0) - (rows[0]?.start ?? 0),
    0,
  );
  if (bases > MAX_EXPORT_BASES)
    throw new Error(
      `The sequence view export is limited to ${MAX_EXPORT_BASES.toLocaleString()} bases; select a shorter range.`,
    );

  const width = linearWidth(metrics);
  const translations = options.showTranslations === true ? new CdsTranslations(doc) : null;
  const draw = (rows: Run): { body: string; height: number } => {
    const top = topOf(rows);
    const height = heightOf(rows);
    const ctx = new SvgContext(width, height);
    renderLinearView(ctx, {
      doc,
      layout,
      lanes,
      translations,
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
      theme: {
        ...PRINT_LINEAR_THEME,
        ...(options.transparent === true ? { background: 'rgba(0,0,0,0)' } : {}),
        ...(options.baseColors == null
          ? {}
          : { baseColors: { ...options.baseColors, other: PRINT_LINEAR_THEME.baseColors.other } }),
      },
      monoFont,
      sansFont: sansFontOf(fontSize),
    });
    return { body: ctx.body(), height };
  };
  return { width, runs, draw };
}

/** The bases the runs show, 1-based: "1–4,361", or "4,321–4,361, 1–60" through the origin. */
function spansOf(runs: readonly Run[]): string {
  return runs
    .map((rows) => {
      const from = (rows[0]?.start ?? 0) + 1;
      const to = rows[rows.length - 1]?.end ?? 0;
      return `${from.toLocaleString()}–${to.toLocaleString()}`;
    })
    .join(', ');
}

/** Runs drawn one under the other, each clipped to its own rows. */
function stacked(
  p: Plan,
  runs: readonly Run[],
): { readonly body: string; readonly height: number } {
  let y = 0;
  let body = '';
  for (const rows of runs) {
    const drawn = p.draw(rows);
    body +=
      `<svg y="${fmt(y)}" width="${fmt(p.width)}" height="${fmt(drawn.height)}" ` +
      `viewBox="0 0 ${fmt(p.width)} ${fmt(drawn.height)}">${drawn.body}</svg>`;
    y += drawn.height;
  }
  return { body, height: y };
}

function fmt(x: number): string {
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * The linear sequence view as a standalone SVG document: ruler, strands,
 * translations, cut sites and feature lanes, laid out exactly as on screen
 * but at a fixed row width so the file is reproducible.
 */
export function exportLinearSvg(doc: SeqDocument, options: LinearExportOptions = {}): string {
  const p = plan(doc, options);
  const { body, height } = stacked(p, p.runs);
  const shown =
    options.range == null
      ? `${doc.length.toLocaleString()} bp`
      : `bases ${spansOf(p.runs)} of ${doc.length.toLocaleString()} bp`;
  const title = `<title>${escapeSvgText(`${doc.name} sequence`)}</title>`;
  const desc = `<desc>${escapeSvgText(`${shown}, ${doc.topology}. Exported from PlasmidPop.`)}</desc>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(p.width)}" height="${fmt(height)}" ` +
    `viewBox="0 0 ${fmt(p.width)} ${fmt(height)}">${title}${desc}${body}</svg>`
  );
}

/** An A4 page in CSS pixels (96 to the inch), and what is kept clear around its content. */
export const A4_PAGE = { width: 793.7, height: 1122.52, margin: 56.69, footer: 22 } as const;

/** The rows each A4 page holds, runs split where the pages break. */
function paginate(p: Plan): (readonly Run[])[] {
  const scale = Math.min(1, (A4_PAGE.width - 2 * A4_PAGE.margin) / p.width);
  const room = A4_PAGE.height - 2 * A4_PAGE.margin - A4_PAGE.footer;
  const pages: Run[][] = [];
  let page: Run[] = [];
  let used = 0;
  for (const run of p.runs) {
    let chunk: RowLayout[] = [];
    for (const row of run) {
      // Row 0 brings the layout's top padding with it.
      const cost = (row.height + (row.index === 0 ? row.top : 0)) * scale;
      if (used + cost > room && (page.length > 0 || chunk.length > 0)) {
        if (chunk.length > 0) page.push(chunk);
        pages.push(page);
        page = [];
        chunk = [];
        used = 0;
      }
      chunk.push(row);
      used += cost;
    }
    if (chunk.length > 0) page.push(chunk);
  }
  if (page.length > 0) pages.push(page);
  return pages;
}

/** How many A4 pages `exportLinearSvgPages` would write, without drawing them. */
export function countLinearSvgPages(doc: SeqDocument, options: LinearExportOptions = {}): number {
  return paginate(plan(doc, options)).length;
}

/**
 * The sequence view on A4 pages (#30), one SVG document each, 210 × 297 mm
 * with 15 mm margins: whole rows, as many as fit a page, scaled down to the
 * page's width when wider and never up. A row taller than a page has a
 * page to itself, scaled to fit. Each page's footer names the document, the
 * bases on it and the page number.
 */
export function exportLinearSvgPages(
  doc: SeqDocument,
  options: LinearExportOptions = {},
): string[] {
  const p = plan(doc, options);
  const pages = paginate(p);
  const room = A4_PAGE.height - 2 * A4_PAGE.margin - A4_PAGE.footer;
  const fit = Math.min(1, (A4_PAGE.width - 2 * A4_PAGE.margin) / p.width);
  const { width: W, height: H, margin: M } = A4_PAGE;
  return pages.map((runs, i) => {
    const { body, height } = stacked(p, runs);
    const scale = Math.min(fit, room / Math.max(1, height));
    const label = `${doc.name} — bases ${spansOf(runs)} of ${doc.length.toLocaleString()} bp — page ${i + 1} of ${pages.length}`;
    const paper =
      options.transparent === true
        ? ''
        : `<rect x="0" y="0" width="${fmt(W)}" height="${fmt(H)}" fill="${PRINT_LINEAR_THEME.background}"/>`;
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${fmt(W)} ${fmt(H)}">` +
      `<title>${escapeSvgText(`${doc.name} sequence, page ${i + 1} of ${pages.length}`)}</title>` +
      `<desc>${escapeSvgText(`Bases ${spansOf(runs)} of ${doc.length.toLocaleString()} bp, ${doc.topology}. Exported from PlasmidPop.`)}</desc>` +
      paper +
      `<g transform="translate(${fmt(M)} ${fmt(M)}) scale(${fmt(Number(scale.toFixed(4)))})">${body}</g>` +
      `<text x="${fmt(M)}" y="${fmt(H - M)}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="${PRINT_LINEAR_THEME.inkMuted}">${escapeSvgText(label)}</text>` +
      `</svg>`
    );
  });
}
