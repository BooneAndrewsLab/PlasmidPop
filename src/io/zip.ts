import { unzipSync, zipSync } from 'fflate';

import { FormatError } from './types';

/**
 * Reading a ZIP archive, behind our own interface (#213). The library is
 * fflate (MIT); nothing outside this file names it, so a second reader, such
 * as the restore of a backup (#203), asks this one and not the library.
 *
 * An archive comes from outside, so it is read defensively: the entry count
 * and the sizes are checked against the directory before anything is
 * inflated, and a bomb costs a refusal rather than the tab's memory.
 */

export interface ZipLimits {
  /** Most entries (files) the archive may hold. */
  readonly maxEntries: number;
  /** Largest a single file may be once inflated, in bytes. */
  readonly maxEntryBytes: number;
  /** Largest all the files together may be once inflated, in bytes. */
  readonly maxTotalBytes: number;
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxEntryBytes: 64 * 1024 * 1024,
  maxTotalBytes: 512 * 1024 * 1024,
};

export interface ZipEntry {
  /** The entry's path inside the archive, with `/` separators. */
  readonly path: string;
  readonly data: Uint8Array;
}

export interface ZipSkipped {
  readonly path: string;
  readonly reason: string;
}

export interface ZipContents {
  readonly entries: readonly ZipEntry[];
  /** Entries left unread, with why: too large, or a name that is not a file's. */
  readonly skipped: readonly ZipSkipped[];
}

/** Whether the bytes begin like a ZIP archive (a local header, or an empty one's end record). */
export function isZip(bytes: Uint8Array): boolean {
  return (
    // Stryker disable next-line ConditionalExpression: a shorter array reads undefined past its end, which fails the byte tests anyway
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    ((bytes[2] === 0x03 && bytes[3] === 0x04) || (bytes[2] === 0x05 && bytes[3] === 0x06))
  );
}

/**
 * Entries that are not the user's files: folders, and what macOS and Windows
 * add when they make an archive (`__MACOSX/`, `.DS_Store`, `Thumbs.db`,
 * dot-files). They are dropped without a word.
 */
function isNoise(path: string): boolean {
  if (path.endsWith('/')) return true;
  const parts = path.split('/');
  // Stryker disable next-line StringLiteral: split always returns one part, so the fallback is never taken
  const base = parts[parts.length - 1] ?? '';
  return parts[0] === '__MACOSX' || base.startsWith('.') || base.toLowerCase() === 'thumbs.db';
}

/** Whether a path would leave the folder it is extracted into. */
function isUnsafe(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.split('/').includes('..');
}

/**
 * Reads every file in the archive, within `limits`. An archive that is not
 * one, or is damaged, or holds more than the limits allow, throws a
 * `FormatError`; a single entry that is too large, or named unsafely, is
 * left out and reported in `skipped`.
 */
export function readZip(
  data: ArrayBuffer | Uint8Array,
  limits: ZipLimits = DEFAULT_ZIP_LIMITS,
): ZipContents {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (!isZip(bytes)) throw new FormatError('This is not a ZIP archive');
  const skipped: ZipSkipped[] = [];
  let seen = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter(info) {
        const path = info.name.replace(/\\/g, '/');
        if (isNoise(path)) return false;
        seen++;
        if (seen > limits.maxEntries) {
          throw new FormatError(
            `The archive holds more than ${limits.maxEntries.toLocaleString()} files`,
          );
        }
        if (isUnsafe(path)) {
          skipped.push({ path, reason: 'The name points outside the archive' });
          return false;
        }
        if (info.originalSize > limits.maxEntryBytes) {
          skipped.push({ path, reason: 'Too large to open' });
          return false;
        }
        total += info.originalSize;
        if (total > limits.maxTotalBytes) {
          throw new FormatError('The archive is too large to open: it expands to too much data');
        }
        return true;
      },
    });
  } catch (e) {
    if (e instanceof FormatError) throw e;
    throw new FormatError('This ZIP archive is damaged or uses an unsupported method');
  }
  const entries = Object.entries(files).map(([name, content]) => ({
    path: name.replace(/\\/g, '/'),
    data: content,
  }));
  return { entries, skipped };
}

/**
 * Writes the entries as a ZIP archive (#203), deflated. Paths use `/`; a
 * path that is empty, absolute or leaves the archive is a programming error
 * and throws, so what is written is always something `readZip` accepts.
 */
export function writeZip(entries: readonly ZipEntry[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const { path, data } of entries) {
    // Stryker disable next-line MethodExpression: isNoise already rejects a path ending in a slash, so the endsWith test is redundant
    if (path === '' || path.endsWith('/') || isUnsafe(path) || isNoise(path)) {
      throw new Error(`Not a path a ZIP file can hold: "${path}"`);
    }
    if (path in files) throw new Error(`Two entries are named "${path}"`);
    files[path] = data;
  }
  // Stryker disable next-line ObjectLiteral: 6 is fflate's default level, so the option is only explicit
  return zipSync(files, { level: 6 });
}
