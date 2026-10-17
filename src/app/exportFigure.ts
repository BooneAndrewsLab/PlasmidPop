/**
 * What the Export figure dialog (#240, item 94) chooses between, and the
 * arithmetic behind its live size check (#243), kept out of the component
 * so it can be tested without rendering.
 */

import { MAX_EXPORT_BASES_PER_ROW, type PaperSize } from '@/view/svg';

import { MAX_PNG_SIDE, PNG_SCALES, largestPngScale, pngSizeOf } from './mapPng';
import {
  MAX_EXPORT_PAGES,
  MAX_PNG_ZIP_MEGAPIXELS,
  MAX_RASTER_PDF_MEGAPIXELS,
} from './sequenceExport';

/** The two pictures the dialog exports: the circular map or the sequence rows. */
export type FigureView = 'map' | 'sequence';

/**
 * How the figure leaves. A PDF (#242) holds every page in one file, drawn
 * as vectors or, with a scale, as pictures (`pdfExport.ts`).
 */
export type FigureFileType = 'svg' | 'png' | 'pdf';

export const FIGURE_FILE_TYPES: readonly { value: FigureFileType; label: string; title: string }[] =
  [
    {
      value: 'svg',
      label: 'SVG',
      title: 'A vector file: sharp at any size, editable in Inkscape or Illustrator',
    },
    { value: 'png', label: 'PNG', title: 'A picture at a chosen scale, for slides and documents' },
    {
      value: 'pdf',
      label: 'PDF',
      title: 'A document of every page, vector or a picture at a chosen scale',
    },
  ];

/** The paper sizes pages can be laid out for (#245). */
export const PAPER_SIZES: readonly { value: PaperSize; label: string; title: string }[] = [
  { value: 'a4', label: 'A4', title: '210 × 297 mm' },
  { value: 'letter', label: 'US Letter', title: '8.5 × 11 in (215.9 × 279.4 mm)' },
];

/** The regions whose usual paper is US Letter rather than A4. */
const LETTER_REGIONS: ReadonlySet<string> = new Set([
  'US',
  'CA',
  'MX',
  'PH',
  'CL',
  'CO',
  'VE',
  'CR',
  'GT',
  'PA',
  'DO',
  'SV',
  'HN',
  'NI',
  'PR',
]);

/**
 * The paper a browser's locales suggest (#245): US Letter for the first
 * locale whose region is in North America or one of the other Letter
 * countries, A4 otherwise (also when no locale names a region). Nothing is
 * stored; the dialog asks again each time it opens.
 */
export function defaultPaper(locales: readonly string[]): PaperSize {
  const first = locales.find((l) => l.trim() !== '');
  if (first === undefined) return 'a4';
  const region = /^[A-Za-z]{2,3}(?:[-_][A-Za-z]{4})?[-_]([A-Za-z]{2}|\d{3})(?:[-_]|$)/.exec(
    first.trim(),
  )?.[1];
  return region !== undefined && LETTER_REGIONS.has(region.toUpperCase()) ? 'letter' : 'a4';
}

/** The text sizes the map's figure offers, as multiples of the on-screen size (item 89). */
export const FIGURE_FONT_SCALES: readonly { value: number; label: string }[] = [
  { value: 0.8, label: 'Smaller' },
  { value: 1, label: 'Normal' },
  { value: 1.25, label: 'Larger' },
  { value: 1.6, label: 'Largest' },
];

