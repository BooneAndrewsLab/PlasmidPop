import { type SeqDocument } from '@/core';
import {
  type ArchiveRecord,
  FormatError,
  isZip,
  parseSequenceFile,
  readSequenceArchive,
  readSequenceData,
} from '@/io';

import { analytics, formatOfFileName } from './analytics';
import { type Example } from './examples';
import { detectOnOpen } from './state/detection';
import { type ImportSummary, type OpenStorage, editorStore } from './state/editorStore';

/** What the file pickers offer: every format `readSequenceData` reads. */
export const SEQUENCE_FILE_ACCEPT =
  '.gb,.gbk,.genbank,.gbff,.gp,.gpff,.ape,.fa,.fasta,.fna,.faa,.seq,.txt,.dna,.prot,.rna,.ab1,.abi,.fastq,.fq,.gz,.zip';

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
  // An archive is a batch of its own, reported as one (#213).
  if (isZip(new Uint8Array(data, 0, Math.min(4, data.byteLength)))) {
    await importFiles([file]);
    return null;
  }
  try {
    const id = editorStore.openParsed(await readSequenceData(data, file.name), file.name);
    // A bare FASTA or an unannotated record: the common parts, if asked (item 59).
    detectOnOpen(id);
    return id;
  } catch (e) {
    analytics.track('file', 'open-failed', formatOfFileName(file.name));
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * What File ▸ Open and a drop hand over: one file opens as `openFile` always
 * did; several files, or a ZIP, are imported together and reported in one
 * summary (#213).
 */
export async function openFiles(files: readonly File[]): Promise<void> {
  const [only] = files;
  if (only === undefined) return;
  if (files.length === 1) {
    await openFile(only);
    return;
  }
  await importFiles(files);
}

/** A folder path becomes the document's keywords, so a Benchling folder survives the import. */
function withFolder(doc: SeqDocument, folder: string | null): SeqDocument {
  if (folder === null) return doc;
  const keywords = doc.metadata.keywords;
  if (keywords.split(/;\s*/).includes(folder)) return doc;
  return doc.setMetadata({ keywords: keywords === '' ? folder : `${keywords}; ${folder}` });
}

/**
 * Opens every sequence in `files`, unzipping any ZIP among them, each in a tab
 * of its own, and puts up one summary of what came in and what did not.
 */
async function importFiles(files: readonly File[]): Promise<void> {
  const records: ArchiveRecord[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const file of files) {
    let data: ArrayBuffer;
    try {
      data = await file.arrayBuffer();
    } catch {
      skipped.push({ name: file.name, reason: 'Could not be read' });
      continue;
    }
    try {
      if (isZip(new Uint8Array(data, 0, Math.min(4, data.byteLength)))) {
        const archive = await readSequenceArchive(data);
        records.push(...archive.records);
        for (const s of archive.skipped) {
          skipped.push({ name: `${file.name}: ${s.path}`, reason: s.reason });
        }
      } else {
        const result = await readSequenceData(data, file.name);
        const doc = result.documents[0];
        if (doc === undefined) throw new FormatError('The file contains no sequences');
        records.push({
          path: file.name,
          fileName: file.name,
          folder: null,
          format: result.format,
          document: doc,
          warnings: [
            ...result.warnings,
            ...(result.documents.length > 1
              ? [{ message: `Only the first of ${result.documents.length} records was opened.` }]
              : []),
          ],
        });
      }
    } catch (e) {
      analytics.track('file', 'open-failed', formatOfFileName(file.name));
      skipped.push({ name: file.name, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const before = new Set(editorStore.getState().documents.map((d) => d.documentId));
  const seen = new Set<string>();
  let alreadyOpen = 0;
  const warnings: { name: string; messages: string[] }[] = [];
  for (const record of records) {
    const id = editorStore.openParsed(
      {
        format: record.format,
        documents: [withFolder(record.document, record.folder)],
        warnings: record.warnings,
      },
      record.fileName,
    );
    if (id === null) continue;
    if (before.has(id) || seen.has(id)) alreadyOpen++;
    seen.add(id);
    if (record.warnings.length > 0) {
      warnings.push({
        name:
          record.document.name === '' ? record.path : `${record.document.name} (${record.path})`,
        messages: record.warnings.map((w) => w.message),
      });
    }
  }
  const archives = files.filter((f) => /\.zip$/i.test(f.name));
  const source =
    files.length === 1 && archives.length === 1
      ? (archives[0]?.name ?? '')
      : `${files.length} files`;
  const summary: ImportSummary = {
    source,
    opened: seen.size - [...seen].filter((id) => before.has(id)).length,
    alreadyOpen,
    skipped,
    warnings,
  };
  editorStore.noteImport(summary);
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
