/**
 * What the sequence-view export dialog asks for (#30), read into what
 * `exportLinearSvg` takes: a range typed 1-based inclusive as the rest of
 * the UI numbers bases, held 0-based half-open as the model does, and a
 * bases-per-row within what the export offers.
 */

import { type Range, type SeqDocument, rangeWraps } from '@/core';
import { writeZip } from '@/io';
import { MAX_EXPORT_BASES_PER_ROW, MIN_EXPORT_BASES_PER_ROW } from '@/view/svg';

export type ExportRangeKind = 'whole' | 'selection' | 'custom';

export type ExportRange =
  | {
      readonly ok: true;
      /** Null for the whole sequence. `end` past the length runs through the origin. */
      readonly range: Range | null;
      /** For the file name: "sequence", "selection", or "301-1200". */
      readonly suffix: string;
    }
  | { readonly ok: false; readonly message: string };

/** A whole number typed in a box, or null. */
function wholeNumber(text: string): number | null {
  // Stryker disable next-line MethodExpression: the replace on the next token strips every whitespace character, leading and trailing included, so trim() adds nothing
  const t = text.trim().replace(/[,\s]/g, '');
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * The range to export. `from` and `to` are 1-based and inclusive; on a
 * circular sequence a `to` before `from` runs through the origin, so
 * 4,301 to 60 is the last bases then the first.
 */
export function readExportRange(
  doc: SeqDocument,
  kind: ExportRangeKind,
  selection: Range | null,
  fromText: string,
  toText: string,
): ExportRange {
  if (kind === 'whole') return { ok: true, range: null, suffix: 'sequence' };
  if (kind === 'selection') {
    if (selection === null || selection.start === selection.end) {
      return { ok: false, message: 'Nothing is selected.' };
    }
    return { ok: true, range: selection, suffix: 'selection' };
  }
  const L = doc.length;
  const from = wholeNumber(fromText);
  const to = wholeNumber(toText);
  // Stryker disable next-line ConditionalExpression,LogicalOperator: a null coerces to 0 in `from < 1` and `to < 1`, so those reject a null just as the null checks do
  if (from === null || to === null || from < 1 || to < 1 || from > L || to > L) {
    return { ok: false, message: `From and to are bases 1 to ${L.toLocaleString()}.` };
  }
  if (to < from && !doc.isCircular) {
    return {
      ok: false,
      message: 'To comes before from. Only a circular sequence can be exported through its origin.',
    };
  }
  const start = from - 1;
  const end = to >= from ? to : to + L;
  return { ok: true, range: { start, end }, suffix: `${from}-${to}` };
}

/** The bases per row typed, if it is one the export offers. */
export function readBasesPerRow(text: string): number | null {
  const n = wholeNumber(text);
  // Stryker disable next-line ConditionalExpression: a null coerces to 0 in `n >= MIN`, which is false for the minimum of 10, so the null check is redundant
  return n !== null && n >= MIN_EXPORT_BASES_PER_ROW && n <= MAX_EXPORT_BASES_PER_ROW ? n : null;
}

/** The 1-based from and to a range is shown as in the boxes. */
export function rangeBoxes(doc: SeqDocument, r: Range): { from: string; to: string } {
  const to = rangeWraps(r, doc.length) ? r.end - doc.length : r.end;
  return { from: String(r.start + 1), to: String(to) };
}

/**
 * More pages than this are refused (#246). The sequence view is limited to
 * 100,000 bases and 10 bases a row is the narrowest, which is about 830 A4
 * pages; every file type held that in the measurements (docs/perf-notes.md),
 * so this is a guard above anything the dialog can lay out, not the limit
 * that matters: the pictures' pixels are (`exportFigure.ts`).
 */
export const MAX_EXPORT_PAGES = 1000;

/**
 * The pictures one export may draw, in megapixels summed over its pages
 * (#246). PNG pages are held until the ZIP is written: 2,970 MP (834 A4
 * pages at 2×) took 45 s and about 640 MB more than an idle browser, so
 * 3,000 is the most that was shown to hold. A raster PDF costs about 0.2 s
 * a megapixel in jsPDF's PNG decoding whatever the scale, so 600 MP (the
 * 40 pages at 4× the old cap allowed) is about two minutes.
 */
export const MAX_PNG_ZIP_MEGAPIXELS = 3000;
export const MAX_RASTER_PDF_MEGAPIXELS = 600;

/** The name of page `i` (0-based) of `n`, `stem_p01.svg` onwards, with as many digits as `n` needs. */
export function pageFileName(stem: string, extension: string, i: number, n: number): string {
  const digits = Math.max(2, String(n).length);
  return `${stem}_p${String(i + 1).padStart(digits, '0')}.${extension}`;
}

/**
 * The pages as one ZIP archive (#242), the files inside named
 * `stem_p01.svg` onwards (or `.png`): one download for the browser to ask
 * about rather than one per page. A single SVG or PNG cannot hold pages;
 * a PDF can (`pdfExport.ts`).
 */
export function pagesZip(
  stem: string,
  extension: 'svg' | 'png',
  pages: readonly Uint8Array[],
): Blob {
  const bytes = writeZip(
    pages.map((data, i) => ({ path: pageFileName(stem, extension, i, pages.length), data })),
  );
  return new Blob([bytes as BlobPart], { type: 'application/zip' });
}
