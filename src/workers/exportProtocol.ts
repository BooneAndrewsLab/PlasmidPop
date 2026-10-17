import type { ZipEntry } from '@/io';

/**
 * What the export worker (#247, #248) is asked and answers. It takes the
 * two jobs that used to block the page: deflating a ZIP of pages, and
 * assembling a raster PDF from pages already encoded as PNGs. Drawing
 * stays on the main thread (a worker cannot decode an SVG, item 94), so
 * what crosses is bytes, handed over rather than copied.
 */

/** A page already drawn as a PNG, with the size it is placed at in CSS pixels. */
export interface PngPage {
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export type ExportRequest =
  | { readonly id: number; readonly kind: 'zip'; readonly entries: readonly ZipEntry[] }
  | {
      readonly id: number;
      readonly kind: 'rasterPdf';
      readonly pages: readonly PngPage[];
      readonly title: string;
    };

export type ExportResponse =
  | {
      readonly id: number;
      readonly kind: 'progress';
      readonly done: number;
      readonly total: number;
    }
  | { readonly id: number; readonly kind: 'done'; readonly bytes: Uint8Array }
  | { readonly id: number; readonly kind: 'error'; readonly message: string };

/** The buffers a request carries, to transfer rather than copy. A buffer is listed once. */
export function transferablesOf(req: ExportRequest): ArrayBuffer[] {
  const arrays = req.kind === 'zip' ? req.entries.map((e) => e.data) : req.pages.map((p) => p.png);
  const buffers = new Set<ArrayBuffer>();
  for (const a of arrays) {
    // A view on a SharedArrayBuffer cannot be transferred; none is made here.
    if (a.buffer instanceof ArrayBuffer) buffers.add(a.buffer);
  }
  return [...buffers];
}
