import { type AssemblyPart, type DigestFragment } from '@/core';

/**
 * What makes two fragments the same piece for the shelf's "On shelf" count:
 * the document it was cut from, where in it, and the enzymes at its ends.
 * Turning a part over on the Bench swaps its ends and rewrites its strands,
 * and dephosphorylating it clears a flag, but it is still the piece that was
 * added, so the ends are compared as a set and the rest is left out.
 */
function pieceKey(f: DigestFragment): string {
  const ends = [f.left.enzyme ?? '', f.right.enzyme ?? ''].sort().join('+');
  return `${f.source}\u0000${String(f.range.start)}-${String(f.range.end)}\u0000${ends}`;
}

/** How many copies of `fragment` the shelf holds, counting parts turned over or treated since. */
export function copiesOnShelf(shelf: readonly AssemblyPart[], fragment: DigestFragment): number {
  const key = pieceKey(fragment);
  return shelf.filter((p) => pieceKey(p.fragment) === key).length;
}
