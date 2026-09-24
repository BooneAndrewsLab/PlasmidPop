// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument } from '@/core';
import { writeGenBank } from '@/io';
import { getRepository } from '@/storage';

import { App } from './App';
import { compareWithFile } from './compare';
import { editDiffOf } from './state/editDiff';
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
    expect(editorStore.getState().comparison).toMatchObject({
      stage: 'review',
      name: 'pBR322-other.gb',
    });

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

  it('lines a rotated plasmid up instead of calling it different throughout', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const doc = editorStore.document;
    if (doc === null) throw new Error('expected a document');
    // The same plasmid, written from an origin 1,000 bases along: not one
    // line of it is the same text, and every base of it is the same molecule.
    const file = gbFile('pBR322-rotated.gb', writeGenBank(doc.setOrigin(1000)));
    await act(async () => {
      await compareWithFile(file);
    });
    const dialog = await screen.findByRole('dialog', { name: /compared with/ });
    expect(dialog.textContent).toContain('rotated to base');
    expect(dialog.textContent).toContain('Nothing else differs');
    // And it says so with the checksum, which is the same for both.
    const checksums = dialog.textContent.match(/cdseguid=[A-Za-z0-9_-]{27}/g) ?? [];
    expect(checksums).toHaveLength(2);
    expect(checksums[0]).toBe(checksums[1]);
  });

  it('shows both checksums when the two files are not the same molecule', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const file = fileFromOpenDocument('pBR322-other.gb', (text) =>
      text.replace(/^ {8}1 (\w{10})/m, '        1 '),
    );
    await act(async () => {
      await compareWithFile(file);
    });
    const dialog = await screen.findByRole('dialog', { name: /compared with/ });
    const checksums = dialog.textContent.match(/cdseguid=[A-Za-z0-9_-]{27}/g) ?? [];
    expect(checksums).toHaveLength(2);
    expect(checksums[0]).not.toBe(checksums[1]);
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

/** A second tab beside the example: the example with ten bases gone. */
function openShortenedCopy(name: string): string {
  const doc = editorStore.document;
  if (doc === null) throw new Error('expected a document');
  let id = '';
  act(() => {
    id = editorStore.openDocument(doc.delete({ start: 100, end: 110 }).rename(name));
  });
  return id;
}

describe('Compare with… another tab', () => {
  it('asks which tab, lists the others and not the one in front', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    openShortenedCopy('shorter');
    act(() => {
      editorStore.openDocument(SeqDocument.create({ name: 'third', sequence: 'ACGTACGT' }));
    });
    fireEvent.keyDown(window, { code: 'KeyK', altKey: true });
    const chooser = screen.getByRole('dialog', { name: /Compare “third” with/ });
    const list = within(chooser).getByRole('list', { name: 'Other open documents' });
    const names = within(list)
      .getAllByRole('button')
      .map((b) => b.querySelector('.compare-choices__name')?.textContent);
    expect(names).toEqual(['SYNPBR322', 'shorter']);
    expect(within(chooser).getByRole('button', { name: 'A file on disk…' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(editorStore.getState().comparison).toBeNull();
  });

  it('compares with the tab picked, as that tab has it now', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const example = editorStore.getState().documentId;
    openShortenedCopy('shorter');
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Compare with/ }));
    fireEvent.click(screen.getByRole('button', { name: /^SYNPBR322/ }));
    const dialog = screen.getByRole('dialog', { name: '“shorter” compared with SYNPBR322' });
    expect(dialog.textContent).toContain('10 bp');
    expect(dialog.textContent).toContain('Neither document is changed');
    expect(editorStore.getState().comparison).toMatchObject({
      stage: 'review',
      source: { kind: 'tab', documentId: example },
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Go to SYNPBR322' }));
    expect(editorStore.getState().comparison).toBeNull();
    expect(editorStore.getState().documentId).toBe(example);
  });

  it('goes straight to the file picker when no other tab is open', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="File to compare with"]',
    );
    if (input === null) throw new Error('no compare input');
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(window, { code: 'KeyK', altKey: true });
    expect(editorStore.getState().comparison).toBeNull();
    return waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
  });

  it('closes the chooser for the picker when a file on disk is asked for', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    openShortenedCopy('shorter');
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="File to compare with"]',
    );
    if (input === null) throw new Error('no compare input');
    const click = vi.spyOn(input, 'click');
    fireEvent.keyDown(window, { code: 'KeyK', altKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'A file on disk…' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => {
      expect(click).toHaveBeenCalled();
    });
  });
});

describe('Compare with… opening and marking the other side', () => {
  it('opens the file compared with as File ▸ Open would, origin and all', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.getState().documents.length;
    const file = fileFromOpenDocument('pBR322-other.gb', (text) =>
      text.replace(/^ {8}1 (\w{10})/m, '        1 '),
    );
    await act(async () => {
      await compareWithFile(file);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open pBR322-other.gb' }));
    await waitFor(() => {
      expect(editorStore.getState().documents).toHaveLength(before + 1);
    });
    const opened = editorStore.getState();
    expect(opened.comparison).toBeNull();
    expect(opened.fileName).toBe('pBR322-other.gb');
    // Read from a file, so it is protected as one: editing it forks a copy.
    expect(opened.origin?.fileName).toBe('pBR322-other.gb');
    expect(opened.derived).toBe(false);
  });

  it('marks the other side in the views for this document only', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const example = editorStore.getState().documentId;
    const file = fileFromOpenDocument('pBR322-other.gb', (text) =>
      text.replace(/^ {8}1 (\w{10})/m, '        1 '),
    );
    await act(async () => {
      await compareWithFile(file);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark in the views' }));
    const state = editorStore.getState();
    expect(state.comparison).toBeNull();
    expect(state.editsBaseline).toBe('compared');
    expect(state.compared?.name).toBe('pBR322-other.gb');
    expect(editDiffOf(state)?.basesInserted).toBe(10);

    fireEvent.click(screen.getByRole('button', { name: /^Edits/ }));
    const radio = screen.getByRole('menuitemradio', { name: /Compared with pBR322-other\.gb/ });
    expect(radio.getAttribute('aria-checked')).toBe('true');

    // Another tab has not been compared with anything: its marks are "since opened".
    openShortenedCopy('shorter');
    expect(editorStore.editsBaselineDocument()).toBe(editorStore.getState().openedDoc);
    act(() => {
      editorStore.activateDocument(example);
    });
    expect(editDiffOf(editorStore.getState())?.basesInserted).toBe(10);
  });

  it('marks a rotated file as the dialog lined it up', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const doc = editorStore.document;
    if (doc === null) throw new Error('expected a document');
    const file = gbFile('pBR322-rotated.gb', writeGenBank(doc.setOrigin(1000)));
    await act(async () => {
      await compareWithFile(file);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark in the views' }));
    // Turned back, the same molecule: nothing to mark.
    expect(editorStore.getState().compared?.doc.sequence.toString()).toBe(doc.sequence.toString());
    expect(editDiffOf(editorStore.getState())).toBeNull();
  });
});
