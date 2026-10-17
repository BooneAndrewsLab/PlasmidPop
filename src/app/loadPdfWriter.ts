/**
 * Loads the PDF writer (`pdfWriter.ts`, the one module that names jsPDF)
 * with a dynamic `import()`, so it is a chunk of its own that nothing
 * fetches until a PDF is asked for (#242). The main thread loads it for a
 * vector PDF; the export worker loads its own copy for a raster one
 * (#248). Kept apart from `pdfExport.ts` so the worker's module graph does
 * not reach the worker client.
 */

import type * as PdfWriter from './pdfWriter';

export type PdfWriterModule = Pick<typeof PdfWriter, 'writeVectorPdf' | 'writeRasterPdf'>;

export async function loadPdfWriter(): Promise<PdfWriterModule> {
  try {
    return await import('./pdfWriter');
  } catch {
    throw new Error(
      'The PDF writer could not be loaded. It is fetched the first time a PDF is exported, so check the connection and try again.',
    );
  }
}
