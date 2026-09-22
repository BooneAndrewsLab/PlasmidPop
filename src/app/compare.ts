import { parseSequenceData } from '@/io';

import { analytics } from './analytics';
import { editorStore } from './state/editorStore';

/**
 * Reads a file the user picked and shows how the document in front differs
 * from it. The file is not opened as a tab and nothing about it is stored:
 * it is read, diffed and dropped, which is what makes this safe to point at
 * a colleague's copy of the plasmid.
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
    const result = parseSequenceData(data, file.name);
    const other = result.documents[0];
    if (other === undefined) {
      editorStore.fail(`“${file.name}” contains no sequences.`);
      return false;
    }
    analytics.track('file', 'compare', result.format);
    editorStore.showComparison(file.name, other);
    return true;
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
    return false;
  }
}