/** A size in CSS pixels, as the SVG would be written. */
export interface FigureSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Why a PNG of `size` at `scale` cannot be drawn, saying what to change,
 * or null when it can. The advice is worked out from the limit: the
 * largest offered scale that fits, and for the sequence view the row width
 * that would (the figure's height falls as its rows widen), or pages,
 * each of which is far below the limit.
 */
export function pngProblem(
  size: FigureSize,
  scale: number,
  view: FigureView,
  sequence: { readonly basesPerRow: number; readonly pages: boolean },
): string | null {
  if (pngSizeOf(size, scale).ok) return null;
  const png = { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
  const limit = MAX_PNG_SIDE.toLocaleString();
  const head = `At ${String(scale)}× the picture would be ${png.width.toLocaleString()} × ${png.height.toLocaleString()} pixels, more than a browser draws (${limit})`;
  const largest = largestPngScale(size);
  const advice: string[] = [];
  if (largest !== null) advice.push(`choose ${String(largest)}× or less`);
  if (view === 'sequence' && !sequence.pages) {
    // Rows rather than width are what is over the limit: widening them
    // shortens the figure about in proportion.
    const tall = size.height > size.width;
    const rowsNeeded = Math.ceil(
      (sequence.basesPerRow * (tall ? png.height : png.width)) / MAX_PNG_SIDE / 10,
    );
    const perRow = Math.min(MAX_EXPORT_BASES_PER_ROW, rowsNeeded * 10);
    if (tall && perRow > sequence.basesPerRow)
      advice.push(`about ${String(perRow)} or more bases per row`);
    advice.push('split into pages');
  }
  if (advice.length === 0) return `${head}.`;
  const last = advice.pop() ?? '';
  return `${head}: ${advice.length === 0 ? last : `${advice.join(', ')} or ${last}`}.`;
}

/** What the pages of one export are drawn as, for what each costs (#246). */
export type PagesOutput = 'svg' | 'png' | 'pdf-vector' | 'pdf-raster';

/** The megapixels one export of pages may draw, or null where nothing is rasterised. */
export function pagesBudget(output: PagesOutput): number | null {
  if (output === 'png') return MAX_PNG_ZIP_MEGAPIXELS;
  if (output === 'pdf-raster') return MAX_RASTER_PDF_MEGAPIXELS;
  return null;
}

/**
 * Why `count` pages of `page` size cannot go in one export, saying what to
 * change, or null when they can (#246). There are two limits: the page
 * count, and for PNG pages and a raster PDF the pixels summed over the
 * pages at `scale`, which is what the browser holds in memory and what a
 * raster PDF spends its time on. The advice is worked out from the limit:
 * the largest offered scale that fits, then fewer pages, which a shorter
 * range or more bases per row make.
 */
export function pagesProblem(
  count: number,
  page: FigureSize,
  scale: number,
  output: PagesOutput,
): string | null {
  if (count > MAX_EXPORT_PAGES)
    return `That is ${count.toLocaleString()} pages, more than the ${MAX_EXPORT_PAGES.toLocaleString()} one export holds: choose a shorter range or more bases per row.`;
  const budget = pagesBudget(output);
  if (budget === null) return null;
  const megapixels = (n: number, k: number): number =>
    (n * page.width * k * (page.height * k)) / 1_000_000;
  const total = megapixels(count, scale);
  if (total <= budget) return null;
  const what = output === 'png' ? 'a ZIP of PNGs' : 'a raster PDF';
  const head = `${count.toLocaleString()} pages at ${String(scale)}× are ${Math.round(total).toLocaleString()} megapixels, more than ${what} holds (${budget.toLocaleString()})`;
  const advice: string[] = [];
  const fits = PNG_SCALES.filter((k) => k < scale && megapixels(count, k) <= budget);
  const largest = fits[fits.length - 1];
  if (largest !== undefined) advice.push(`choose ${String(largest)}× or less`);
  if (output === 'pdf-raster') advice.push('switch to Vector');
  const perPage = megapixels(1, scale);
  const fewer = Math.floor(budget / perPage);
  if (fewer >= 1)
    advice.push(
      `export at most ${fewer.toLocaleString()} ${fewer === 1 ? 'page' : 'pages'} (a shorter range or more bases per row)`,
    );
  if (advice.length === 0) return `${head}.`;
  const last = advice.pop() ?? '';
  return `${head}: ${advice.length === 0 ? last : `${advice.join(', ')} or ${last}`}.`;
}
