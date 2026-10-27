import { type History, type SeqDocument } from '@/core';
import { writeFasta, writeFastq, writeGenBank } from '@/io';

/** What a document can be written as: FASTQ only while it has an intact read (#58). */
export type SaveFormat = 'genbank' | 'fasta' | 'fastq';

const EXTENSION: Readonly<Record<SaveFormat, string>> = {
  genbank: 'gb',
  fasta: 'fasta',
  fastq: 'fastq',
};

/**
 * Whether a document without a read was opened as one: some state of its
 * undo history still has the read that an edit to the bases set aside, so
 * the FASTQ export can say why it is not offered now rather than vanish.
 */
export function readSetAside(doc: SeqDocument, history: History<SeqDocument> | null): boolean {
  if (doc.read !== null || history === null) return false;
  for (let i = 0; i <= history.size; i++) {
    if ((history.stateAt(i)?.read ?? null) !== null) return true;
  }
  return false;
}

const PROTEIN_EXTENSION: Readonly<Partial<Record<SaveFormat, string>>> = {
  genbank: 'gp',
  fasta: 'faa',
};

/** A file-system-safe name for the document with the right extension. */
export function fileNameFor(doc: SeqDocument, format: SaveFormat): string {
  const stem =
    doc.name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_') || 'Untitled';
  // A protein goes as GenPept or protein FASTA, which have extensions of their own (#66).
  const extension = doc.isProtein
    ? (PROTEIN_EXTENSION[format] ?? EXTENSION[format])
    : EXTENSION[format];
  return `${stem}.${extension}`;
}

/** The name a SnapGene download goes under: the document's own, with the extension the file has. */
export function snapGeneFileName(doc: SeqDocument, extension: string): string {
  return fileNameFor(doc, 'genbank').replace(/\.[^.]+$/, `.${extension}`);
}

export function serialize(doc: SeqDocument, format: SaveFormat): string {
  switch (format) {
    case 'genbank':
      return writeGenBank(doc);
    case 'fasta':
      return writeFasta(doc);
    case 'fastq':
      return writeFastq(doc);
  }
}

/**
 * The type every download is handed to the browser as, whatever is in it.
 *
 * iOS Safari checks a download's name against its type and, when the
 * extension is not one it knows for that type, appends the type's own:
 * GenBank as `text/plain` came out as `.gb.txt`, an SVG as `.svg.txt`, and a
 * PDF typed `application/pdf` opened in the browser rather than downloading
 * (#295). `application/octet-stream` names no format, so there is nothing to
 * correct the name to and nothing to preview, and every browser then keeps
 * the name the `download` attribute gives. The bytes are unchanged; a file's
 * format is in its name and its content, never in this type. Not verified on
 * a device; see item 15.
 */
export const DOWNLOAD_TYPE = 'application/octet-stream';

/** Triggers a browser download of `text`, encoded as UTF-8. */
export function downloadText(fileName: string, text: string): void {
  downloadBlob(fileName, new Blob([text], { type: DOWNLOAD_TYPE }));
}

/**
 * `blob` as the browser is handed it: the same bytes, typed
 * {@link DOWNLOAD_TYPE} whatever type it was made with.
 */
export function asDownload(blob: Blob): Blob {
  return blob.type === DOWNLOAD_TYPE ? blob : new Blob([blob], { type: DOWNLOAD_TYPE });
}

/**
 * Triggers a browser download of `blob` under exactly `fileName`: a document
 * leaves the app this way and no other (item 24).
 */
export function downloadBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(asDownload(blob));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function saveDocument(doc: SeqDocument, format: SaveFormat, download = downloadText): void {
  download(fileNameFor(doc, format), serialize(doc, format));
}
