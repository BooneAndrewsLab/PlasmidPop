// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';

import { openFiles } from './openFile';
import { editorStore } from './state/editorStore';

const GB = (name: string, seq: string): string =>
  `LOCUS       ${name}  ${seq.length} bp    DNA     circular SYN 01-JAN-2020\nORIGIN\n        1 ${seq}\n//\n`;

function zipFile(name: string, files: Record<string, string>): File {
  const bytes = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
  return new File([bytes.slice().buffer], name);
}

describe('openFiles (#213)', () => {
  beforeEach(() => {
    editorStore.closeAllDocuments();
    editorStore.dismissImportSummary();
  });

  it('opens each sequence in a ZIP in a tab and summarises what it left out', async () => {
    await openFiles([
      zipFile('export.zip', {
        'F/pA.gb': GB('pA', 'acgtacgtac'),
        'F/pB.gb': GB('pB', 'ggggcccc'),
        'readme.csv': 'a,b\n',
      }),
    ]);
    const state = editorStore.getState();
    expect(state.documents.map((d) => d.history.present.name).sort()).toEqual(['pA', 'pB']);
    expect(state.documents[0]?.history.present.metadata.keywords).toBe('F');
    expect(state.importSummary).toMatchObject({ source: 'export.zip', opened: 2, alreadyOpen: 0 });
    expect(state.importSummary?.skipped.map((s) => s.name)).toEqual(['export.zip: readme.csv']);
  });

  it('opens several plain files together, and says a damaged one was skipped', async () => {
    await openFiles([
      new File([GB('pC', 'acgtacgtac')], 'c.gb'),
      new File(['not a sequence at all, sorry'], 'bad.txt'),
    ]);
    const summary = editorStore.getState().importSummary;
    expect(summary).toMatchObject({ source: '2 files', opened: 1 });
    expect(summary?.skipped.map((s) => s.name)).toEqual(['bad.txt']);
  });

  it('does not open the same file twice', async () => {
    const file = zipFile('x.zip', { 'a/p.gb': GB('p', 'acgtacgt'), 'b/p.gb': GB('p', 'acgtacgt') });
    await openFiles([file]);
    expect(editorStore.getState().documents).toHaveLength(1);
    expect(editorStore.getState().importSummary).toMatchObject({ opened: 1, alreadyOpen: 1 });
  });
});
