import { type LineageNode, type SeqDocument, lineageChecksum, lineageChecksums } from '@/core';

/**
 * Where the browser holds a molecule a lineage names (#67): an open tab, or
 * a document in local storage whose tab is closed.
 */
export type HeldVersion =
  { readonly kind: 'tab'; readonly id: string } | { readonly kind: 'stored'; readonly id: string };

const checksums = new WeakMap<SeqDocument, string | null>();

/**
 * A document's checksum, worked out once per document object. Documents are
 * immutable, so the answer cannot go stale, and the open tabs are looked up
 * on every render of the tree.
 */
export function cachedChecksum(doc: SeqDocument): string | null {
  if (checksums.has(doc)) return checksums.get(doc) ?? null;
  const checksum = lineageChecksum(doc);
  checksums.set(doc, checksum);
  return checksum;
}

/** The checksums a lineage's tree names below its root: the ones worth looking for. */
export function ancestorChecksums(lineage: LineageNode): string[] {
  const own = lineage.checksum;
  return lineageChecksums(lineage).filter((c) => c !== own);
}

/**
 * The open tabs holding each of `wanted`, as checksum → tab, leaving out the
 * document the tree belongs to: its own tab is where you are. The first tab
 * in the strip wins a tie.
 */
export function heldInTabs(
  tabs: readonly { readonly documentId: string; readonly doc: SeqDocument }[],
  wanted: readonly string[],
  exceptId: string | null,
): Map<string, HeldVersion> {
  const want = new Set(wanted);
  const out = new Map<string, HeldVersion>();
  for (const tab of tabs) {
    if (tab.documentId === exceptId) continue;
    const checksum = cachedChecksum(tab.doc);
    if (checksum !== null && want.has(checksum) && !out.has(checksum)) {
      out.set(checksum, { kind: 'tab', id: tab.documentId });
    }
  }
  return out;
}

/** The tabs' answers, then storage's for what no tab holds, never the tree's own document. */
export function mergeHeld(
  inTabs: ReadonlyMap<string, HeldVersion>,
  stored: ReadonlyMap<string, string>,
  exceptId: string | null,
): Map<string, HeldVersion> {
  const out = new Map(inTabs);
  for (const [checksum, id] of stored) {
    if (id !== exceptId && !out.has(checksum)) out.set(checksum, { kind: 'stored', id });
  }
  return out;
}

/** A checksum's short form, as the status bar shows one: its kind and six characters. */
export function shortChecksum(checksum: string): string {
  const eq = checksum.indexOf('=');
  return eq < 0
    ? checksum.slice(0, 6)
    : `${checksum.slice(0, eq)} ${checksum.slice(eq + 1, eq + 7)}`;
}
