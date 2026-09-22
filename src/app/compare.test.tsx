// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { writeGenBank } from '@/io';
import { getRepository } from '@/storage';

import { App } from './App';
import { compareWithFile } from './compare';
import { editorStore } from './state/editorStore';

function gbFile(name: string, text: string): File {
  return new File([text], name, { type: 'text/plain' });
}

/** The open document written out, with `mutate` applied to the text first. */
function fileFromOpenDocument(name: string, mutate: (text: string) => string): File {
  const doc = editorStore.document;
  if (doc === null) throw new Error('expected a document');
  return gbFile(name, mutate(writeGenBank(doc)));
}

beforeEach(() => {
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  localStorage.removeItem('plasmidpop.viewPrefs');
  act(() => {
    editorStore.closeAllDocuments();
  });
});

describe('Compare with…', () => {
  it('reads a file, says how the document differs from it, and opens nothing', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.getState().documents.length;
    // The same record with ten bases gone from the middle of the first line
    // of the sequence, which is a deletion the review should find.
    const file = fileFromOpenDocument('pBR322-other.gb', (text) =>
      text.replace(/^ {8}1 (\w{10})/m, '        1 '),
    );
    await act(async () => {
      await compareWithFile(file);
    });
    const dialog = await screen.findByRole('dialog', { name: /compared with/ });
    expect(dialog.textContent).toContain('pBR322-other.gb');
    expect(dialog.textContent).toMatch(/\+10 bp|inserted 10 bp/);
    // Nothing was opened: the comparison is a read, not a tab.
    expect(editorStore.getState().documents).toHaveLength(before);
    expect(editorStore.getState().comparison?.fileName).toBe('pBR322-other.gb');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(editorStore.getState().comparison).toBeNull();
  });

  it('says plainly when the file holds the same document', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const file = fileFromOpenDocument('same.gb', (text) => text);
    await act(async () => {
      await compareWithFile(file);
    });
    const dialog = await screen.findByRole('dialog', { name: /compared with/ });
    expect(dialog.textContent).toContain('Nothing differs');
  });

  it('reports a file it cannot read without opening a comparison', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    await act(async () => {
      await compareWithFile(gbFile('junk.gb', 'this is not a sequence at all!!'));
    });
    expect(editorStore.getState().comparison).toBeNull();
    await waitFor(() => {
      expect(editorStore.getState().error).not.toBeNull();
    });
  });

  it('picks the file through the toolbar input where there is no file picker', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const file = fileFromOpenDocument('picked.gb', (text) => text.replace('pBR322', 'pBR322x'));
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="File to compare with"]',
    );
    if (input === null) throw new Error('no compare input');
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
    const dialog = await screen.findByRole('dialog', { name: /compared with/ });
    expect(dialog.textContent).toContain('picked.gb');
  });
});
