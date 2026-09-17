import { type SeqDocument } from '@/core';
import { writeFasta, writeGenBank } from '@/io';

export type SaveFormat = 'genbank' | 'fasta';

/** A file-system-safe name for the document with the right extension. */
export function fileNameFor(doc: SeqDocument, format: SaveFormat): string {
  const stem =
    doc.name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_') || 'Untitled';
  return `${stem}.${format === 'genbank' ? 'gb' : 'fasta'}`;
}

export function serialize(doc: SeqDocument, format: SaveFormat): string {
  return format === 'genbank' ? writeGenBank(doc) : writeFasta(doc);
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
