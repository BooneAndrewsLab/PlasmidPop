/**
 * The PDF writer behind `pdfExport.ts` (#242): jsPDF (MIT) with svg2pdf.js
 * (MIT) drawing each SVG page into it. Nothing outside this file names
 * either library, and nothing imports this file statically: `loadPdfWriter`
 * loads it with a dynamic `import()` when a PDF is first asked for, so it
 * is a chunk of its own (`pdfWriter-*.js`) that the first load never
 * fetches and the service worker does not precache (vite.config.ts).
 *
 * Two writers (#248): `writeVectorPdf` runs on the main thread, since
 * svg2pdf wants the DOM (a parsed SVG tree, text measured by the browser);
 * `writeRasterPdf` takes pages already encoded as PNGs and runs in the
 * export worker, where jsPDF's decoding and re-deflating of each picture,
 * about 0.2 s a megapixel, no longer stalls the page. svg2pdf is loaded
 * only by the vector writer, so the worker's copy of this chunk never
 * fetches it.
 *
 * Pages are in CSS pixels, as the SVGs are sized: with jsPDF's `px_scaling`
 * hotfix a pixel is 1/96 inch, so an A4 page SVG (210 × 297 mm, written as
 * 793.7 × 1,122.52 px) comes out as A4, a Letter one (215.9 × 279.4 mm, 816 ×
 * 1,056 px) as 612 × 792 pt, and a figure's own size otherwise.
 *
 * Text is set in the PDF's standard fonts, not embedded: the sequence's
 * `"Courier New", Courier, monospace` is Courier and the labels' `Helvetica,
 * Arial, sans-serif` Helvetica, whose widths jsPDF knows, so the bases keep
 * their grid and the ruler and labels their places (checked against
 * Chromium's rendering of the same SVG). The figures' only non-ASCII glyphs
 * (…, – and —) are in those fonts' WinAnsi set. jsPDF knows the weights
 * `normal` and `bold` alone, and svg2pdf hands it anything else as a style
 * it has no font for, which falls back to Times: the map's title is weight
 * 600, so numeric weights are rounded to the two before drawing.
 */

import { jsPDF } from 'jspdf';

import type { PngPage } from '@/workers/exportProtocol';

import { type ExportJobOptions, eachPage } from './exportJob';
import { svgPixelSize } from './mapPng';

/** The weight names jsPDF has fonts for, from a CSS weight. */
function pdfWeight(weight: string): string {
  const n = Number(weight);
  if (Number.isNaN(n)) return weight;
  // Stryker disable next-line StringLiteral: an empty weight is read as normal by svg2pdf, so the 'normal' branch's text cannot be told from empty
  return n >= 600 ? 'bold' : 'normal';
}

/** The SVG as a DOM tree svg2pdf can draw, its font weights rounded to the two the PDF has. */
function parseSvg(svg: string): Element {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.tagName !== 'svg') throw new Error('The figure is not an SVG picture.');
  for (const el of root.querySelectorAll('[font-weight]')) {
    const weight = el.getAttribute('font-weight');
    // Stryker disable next-line ConditionalExpression: the selector matched on the attribute, so it is never null (the check is for the type)
    if (weight !== null) el.setAttribute('font-weight', pdfWeight(weight));
  }
  return root;
}

interface PageSize {
  readonly width: number;
  readonly height: number;
}

const orientationOf = (page: PageSize): 'landscape' | 'portrait' =>
  // Stryker disable next-line EqualityOperator: a square page is the same either way round
  page.width > page.height ? 'landscape' : 'portrait';

/** A document whose first page is `first`'s size; the rest are added as they come. */
function newDocument(first: PageSize): jsPDF {
  return new jsPDF({
    unit: 'px',
    format: [first.width, first.height],
    orientation: orientationOf(first),
    hotfixes: ['px_scaling'],
    compress: true,
  });
}

function finish(doc: jsPDF, title: string): Uint8Array {
  doc.setProperties({ title, creator: 'PlasmidPop' });
  return new Uint8Array(doc.output('arraybuffer'));
}

/**
 * One PDF of every SVG page, in the pages' order, drawn as lines and text.
 * Runs on the main thread, a page at a time, giving the browser its turns
 * and stopping on the signal (`eachPage`); a page in progress finishes
 * first, which is a fraction of a second.
 */
export async function writeVectorPdf(
  pages: readonly string[],
  title: string,
  options: ExportJobOptions = {},
): Promise<Uint8Array> {
  const sized = pages.map((svg) => {
    const size = svgPixelSize(svg);
    if (size === null) throw new Error('The page has no size to draw.');
    return { svg, ...size };
  });
  const first = sized[0];
  if (first === undefined) throw new Error('There is no page to write.');
  const { svg2pdf } = await import('svg2pdf.js');
  const doc = newDocument(first);
  await eachPage(sized, 'drawing', options, async (page, i) => {
    if (i > 0) doc.addPage([page.width, page.height], orientationOf(page));
    // Stryker disable next-line ObjectLiteral: without the options svg2pdf draws at the SVG's own origin and size, which is the page's
    await svg2pdf(parseSvg(page.svg), doc, {
      x: 0,
      y: 0,
      width: page.width,
      height: page.height,
    });
  });
  return finish(doc, title);
}

/**
 * One PDF of every PNG page, each placed at its own size in CSS pixels, so
 * the pixels per inch are 96 times the scale it was drawn at. The pages are
 * added in turn with progress after each (stage `writing`); the signal is
 * looked at between pages, which matters when this runs inline rather than
 * in the worker, where stopping is the worker ending.
 */
export async function writeRasterPdf(
  pages: readonly PngPage[],
  title: string,
  options: ExportJobOptions = {},
): Promise<Uint8Array> {
  const first = pages[0];
  if (first === undefined) throw new Error('There is no page to write.');
  const doc = newDocument(first);
  await eachPage(pages, 'writing', options, (page, i) => {
    if (i > 0) doc.addPage([page.width, page.height], orientationOf(page));
    // Stryker disable next-line StringLiteral: jsPDF finds a PNG's format from its bytes when none is given (the compression, 'FAST', is tested by the size)
    doc.addImage(page.png, 'PNG', 0, 0, page.width, page.height, undefined, 'FAST');
  });
  return finish(doc, title);
}
