import { type MoleculeAlignment } from '@/core';
import { readSequenceData } from '@/io';

import { analytics } from './analytics';
import { editorStore } from './state/editorStore';

/**
 * Reads a file the user picked and shows how the document in front differs
 * from it. The file is not opened as a tab and nothing about it is stored:
 * it is read, diffed and dropped (unless the dialog is asked to open it),
 * which is what makes this safe to point at a colleague's copy of the plasmid.
 */
export async function compareWithFile(file: File): Promise<boolean> {
  if (editorStore.document === null) return false;
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch {
    editorStore.fail(`Could not read “${file.name}”.`);
    return false;
  }
  try {
    const result = await readSequenceData(data, file.name);
    const other = result.documents[0];
    if (other === undefined) {
      editorStore.fail(`“${file.name}” contains no sequences.`);
      return false;
    }
    analytics.track('file', 'compare', result.format);
    analytics.track('compare', 'target', 'file');
    // The file itself is kept, not a document made of it, so "Open" in the
    // dialog reads it again the way File ▸ Open does, origin and all.
    editorStore.showComparison(file.name, other, { kind: 'file', file });
    return true;
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return false;
  }
}

/**
 * What had to be done to the other file's copy before the two could be
 * compared at all, said in the dialog above the differences.
 *
 * Turning it is not a detail to leave out: the reader is being shown a diff
 * against something other than what the file literally says, and the whole
 * point of comparing was to trust the answer.
 */
export function describeAlignment(alignment: MoleculeAlignment, fileName: string): string {
  const turn =
    alignment.origin > 0 && alignment.flipped
      ? `read from the other strand and rotated to base ${(alignment.origin + 1).toLocaleString()}`
      : alignment.flipped
        ? 'read from the other strand'
        : `rotated to base ${(alignment.origin + 1).toLocaleString()}`;
  const same = alignment.exact
    ? `${fileName} holds this same molecule written another way`
    : `${fileName} looks like this molecule written another way`;
  return `${same}, so it has been ${turn} before comparing. The differences below are what is left once they line up.`;
}
