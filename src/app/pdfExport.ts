/**
 * A figure as a PDF (#242, item 94): one document holding every page, drawn
 * as vectors or as pictures. This is the interface the dialog uses; the
 * writer itself (`pdfWriter.ts`, the one module that names jsPDF and
 * svg2pdf.js) is loaded on the first call, so the libraries cost nothing
 * until a PDF is chosen.
 */

import type { writePdf } from './pdfWriter';

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

export type PdfOptions = {
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

/** Loads the writer, saying what to do when it cannot be fetched. */
async function loadWriter(): Promise<{ readonly writePdf: typeof writePdf }> {
  try {
    return await import('./pdfWriter');
  } catch {
    throw new Error(
      'The PDF writer could not be loaded. It is fetched the first time a PDF is exported, so check the connection and try again.',
    );
  }
}

/** One PDF of the SVG `pages`, each at its own size (A4 or Letter for page SVGs). */
export async function exportPdf(pages: readonly string[], options: PdfOptions): Promise<Blob> {
  const { writePdf } = await loadWriter();
  return writePdf(pages, options);
}
