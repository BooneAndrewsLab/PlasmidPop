/**
 * The PDF writer behind `pdfExport.ts` (#242): jsPDF (MIT) with svg2pdf.js
 * (MIT) drawing each SVG page into it. Nothing outside this file names
 * either library, and nothing imports this file statically: `exportPdf`
 * loads it with a dynamic `import()` when a PDF is first asked for, so it
 * is a chunk of its own (`pdfWriter-*.js`) that the first load never
 * fetches and the service worker does not precache (vite.config.ts).
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
import { svg2pdf } from 'svg2pdf.js';

import { svgPixelSize } from './mapPng';
import type { PdfOptions } from './pdfExport';

/** The weight names jsPDF has fonts for, from a CSS weight. */
function pdfWeight(weight: string): string {
  const n = Number(weight);
  if (Number.isNaN(n)) return weight;
  return n >= 600 ? 'bold' : 'normal';
}

/** The SVG as a DOM tree svg2pdf can draw, its font weights rounded to the two the PDF has. */
function parseSvg(svg: string): Element {
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  if (root.tagName !== 'svg') throw new Error('The figure is not an SVG picture.');
  for (const el of root.querySelectorAll('[font-weight]')) {
    const weight = el.getAttribute('font-weight');
    if (weight !== null) el.setAttribute('font-weight', pdfWeight(weight));
  }
  return root;
}

interface Page {
  readonly svg: string;
  readonly width: number;
  readonly height: number;
}

const orientationOf = (page: Page): 'landscape' | 'portrait' =>
  page.width > page.height ? 'landscape' : 'portrait';

/**
 * One PDF of every page, in the pages' order. Vector pages are drawn as
 * lines and text; raster ones are each `rasterize`d at `scale` as the PNG
 * export would and placed at the page's own size, so the scale sets the
 * pixels per inch (96 × scale).
 */
export async function writePdf(pages: readonly string[], options: PdfOptions): Promise<Blob> {
  const sized: Page[] = pages.map((svg) => {
    const size = svgPixelSize(svg);
    if (size === null) throw new Error('The page has no size to draw.');
    return { svg, ...size };
  });
  const first = sized[0];
  if (first === undefined) throw new Error('There is no page to write.');
  const doc = new jsPDF({
    unit: 'px',
    format: [first.width, first.height],
    orientation: orientationOf(first),
    hotfixes: ['px_scaling'],
    compress: true,
  });
  for (const [i, page] of sized.entries()) {
    if (i > 0) doc.addPage([page.width, page.height], orientationOf(page));
    if (options.mode === 'vector') {
      await svg2pdf(parseSvg(page.svg), doc, {
        x: 0,
        y: 0,
        width: page.width,
        height: page.height,
      });
    } else {
      const png = await options.rasterize(page.svg, options.scale);
      const bytes = new Uint8Array(await png.arrayBuffer());
      doc.addImage(bytes, 'PNG', 0, 0, page.width, page.height, undefined, 'FAST');
    }
  }
  doc.setProperties({ title: options.title, creator: 'PlasmidPop' });
  return doc.output('blob');
}
