// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { PlasmidPopDb, DocumentRepository } from '@/storage';

import { FileMenu } from './components/FileMenu';
import { InexactNotice } from './components/InexactNotice';
import { openText } from './openFile';
import { editorStore } from './state/editorStore';
import { PersistenceService } from './state/persistence';

/** Saving says which features were not written as read (#464). */

function gb(feature: string): string {
  return [
    'LOCUS       T          60 bp    DNA     linear   SYN 01-JAN-2000',
    'FEATURES             Location/Qualifiers',
    feature,
    'ORIGIN',
    '        1 acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt acgtacgtac gtacgtacgt',
    '//',
    '',
  ].join('\n');
}

const TRANS = gb(`     CDS             join(complement(5..10),20..30)
                     /gene="rps12"`);
const REMOTE = gb(`     gene            join(1..10,AF032048.1:67..345)
                     /gene="remoteGene"`);
const PLAIN = gb(`     gene            1..10
                     /gene="a"`);

async function saveGenBank(): Promise<number> {
  const service = new PersistenceService(
    new DocumentRepository(new PlasmidPopDb(`inexact-${Date.now()}-${Math.random()}`)),
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  await act(async () => {
    await service.download();
  });
  return click.mock.calls.length;
}

describe('the save notice for features not written as read', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.dismissInexactNotice();
    });
  });

  it('names a trans-spliced feature after a GenBank save', async () => {
    render(<InexactNotice />);
    act(() => {
      openText(TRANS, 'rps12.gb');
    });
    expect(await saveGenBank()).toBe(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      /Saved\. 1 feature can’t be written exactly as read: CDS rps12 \(trans-spliced/,
    );
  });

  it('names a feature left out for its remote location', async () => {
    render(<InexactNotice />);
    act(() => {
      openText(REMOTE, 'remote.gb');
    });
    await saveGenBank();
    expect(screen.getByRole('status')).toHaveTextContent(/gene remoteGene \(not read/);
  });

  it('says nothing for a file without such features', async () => {
    render(<InexactNotice />);
    act(() => {
      openText(PLAIN, 'plain.gb');
    });
    await saveGenBank();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is said once per save and goes on Dismiss', async () => {
    render(<InexactNotice />);
    act(() => {
      openText(TRANS, 'rps12.gb');
    });
    await saveGenBank();
    await saveGenBank();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is not said for a FASTA export', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    render(<InexactNotice />);
    act(() => {
      openText(TRANS, 'rps12.gb');
    });
    const doc = editorStore.document;
    if (doc === null) throw new Error('not opened');
    render(<FileMenu doc={doc} onOpenFile={() => undefined} onCompare={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export sequence as FASTA' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
