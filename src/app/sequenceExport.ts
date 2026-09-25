/**
 * What the sequence-view export dialog asks for (#30), read into what
 * `exportLinearSvg` takes: a range typed 1-based inclusive as the rest of
 * the UI numbers bases, held 0-based half-open as the model does, and a
 * bases-per-row within what the export offers.
 */

import { type Range, type SeqDocument, rangeWraps } from '@/core';
import { MAX_EXPORT_BASES_PER_ROW, MIN_EXPORT_BASES_PER_ROW } from '@/view/svg';

import { downloadText } from './saveFile';

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
  return n !== null && n >= MIN_EXPORT_BASES_PER_ROW && n <= MAX_EXPORT_BASES_PER_ROW ? n : null;
}

/** The 1-based from and to a range is shown as in the boxes. */
export function rangeBoxes(doc: SeqDocument, r: Range): { from: string; to: string } {
  const to = rangeWraps(r, doc.length) ? r.end - doc.length : r.end;
  return { from: String(r.start + 1), to: String(to) };
}

/** More pages than this are not downloaded one by one: too many files to be useful. */
export const MAX_EXPORT_PAGES = 40;

/** Time between two downloads, so a browser does not drop the later ones. */
const DOWNLOAD_SPACING_MS = 300;

/**
 * Downloads each page as a file of its own, `stem_p01.svg` onwards. The
 * project has no zip writer and a single SVG cannot hold pages, so pages
 * are files; they are spaced out, as browsers drop a burst of downloads.
 */
export function downloadPages(
  stem: string,
  pages: readonly string[],
  download: (name: string, text: string) => void = downloadText,
): void {
  const digits = Math.max(2, String(pages.length).length);
  pages.forEach((page, i) => {
    const name = `${stem}_p${String(i + 1).padStart(digits, '0')}.svg`;
    if (i === 0) download(name, page);
    else {
      setTimeout(() => {
        download(name, page);
      }, i * DOWNLOAD_SPACING_MS);
    }
  });
}
