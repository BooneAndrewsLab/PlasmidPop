import { type DerivedFrom } from '@/core';

/**
 * Where a document came from, in a GenBank file.
 *
 * A working copy is forked off the file it was opened from and the original
 * is never written to (item 22), which answers "has my file been altered"
 * inside this browser. It does not answer it for the file that then leaves
 * the browser as a download: someone holding `pBR322 copy.gb` has no way to
 * tell what it was a copy *of*.
 *
 * So a copy carries the checksum of the molecule it was forked from, and the
 * name of the file that held it, as one COMMENT line:
 *
 *     PlasmidPop-derived-from: cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A pBR322.gb
 *
 * The checksum is the load-bearing half. A file name is what someone called
 * a file once; a `cdseguid` is the molecule itself, and stays true however
 * the original is rotated, renamed or re-exported — so a reader can put the
 * original alongside and *check*, rather than take the line's word for it.
 *
 * Like `PlasmidPop-ends:`, it is taken out of the comments on read and put
 * back on write, so a file does not collect copies of the line, and other
 * software sees an ordinary comment it can ignore.
 */
const PREFIX = 'PlasmidPop-derived-from:';

/** A checksum as `seguid.ts` writes one: a known prefix and 27 base64url characters. */
const CHECKSUM = /^((?:ls|cs|ld|cd)seguid=[A-Za-z0-9_-]{27})(?:\s+(.*))?$/;

export function formatDerivedComment(derived: DerivedFrom): string {
  const name = derived.fileName.trim();
  return `${PREFIX} ${derived.checksum}${name === '' ? '' : ` ${name}`}`;
}

/** What a `PlasmidPop-derived-from:` comment says, or null if it is not one (or is damaged). */
export function parseDerivedComment(comment: string): DerivedFrom | null {
  const text = comment.trim();
  if (!text.startsWith(PREFIX)) return null;
  const m = CHECKSUM.exec(text.slice(PREFIX.length).trim());
  if (m === null) return null;
  const checksum = m[1];
  if (checksum === undefined) return null;
  return { checksum, fileName: m[2]?.trim() ?? '' };
}

/** Whether a comment is ours, so the writer can add its own copy without duplicating. */
export function isDerivedComment(comment: string): boolean {
  return comment.trim().startsWith(PREFIX);
}
