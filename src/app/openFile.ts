import { type SeqDocument } from '@/core';
import {
  type ArchiveRecord,
  type OpenFailureReason,
  type ParseResult,
  FormatError,
  isZip,
  openFailureReason,
  parseSequenceFile,
  readSequenceArchive,
  readSequenceData,
} from '@/io';

import { analytics, openFailedName } from './analytics';
import { type Example } from './examples';
import { openFailureFacts } from './reportProblem';
import { detectOnOpen } from './state/detection';
import { type ImportSummary, type OpenStorage, editorStore } from './state/editorStore';

/** What the file pickers offer: every format `readSequenceData` reads. */
export const SEQUENCE_FILE_ACCEPT =
  '.gb,.gbk,.genbank,.gbff,.gp,.gpff,.ape,.fa,.fasta,.fna,.faa,.seq,.txt,.dna,.prot,.rna,.ab1,.abi,.fastq,.fq,.gz,.zip';

/** What every refusal that is about the kind of file ends with: what would have worked. */
export const ACCEPTED_FORMATS =
  'PlasmidPop opens GenBank (.gb .gbk .gbff .ape), GenPept (.gp .gpff), FASTA (.fa .fasta .fna .faa .txt), SnapGene (.dna .rna .prot), AB1 (.ab1 .abi), FASTQ (.fastq .fq, gzipped or not), bare bases, and ZIPs of these.';

/** The reasons whose message is better for naming the formats that are accepted. */
const NAMES_FORMATS: ReadonlySet<OpenFailureReason> = new Set([
  'unrecognised-format',
  'binary',
  'empty',
]);

/** The message for a failed open, and the reason to report with it. */
export function describeOpenFailure(e: unknown): { message: string; reason: OpenFailureReason } {
  const reason = openFailureReason(e);
  const message = e instanceof Error ? e.message : String(e);
  return {
    message: NAMES_FORMATS.has(reason)
      ? `${message.replace(/\.$/, '')}. ${ACCEPTED_FORMATS}`
      : message,
    reason,
  };
}

const UNSUPPORTED: Readonly<Record<string, string>> = {
  geneious: 'Geneious files are not supported yet. Export as GenBank first.',
};

/** How an open may behave when something about the file needs the user's say (#462). */
export interface OpenOptions {
  /**
   * Ask how to open a GenBank record that says linear but has features across
   * the end of the sequence. Only a caller that has someone at the screen
   * sets it (File ▸ Open, a drop, a paste); the share target, the launch
   * queue, a restore and a scripted open leave it off and get the record
   * as the file says, with those features dropped and a warning.
   */
  readonly askTopology?: boolean;
}

/**
 * Asks the user how to open a result whose record says linear but has
 * features across its end (#462), and says what to do with the answer: the
 * result to open (read again as circular if that was the choice), or null for
 * Cancel. A result without such features is returned as it is, unasked.
 * Only the first record opens, so only its count is asked about.
 */
async function resolveTopology(
  result: ParseResult,
  reread: () => Promise<ParseResult> | ParseResult,
): Promise<ParseResult | null> {
  const features = result.originSpanning?.[0] ?? 0;
  if (features === 0) return result;
  const choice = await editorStore.askTopology(features);
  analytics.track('file', 'open-topology', choice);
  if (choice === 'cancel') return null;
  return choice === 'circular' ? await reread() : result;
}

/**
 * Reads a file the user picked or dropped and opens it in a new tab,
 * returning the document's id, or shows why it could not be read and
 * returns null.
 */
export async function openFile(file: File, options: OpenOptions = {}): Promise<string | null> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const unsupported = UNSUPPORTED[ext];
  if (unsupported !== undefined) {
    analytics.track('file', 'open-failed', openFailedName(file.name, 'unsupported'));
    editorStore.failOpen(unsupported, openFailureFacts('unsupported', { fileName: file.name }));
    return null;
  }
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    analytics.track('file', 'open-failed', openFailedName(file.name, 'unreadable'));
    editorStore.failOpen(
      `Could not read "${file.name}".`,
      openFailureFacts('unreadable', { fileName: file.name }),
    );
    return null;
  }
  // An archive is a batch of its own, reported as one (#213).
  if (isZip(new Uint8Array(data, 0, Math.min(4, data.byteLength)))) {
    await importFiles([file]);
    return null;
  }
  try {
    let result = await readSequenceData(data, file.name);
    if (options.askTopology === true) {
      const chosen = await resolveTopology(result, () =>
        readSequenceData(data, file.name, { wrappingAsCircular: true }),
      );
      if (chosen === null) return null;
      result = chosen;
    }
    const id = editorStore.openParsed(result, file.name);
    // A bare FASTA or an unannotated record: the common parts, if asked (item 59).
    detectOnOpen(id);
    return id;
  } catch (e) {
    const failure = describeOpenFailure(e);
    analytics.track('file', 'open-failed', openFailedName(file.name, failure.reason));
    editorStore.failOpen(
      failure.message,
      openFailureFacts(failure.reason, { fileName: file.name, bytes: new Uint8Array(data) }, e),
    );
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
    await openFile(only, { askTopology: true });
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
      const failure = describeOpenFailure(e);
      analytics.track('file', 'open-failed', openFailedName(file.name, failure.reason));
      skipped.push({ name: file.name, reason: failure.message });
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
    editorStore.failOpen(
      e instanceof Error ? e.message : String(e),
      openFailureFacts(openFailureReason(e), { fileName, text }, e),
    );
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
      editorStore.failOpen(
        'Pasted text is not a GenBank or FASTA record and contains characters outside the IUPAC nucleotide alphabet.',
        openFailureFacts(e.reason, { fileName: null, text }, e),
      );
      return;
    }
    editorStore.failOpen(
      e instanceof Error ? e.message : String(e),
      openFailureFacts(openFailureReason(e), { fileName: null, text }, e),
    );
    return;
  }
  // A pasted record that says linear but runs features across its end asks
  // first (#462); anything else opens at once, as it always did.
  if ((result.originSpanning?.[0] ?? 0) > 0) {
    void resolveTopology(result, () =>
      parseSequenceFile(text, undefined, { wrappingAsCircular: true }),
    ).then((chosen) => {
      if (chosen !== null) editorStore.openParsed(chosen, null);
    });
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
