import { loadPdfWriter } from '@/app/loadPdfWriter';
import { type ExportJobOptions, throwIfCancelled } from '@/app/exportJob';
import { writeZip } from '@/io';

import type { ExportRequest, ExportResponse } from './exportProtocol';

/**
 * The export worker (#247, #248): deflates a ZIP of pages and assembles a
 * raster PDF from PNG bytes, the two steps of an export that took seconds
 * on the main thread. The ZIP is `writeZip` (`src/io/zip.ts`) as before and
 * the PDF is `pdfWriter.ts`, loaded here on the first PDF, so the files
 * are byte for byte what the main thread wrote. Stopping a job is the
 * client terminating the worker: a deflate cannot be interrupted from
 * inside, and a fresh worker costs nothing a user would notice.
 *
 * `handleExportRequest` is also what runs on the calling thread where
 * `Worker` does not exist (tests); there the signal is looked at between
 * pages, which is the most an inline run can do.
 */
export async function handleExportRequest(
  req: ExportRequest,
  options: ExportJobOptions = {},
): Promise<Uint8Array> {
  throwIfCancelled(options.signal);
  if (req.kind === 'zip') return writeZip(req.entries);
  const { writeRasterPdf } = await loadPdfWriter();
  throwIfCancelled(options.signal);
  return writeRasterPdf(req.pages, req.title, options);
}

const scope = globalThis as {
  onmessage?: ((ev: MessageEvent<ExportRequest>) => void) | null;
  postMessage?: (m: ExportResponse, transfer?: Transferable[]) => void;
};
if (typeof scope.postMessage === 'function' && typeof document === 'undefined') {
  scope.onmessage = (ev: MessageEvent<ExportRequest>) => {
    const { id } = ev.data;
    handleExportRequest(ev.data, {
      onProgress: ({ done, total }) => {
        scope.postMessage?.({ id, kind: 'progress', done, total });
      },
    }).then(
      (bytes) => {
        // The file is handed over rather than copied.
        const transfer = bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
        scope.postMessage?.({ id, kind: 'done', bytes }, transfer);
      },
      (e: unknown) => {
        scope.postMessage?.({
          id,
          kind: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      },
    );
  };
}
