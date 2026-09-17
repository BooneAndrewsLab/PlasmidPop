import { parseSequenceFile } from '@/io';

import { editorStore } from './state/editorStore';

const UNSUPPORTED: Readonly<Record<string, string>> = {
  dna: 'SnapGene .dna files are not supported yet. Export the file as GenBank from SnapGene and open that.',
  geneious: 'Geneious files are not supported yet. Export as GenBank first.',
};

/** Reads a file the user picked or dropped and shows it, or shows why it could not be read. */
export async function openFile(file: File): Promise<void> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  const unsupported = UNSUPPORTED[ext];
  if (unsupported !== undefined) {
    editorStore.fail(unsupported);
    return;
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    editorStore.fail(`Could not read "${file.name}".`);
    return;
  }
  openText(text, file.name);
}

export function openText(text: string, fileName: string | null): void {
  try {
    editorStore.openParsed(parseSequenceFile(text, fileName ?? undefined), fileName);
  } catch (e) {
    editorStore.fail(e instanceof Error ? e.message : String(e));
  }
}
