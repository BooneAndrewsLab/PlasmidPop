import { FormatError, parseSequenceData, parseSequenceFile } from '@/io';

import { editorStore } from './state/editorStore';

const UNSUPPORTED: Readonly<Record<string, string>> = {
  geneious: 'Geneious files are not supported yet. Export as GenBank first.',
};

/** Reads a file the user picked or dropped and shows it, or shows why it could not be read. */
export async function openFile(file: File): Promise<void> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const unsupported = UNSUPPORTED[ext];
  if (unsupported !== undefined) {
    editorStore.fail(unsupported);
    return;
  }
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    editorStore.fail(`Could not read "${file.name}".`);
    return;
  }
  try {
    editorStore.openParsed(parseSequenceData(data, file.name), file.name);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
  }
}

export function openText(text: string, fileName: string | null): void {
  try {
    editorStore.openParsed(parseSequenceFile(text, fileName ?? undefined), fileName);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Text pasted with no document open (or into an empty one): a GenBank or
 * FASTA record opens as such; bare bases become a new untitled document with
 * the caret at the end, ready for more typing. Anything else is reported.
 */
export function openPastedText(text: string): void {
  if (text.trim() === '') return;
  let result;
  try {
    result = parseSequenceFile(text);
  } catch (e) {
    if (e instanceof FormatError) {
      editorStore.fail(
        'Pasted text is not a GenBank or FASTA record and contains characters outside the IUPAC nucleotide alphabet.',
      );
      return;
    }
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return;
  }
  editorStore.openParsed(result, null);
  const doc = editorStore.document;
  if (result.format === 'raw' && doc !== null)
    editorStore.setSelection({ start: doc.length, end: doc.length });
}
