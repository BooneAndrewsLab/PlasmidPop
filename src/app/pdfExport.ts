/**
 * A figure as a PDF (#242, item 94): one document holding every page, drawn
 * as vectors or as pictures. This is the interface the dialog uses; the
 * writer itself (`pdfWriter.ts`, the one module that names jsPDF and
 * svg2pdf.js) is loaded on the first call, so the libraries cost nothing
 * until a PDF is chosen. A vector PDF is drawn on the main thread, a page
 * at a time with the browser given its turns; a raster one is drawn here
 * as PNGs, page by page, and assembled in the export worker (#248), so
 * neither stalls the page and both stop on the job's signal.
 */

import { type PngPage } from '@/workers/exportProtocol';
import { exportClient } from '@/workers/exportClient';

import { type ExportJobOptions, eachPage } from './exportJob';
import { loadPdfWriter } from './loadPdfWriter';
import { svgPixelSize } from './mapPng';

/** Vector keeps text and lines as they are; raster places each page as a PNG at a scale. */
export type PdfMode = 'vector' | 'raster';

export const PDF_MODES: readonly {
  readonly value: PdfMode;
  readonly label: string;
  readonly title: string;
}[] = [
  {
    value: 'vector',
    label: 'Vector',
    title: 'Text and lines stay sharp at any size, and the text can be selected',
  },
  {
    value: 'raster',
    label: 'Raster',
    title: 'Each page a picture at the scale above, as the PNG would be',
  },
];

export type PdfOptions = ExportJobOptions & {
  /** The document's title, as a PDF reader shows it. */
  readonly title: string;
} & (
    | { readonly mode: 'vector' }
    | {
        readonly mode: 'raster';
        readonly scale: number;
        /** How a page is drawn, as the PNG export draws it. */
        readonly rasterize: (svg: string, scale: number) => Promise<Blob>;
      }
  );

/** Each SVG page drawn as a PNG at `scale`, one at a time, with its size for the PDF to place it at. */
export async function rasterizePages(
  pages: readonly string[],
  scale: number,
  rasterize: (svg: string, scale: number) => Promise<Blob>,
  options: ExportJobOptions,
): Promise<PngPage[]> {
  return eachPage(pages, 'drawing', options, async (svg) => {
    const size = svgPixelSize(svg);
    if (size === null) throw new Error('The page has no size to draw.');
    const png = new Uint8Array(await (await rasterize(svg, scale)).arrayBuffer());
    return { png, ...size };
  });
}

/**
 * One PDF of the SVG `pages`, each at its own size (A4 or Letter for page
 * SVGs). The promise rejects with `ExportCancelledError` when the signal
 * stops it.
 */
export async function exportPdf(pages: readonly string[], options: PdfOptions): Promise<Blob> {
  const job: ExportJobOptions = { signal: options.signal, onProgress: options.onProgress };
  let bytes: Uint8Array;
  if (options.mode === 'vector') {
    const { writeVectorPdf } = await loadPdfWriter();
    bytes = await writeVectorPdf(pages, options.title, job);
  } else {
    const drawn = await rasterizePages(pages, options.scale, options.rasterize, job);
    bytes = await exportClient.rasterPdf(drawn, options.title, job);
  }
  return new Blob([bytes as BlobPart], { type: 'application/pdf' });
}
