import { type SeqDocument } from '@/core';

import { readSequenceData } from './detect';
import { type FormatId, type ParseWarning, FormatError } from './types';
import { type ZipLimits, readZip } from './zip';

/** One sequence read from a file inside an archive. */
export interface ArchiveRecord {
  /** The file's path inside the archive. */
  readonly path: string;
  /** The file's name without its folders. */
  readonly fileName: string;
  /** The folders it sat in, `a/b`, or null at the top. */
  readonly folder: string | null;
  readonly format: FormatId;
  readonly document: SeqDocument;
  readonly warnings: readonly ParseWarning[];
}

export interface ArchiveSkipped {
  readonly path: string;
  readonly reason: string;
}

export interface ArchiveImport {
  readonly records: readonly ArchiveRecord[];
  readonly skipped: readonly ArchiveSkipped[];
}

/** Reads need their own tools, so only the first record of a read file comes in. */
const ONE_RECORD_FORMATS: ReadonlySet<FormatId> = new Set(['fastq', 'abif']);

function splitPath(path: string): { fileName: string; folder: string | null } {
  const cut = path.lastIndexOf('/');
  // Stryker disable next-line EqualityOperator: a path never starts with a slash here (readZip skips those), so cut is never 0
  return cut < 0
    ? { fileName: path, folder: null }
    : { fileName: path.slice(cut + 1), folder: path.slice(0, cut) };
}

/**
 * Reads every sequence file in a ZIP archive, such as a Benchling bulk
 * export (#213). A file that cannot be read is left out and listed with why;
 * it never stops the rest. Sorted by path, so the order is the archive's own
 * folders and not the order the exporter happened to write them in.
 */
export async function readSequenceArchive(
  data: ArrayBuffer | Uint8Array,
  limits?: ZipLimits,
): Promise<ArchiveImport> {
  const zip = readZip(data, limits);
  const records: ArchiveRecord[] = [];
  const skipped: ArchiveSkipped[] = [...zip.skipped];
  const entries = [...zip.entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of entries) {
    const { fileName, folder } = splitPath(entry.path);
    // A copy, since the parser may hand the buffer on and the entry's view
    // can sit inside a larger one.
    // Stryker disable next-line MethodExpression: fflate already hands back a fresh exactly-sized array, so the copy is defensive
    const buffer = entry.data.slice().buffer;
    try {
      const result = await readSequenceData(buffer, fileName);
      // Stryker disable BlockStatement,ConditionalExpression,ObjectLiteral,StringLiteral: every parser throws on a file with no records, so this guard is defensive and cannot be reached
      if (result.documents.length === 0) {
        skipped.push({ path: entry.path, reason: 'The file contains no sequences' });
        continue;
      }
      // Stryker restore BlockStatement,ConditionalExpression,ObjectLiteral,StringLiteral
      const only = ONE_RECORD_FORMATS.has(result.format);
      const documents = only ? result.documents.slice(0, 1) : result.documents;
      const extra: ParseWarning[] =
        only && result.documents.length > 1
          ? [{ message: `Only the first of ${result.documents.length} records was imported.` }]
          : [];
      for (const document of documents) {
        records.push({
          path: entry.path,
          fileName,
          folder,
          format: result.format,
          document,
          warnings: [...result.warnings, ...extra],
        });
      }
    } catch (e) {
      const reason =
        e instanceof FormatError
          ? // Stryker disable next-line Regex: dropping the anchor changes nothing, the suffix is always the message's end
            e.message.replace(/ for ".*"$/, '')
          : e instanceof Error
            ? e.message
            : String(e);
      skipped.push({ path: entry.path, reason });
    }
  }
  return { records, skipped };
}
