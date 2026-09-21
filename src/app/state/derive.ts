/**
 * Naming for the working copy a document becomes when the file it was opened
 * from is edited. The original file is never written back to, so the copy
 * needs a name of its own to be saved under; see `EditorStore.apply`.
 */

/**
 * A trailing "copy", with or without a number, so copies do not stack up.
 * It may be the whole name, which leaves nothing to build on and falls back
 * to `Untitled`.
 */
const COPY_SUFFIX = /(?:^|\s+)copy(?:\s+\d+)?$/i;

/**
 * A name for a copy of `name` that no name in `taken` already uses:
 * `pBR322` becomes `pBR322 copy`, then `pBR322 copy 2`, and a copy of
 * `pBR322 copy` is numbered rather than named `pBR322 copy copy`.
 *
 * Matching ignores case, because two documents whose names differ only in
 * case are two tabs the user cannot tell apart.
 */
export function copyNameFor(name: string, taken: Iterable<string> = []): string {
  const trimmed = name.trim();
  const stem = (trimmed === '' ? 'Untitled' : trimmed).replace(COPY_SUFFIX, '');
  const base = stem === '' ? 'Untitled' : stem;
  const used = new Set([...taken].map((t) => t.trim().toLowerCase()));
  let candidate = `${base} copy`;
  for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base} copy ${n}`;
  return candidate;
}
