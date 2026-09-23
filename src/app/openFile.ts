import { FormatError, parseSequenceData, parseSequenceFile } from '@/io';

import { analytics, formatOfFileName } from './analytics';
import { type Example } from './examples';
import { type OpenStorage, editorStore } from './state/editorStore';

const UNSUPPORTED: Readonly<Record<string, string>> = {
  geneious: 'Geneious files are not supported yet. Export as GenBank first.',
};

/**
 * Reads a file the user picked or dropped and opens it in a new tab,
 * returning the document's id, or shows why it could not be read and
 * returns null.
 */
export async function openFile(file: File): Promise<string | null> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const unsupported = UNSUPPORTED[ext];
  if (unsupported !== undefined) {
    analytics.track('file', 'open-failed', formatOfFileName(file.name));
    editorStore.fail(unsupported);
    return null;
  }
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    editorStore.fail(`Could not read "${file.name}".`);
    return null;
  }
  try {
    return editorStore.openParsed(parseSequenceData(data, file.name), file.name);
  } catch (e) {
    analytics.track('file', 'open-failed', formatOfFileName(file.name));
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return null;
  }
}

export function openText(
  text: string,
  fileName: string | null,
  storage: OpenStorage = {},
): string | null {
  try {
    return editorStore.openParsed(
      parseSequenceFile(text, fileName ?? undefined),
      fileName,
      storage,
    );
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return null;
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

/**
 * Opens the bundled example. Its file name is there to save under, not to
 * point at anything on the user's disk, so it gets no origin: there is no
 * file to fork a working copy off.
 */
export function openExample(example: Example): string | null {
  return openText(example.text, example.fileName, { origin: null });
}
