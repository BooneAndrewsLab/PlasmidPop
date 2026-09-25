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

/** Triggers a browser download of `text`. */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
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
