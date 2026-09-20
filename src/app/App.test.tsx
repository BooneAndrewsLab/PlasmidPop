// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, translateSixFrames } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { getRepository } from '@/storage';

import { sixFrameFasta, sixFrameFileName } from './sixFrameExport';
import { editorStore } from './state/editorStore';
import { App } from './App';

// The store is a module singleton and autosave remembers the last document:
// start every test on the empty page instead of inheriting (or restoring)
// the previous test's document. The view toggles are remembered the same way.
beforeEach(() => {
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  localStorage.removeItem('plasmidpop.viewPrefs');
  act(() => {
    editorStore.closeAllDocuments();
  });
});

/** Picks an item from the File menu, where file actions live once a document is open. */
function fileMenu(item: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name: 'File' }));
  fireEvent.click(screen.getByRole('menuitem', { name: item }));
}

describe('App', () => {
  it('renders the brand and an empty state before a file is opened', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('PlasmidPop');
    expect(screen.getByText(/Drop a GenBank, FASTA or SnapGene file/)).toBeInTheDocument();
    expect(screen.getByText('No sequence open')).toBeInTheDocument();
  });

  it('opens the bundled example and lists its features', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /open pBR322/i }));
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(screen.getByText('4,361 bp, circular')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Features' })).toBeInTheDocument();
    const [tet] = screen.getAllByRole('button', { name: /^tetgene/i });
    if (tet === undefined) throw new Error('expected a tet feature');
    fireEvent.click(tet);
    expect(screen.getByText(/bp selected/)).toBeInTheDocument();
  });

  it('types, deletes and undoes through the keyboard', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.document?.length ?? 0;
    act(() => {
      editorStore.setSelection({ start: 10, end: 10 });
    });
    const box = screen.getByRole('textbox', { name: 'Sequence' });
    fireEvent.keyDown(box, { key: 'a' });
    fireEvent.keyDown(box, { key: 'C' });
    expect(editorStore.document?.length).toBe(before + 2);
    expect(editorStore.document?.subsequence({ start: 10, end: 12 })).toBe('aC');
    expect(screen.getByText(/Cursor after base 12/)).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(editorStore.document?.length).toBe(before + 1);
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(box, { key: 'z', ctrlKey: true });
    expect(editorStore.document?.length).toBe(before);
    fireEvent.keyDown(box, { key: 'x' });
    expect(screen.getByRole('alert')).toHaveTextContent(/IUPAC/);
    fireEvent.click(screen.getByRole('button', { name: /Add feature/ })); // disabled without a range: no-op
    act(() => {
      editorStore.setSelection({ start: 0, end: 20 });
    });
    fireEvent.click(screen.getByRole('button', { name: /Add feature/ }));
    expect(screen.getByRole('textbox', { name: 'Feature name' })).toHaveValue('New feature');
  });

  it('starts a new sequence from the empty state and types into it', () => {
    act(() => {
      editorStore.closeAllDocuments();
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /start a new sequence/i }));
    expect(editorStore.document?.length).toBe(0);
    expect(screen.getByText('0 bp, linear')).toBeInTheDocument();
    expect(screen.getByText(/Type or paste a DNA sequence/)).toBeInTheDocument();
    const box = screen.getByRole('textbox', { name: 'Sequence' });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'a' });
    fireEvent.keyDown(box, { key: 'c' });
    fireEvent.keyDown(box, { key: 'g' });
    expect(editorStore.document?.sequence.toString()).toBe('acg');
    expect(screen.queryByText(/Type or paste a DNA sequence/)).not.toBeInTheDocument();
    // Typing with no caret (after Escape) still appends to an empty document.
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(editorStore.document?.length).toBe(3);
    fileMenu('New');
    expect(editorStore.document?.length).toBe(0);
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), { key: 't' });
    expect(editorStore.document?.sequence.toString()).toBe('t');
  });

  it('pastes a record or bare bases onto the empty page', () => {
    act(() => {
      editorStore.closeAllDocuments();
    });
    render(<App />);
    const paste = (text: string, target: Element = document.body) => {
      fireEvent.paste(target, { clipboardData: { getData: () => text } });
    };
    paste('LOCUS       X 4 bp DNA circular\nORIGIN\n        1 acgt\n//\n');
    expect(editorStore.document?.name).toBe('X');
    expect(editorStore.document?.isCircular).toBe(true);
    // The logo is the way home too.
    fireEvent.click(screen.getByRole('button', { name: 'PlasmidPop' }));
    expect(editorStore.document).toBeNull();
    paste('acgt acgt\n  11 nnry\n');
    expect(editorStore.document?.sequence.toString()).toBe('acgtacgtnnry');
    expect(editorStore.getState().selection).toEqual({ start: 12, end: 12 });
    // Pasting a record into the still-empty new document opens it instead of failing.
    fileMenu('New');
    paste('>frag\nGGCC\n', screen.getByRole('textbox', { name: 'Sequence' }));
    expect(editorStore.document?.name).toBe('frag');
    expect(editorStore.document?.sequence.toString()).toBe('GGCC');
    fileMenu('Show files');
    paste('hello world');
    expect(editorStore.document).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(/not a GenBank or FASTA/);
  });

  it('renames the document from the toolbar', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'SYNPBR322' }));
    const field = screen.getByRole('textbox', { name: 'Document name' });
    expect(field).toHaveValue('SYNPBR322');
    fireEvent.change(field, { target: { value: '  pBR322 edited ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editorStore.document?.name).toBe('pBR322 edited');
    expect(screen.getByRole('button', { name: /^pBR322 edited/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document name' })).toBeNull();
    // Escape cancels.
    fireEvent.click(screen.getByRole('button', { name: /^pBR322 edited/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Document name' }), {
      target: { value: 'nope' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Document name' }), { key: 'Escape' });
    expect(editorStore.document?.name).toBe('pBR322 edited');
  });

  it('lists changes in the history menu and jumps between them', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const menu = screen.getByRole('button', { name: 'History' });
    expect(menu).toBeDisabled();
    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'AC' });
      editorStore.apply({ type: 'rename', name: 'renamed' });
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    fireEvent.click(menu);
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.textContent)).toEqual([
      '3Make linear',
      '2Rename',
      '1Insert 2 bases',
      'Opened document',
    ]);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Insert 2 bases/ }));
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(editorStore.document?.topology).toBe('circular');
    expect(editorStore.getState().history?.position).toBe(1);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Make linear/ }));
    expect(editorStore.document?.topology).toBe('linear');
    expect(editorStore.getState().history?.canRedo).toBe(false);
  });

  it('shows the history panel with what each change did and jumps from it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText(/Nothing has been changed yet/)).toBeInTheDocument();
    // The state on disk is the one the file was opened at.
    expect(screen.getByText('on disk')).toBeInTheDocument();

    act(() => {
      editorStore.apply({ type: 'insert', position: 0, text: 'AC' });
      editorStore.apply({ type: 'setTopology', topology: 'linear' });
    });
    const list = screen.getByRole('list', { name: 'Changes' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Make linear'),
      expect.stringContaining('Insert 2 bases'),
      expect.stringContaining('Opened document'),
    ]);
    expect(rows[0]).toHaveAttribute('aria-current', 'step');
    expect(rows[0]?.textContent).toContain('linear');
    expect(rows[1]?.textContent).toContain('+2 bp');
    expect(rows[2]?.textContent).toContain('4,361 bp · 50 features');

    // Clicking a row undoes back to it; Latest redoes everything again.
    fireEvent.click(within(list).getByRole('button', { name: /Insert 2 bases/ }));
    expect(editorStore.document?.topology).toBe('circular');
    expect(editorStore.getState().history?.position).toBe(1);
    expect(within(list).getAllByRole('button')[0]).toHaveClass('history-panel__item--undone');
    fireEvent.click(screen.getByRole('button', { name: 'Latest' }));
    expect(editorStore.document?.topology).toBe('linear');
    expect(screen.getByRole('button', { name: 'Latest' })).toBeDisabled();
  });

  it('lists restriction enzymes and ORFs once analysis finishes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Enzymes' }));
    await waitFor(() => {
      expect(screen.getByText(/enzymes cut/)).toBeInTheDocument();
    });
    // The list renders only the rows on screen, so reach EcoRI the way a
    // user would, through the filter box.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Filter enzymes' }), {
      target: { value: 'EcoRI' },
    });
    // pBR322 has single EcoRI, BamHI, PstI sites among others
    expect(screen.getByRole('checkbox', { name: 'EcoRI' })).toBeChecked();
    fireEvent.click(screen.getByRole('tab', { name: 'ORFs' }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /aa$/ }).length).toBeGreaterThan(0);
    });
    const [first] = screen.getAllByRole('button', { name: /aa$/ });
    if (first === undefined) throw new Error('no ORF row');
    fireEvent.click(first);
    expect(screen.getByText('ORF translation')).toBeInTheDocument();
    expect(screen.getByText(/^M[A-Z*]+$/)).toBeInTheDocument();
  });
});

describe('six-frame translation', () => {
  it('translates the selection in six frames and exports them as FASTA', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Translate' }));
    expect(screen.getByText('Whole sequence')).toBeInTheDocument();
    expect(screen.getAllByRole('region', { name: /^Frame [+−][123]$/ })).toHaveLength(6);
    act(() => {
      // ATG AAA TAA → MK* in frame +1
      editorStore.setSelection({ start: 0, end: 9 });
    });
    expect(screen.getByText('Selection')).toBeInTheDocument();
    expect(screen.getByText(/1–9 · 9 bp/)).toBeInTheDocument();
    const dna = editorStore.document?.subsequence({ start: 0, end: 9 }) ?? '';
    const frames = translateSixFrames(dna);
    const plus1 = screen.getByRole('region', { name: 'Frame +1' });
    expect(plus1.querySelector('.frame__protein')?.textContent).toBe(frames[0]?.protein);
    const minus1 = screen.getByRole('region', { name: 'Frame −1' });
    expect(minus1.querySelector('.frame__protein')?.textContent).toBe(frames[3]?.protein);
    const doc = editorStore.document;
    if (doc === null) throw new Error('expected a document');
    const fasta = sixFrameFasta(doc, { start: 0, end: 9 }, frames);
    expect(fasta.match(/^>/gm)).toHaveLength(6);
    expect(fasta).toContain('>SYNPBR322_1-9_frame+1 SYNPBR322 1..9 frame +1, 3 aa\n');
    expect(fasta).toContain('>SYNPBR322_1-9_frame-3 SYNPBR322 1..9 frame -3, 2 aa\n');
    expect(sixFrameFileName(doc, { start: 0, end: 9 })).toBe('SYNPBR322_1-9_6frames.fasta');
  });
});

describe('find and feature editing', () => {
  it('finds bases and features, and edits a feature location', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const find = screen.getByRole('searchbox', { name: 'Find' });
    fireEvent.change(find, { target: { value: 'GAATTC' } });
    await waitFor(() => {
      expect(screen.getByText(/1 of 1, forward strand/)).toBeInTheDocument();
    });
    expect(editorStore.getState().selection).toEqual({ start: 4358, end: 4364 });
    fireEvent.change(find, { target: { value: 'rop' } });
    await waitFor(() => {
      expect(screen.getByText(/1 of \d+, ROP protein/)).toBeInTheDocument();
    });
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(screen.queryByRole('searchbox', { name: 'Find' })).toBeNull();

    // Edit the ROP CDS: rename, flip strand, move by one base.
    const rop = editorStore.document?.features.all().find((f) => f.name === 'ROP protein');
    if (rop === undefined) throw new Error('no ROP feature');
    act(() => {
      editorStore.setSidebarTab('features');
      editorStore.selectFeature(rop.id);
      editorStore.editFeature(rop.id);
    });
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: 'rop' } });
    expect(screen.getByLabelText(/^Location/)).toHaveValue('1915..2106');
    fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '1916..2106' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const edited = editorStore.document?.getFeature(rop.id);
    expect(edited).toMatchObject({ name: 'rop' });
    expect(edited?.segments[0]).toMatchObject({ start: 1915, end: 2106 });
    // Invalid locations disable saving.
    act(() => {
      editorStore.editFeature(rop.id);
    });
    fireEvent.change(screen.getByLabelText(/^Location/), { target: { value: '9999..10' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

describe('toolbar', () => {
  it('toggles the complement strand and translations with pressed buttons', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const complement = screen.getByRole('button', { name: 'Complement' });
    const translations = screen.getByRole('button', { name: 'Translations' });
    expect(complement).toHaveAttribute('aria-pressed', 'true');
    expect(editorStore.getState().showComplement).toBe(true);
    fireEvent.click(complement);
    expect(complement).toHaveAttribute('aria-pressed', 'false');
    expect(editorStore.getState().showComplement).toBe(false);
    const before = editorStore.getState().showTranslations;
    fireEvent.click(translations);
    expect(editorStore.getState().showTranslations).toBe(!before);
    expect(translations).toHaveAttribute('aria-pressed', String(!before));
    const cutSites = screen.getByRole('button', { name: 'Cut sites' });
    expect(cutSites).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(cutSites);
    expect(cutSites).toHaveAttribute('aria-pressed', 'false');
    expect(editorStore.getState().showCutSites).toBe(false);
    act(() => {
      editorStore.setShowCutSites(true);
    });
  });

  it('remembers the view toggles across a reload', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cut sites' }));
    fireEvent.click(screen.getByRole('button', { name: 'Map' }));
    unmount();
    act(() => {
      editorStore.setShowCutSites(true);
      editorStore.setView('both');
    });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Cut sites' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sets the sequence view format and keeps it across a reload', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Large' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: '60' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Colour the bases' }));
    expect(editorStore.getState()).toMatchObject({
      seqFontSize: 16,
      seqBasesPerRow: 60,
      colorBases: true,
    });
    // The menu stays open so several choices can be tried in a row.
    expect(screen.getByRole('menuitemradio', { name: 'Large' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    unmount();
    act(() => {
      editorStore.setSeqFontSize(13);
      editorStore.setSeqBasesPerRow(null);
      editorStore.setColorBases(false);
    });
    render(<App />);
    expect(editorStore.getState()).toMatchObject({
      seqFontSize: 16,
      seqBasesPerRow: 60,
      colorBases: true,
    });
  });

  it('collects the file actions in one menu once a document is open', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: 'File' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    expect(screen.queryByRole('button', { name: 'Open example' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    const names = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(names).toEqual([
      'New',
      'Open file…',
      'Open example',
      'Save…Ctrl+S', // no file handle: Save already asks where, so no Save as
      'Export map as SVG',
      'Export sequence view as SVG',
      'Export selection view as SVG',
      'Export sequence as FASTA',
      'Export selection as GenBank',
      'Export selection as FASTA',
      'Show files',
      'Close',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Export selection as FASTA' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // With a handle to a GenBank file, Save names its target and Save as appears.
    act(() => {
      editorStore.setFileHandle(editorStore.getState().documentId ?? '', {
        name: 'pBR322.gb',
      } as unknown as FileSystemFileHandle);
    });
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: /^Save to pBR322\.gb/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /^Save as…/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => {
      editorStore.setSelection({ start: 0, end: 10 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: 'Export selection as FASTA' })).toBeEnabled();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show files' }));
    expect(editorStore.document).toBeNull();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});

describe('document tabs', () => {
  it('keeps several documents open in tabs, with the file list as the first tab', () => {
    act(() => {
      editorStore.setView('both'); // the sequence view must be on screen to type into
    });
    render(<App />);
    const strip = { name: 'Open documents' };
    expect(screen.queryByRole('tablist', strip)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const tabs = () => within(screen.getByRole('tablist', strip)).getAllByRole('tab');
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'SYNPBR322']);
    expect(tabs()[1]).toHaveAttribute('aria-selected', 'true');
    // New opens a second tab and brings it to the front.
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'SYNPBR322', 'Untitled']);
    expect(editorStore.document?.name).toBe('Untitled');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), { key: 'a' });
    expect(tabs()[2]).toHaveTextContent('Untitled •');
    // Back to the first; its own view state comes with it.
    fireEvent.click(screen.getByRole('tab', { name: /^SYNPBR322/ }));
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(screen.getByText('4,361 bp, circular')).toBeInTheDocument();
    // The file list is a tab too, and the others stay open behind it.
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(editorStore.document).toBeNull();
    expect(screen.getByText(/Drop a GenBank, FASTA or SnapGene file/)).toBeInTheDocument();
    expect(tabs()).toHaveLength(3);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    // Closing a tab keeps the rest.
    fireEvent.click(screen.getByRole('button', { name: 'Close Untitled' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'SYNPBR322']);
    fireEvent.click(screen.getByRole('button', { name: 'Close SYNPBR322' }));
    expect(screen.queryByRole('tablist', strip)).not.toBeInTheDocument();
  });

  it('closes the front tab from the File menu and moves to its neighbour', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    fileMenu('Close');
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(
      within(screen.getByRole('tablist', { name: 'Open documents' })).getAllByRole('tab'),
    ).toHaveLength(2);
  });
});

describe('overwrite prompt', () => {
  it('asks before Save first overwrites the opened file and offers a copy instead', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setFileHandle(editorStore.getState().documentId ?? '', {
        name: 'pBR322.gb',
      } as unknown as FileSystemFileHandle);
    });
    fileMenu(/^Save to pBR322\.gb/);
    const dialog = await screen.findByRole('dialog', { name: 'Overwrite pBR322.gb?' });
    expect(dialog).toHaveTextContent(/replacing the file you opened/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Ctrl+S goes through the same gate.
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editorStore.getState().overwritePrompt).toBeNull();
    // Let the analysis of the example finish so it does not delay the next test's.
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
  });
});

describe('cloning', () => {
  it('digests with the shown enzymes and ligates collected fragments into a new document', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.document;
    if (before === null) throw new Error('no document');
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(before);
    });
    act(() => {
      editorStore.setShownEnzymes(['EcoRI', 'BamHI']);
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Cloning' }));
    expect(screen.getByText('EcoRI, BamHI'.split(', ').sort().join(', '))).toBeInTheDocument();
    expect(screen.getByText(/2 fragments/)).toBeInTheDocument();
    // pBR322: EcoRI cuts after 4359, BamHI after 375 → 4361 - 377 + 1 ... the two pieces sum to 4361.
    const lengths = screen.getAllByRole('button', { name: / bp$/ });
    expect(lengths.map((b) => b.textContent)).toEqual(['3,984 bp', '377 bp']);
    // Selecting a fragment selects its bases.
    fireEvent.click(screen.getByRole('button', { name: '377 bp' }));
    expect(screen.getByText(/377 bp selected/)).toBeInTheDocument();
    // Collect both: insert (EcoRI→BamHI) first, then the vector (BamHI→EcoRI).
    const [addVector, addInsert] = screen.getAllByRole('button', { name: 'Add' });
    if (addVector === undefined || addInsert === undefined) throw new Error('expected 2 Add');
    fireEvent.click(addInsert);
    fireEvent.click(addVector);
    expect(screen.getByText(/2 parts, 4,361 bp/)).toBeInTheDocument();
    const joins = () =>
      screen
        .getAllByRole('listitem', { name: /compatible/ })
        .map((li) => li.getAttribute('aria-label'));
    expect(joins()).toEqual([
      'Join: BamHI 5′ GATC to BamHI 5′ GATC, compatible',
      'Closing join: EcoRI 5′ AATT to EcoRI 5′ AATT, compatible',
    ]);
    // Flipping the insert puts EcoRI against BamHI at both joins (the insert is directional).
    fireEvent.click(screen.getByRole('button', { name: 'Flip part 1' }));
    expect(joins()).toEqual([
      'Join: EcoRI 5′ AATT to BamHI 5′ GATC, incompatible',
      'Closing join: EcoRI 5′ AATT to BamHI 5′ GATC, incompatible',
    ]);
    expect(screen.getByText(/\(flipped\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assemble' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Flip part 1' }));
    expect(screen.getByRole('button', { name: 'Assemble' })).toBeEnabled();
    // Reordering rotates the product; move back so it starts at the EcoRI cut.
    fireEvent.click(screen.getByRole('button', { name: 'Move part 1 down' }));
    expect(joins()[0]).toBe('Join: EcoRI 5′ AATT to EcoRI 5′ AATT, compatible');
    fireEvent.click(screen.getByRole('button', { name: 'Move part 2 up' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Name of the assembled/ }), {
      target: { value: 'religated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    const product = editorStore.document;
    expect(product?.name).toBe('religated');
    expect(product?.isCircular).toBe(true);
    expect(product?.length).toBe(4361);
    // Same molecule, rotated to start at the EcoRI cut.
    const rotated = before.setOrigin(4359).sequence.toString();
    expect(product?.sequence.toString()).toBe(rotated);
    expect(product?.features.all().length).toBeGreaterThan(5);
    expect(editorStore.getState().assembly).toEqual([]);
    expect(screen.getByText(/4,361 bp, circular/)).toBeInTheDocument();
  });

  it('opens a fragment as a document that keeps its sticky ends', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.document;
    if (before === null) throw new Error('no document');
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(before);
    });
    act(() => {
      editorStore.setShownEnzymes(['EcoRI', 'BamHI']);
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Cloning' }));
    const [openBiggest] = screen.getAllByRole('button', { name: 'Open' });
    if (openBiggest === undefined) throw new Error('expected an Open button');
    fireEvent.click(openBiggest);
    const fragment = editorStore.document;
    expect(fragment?.name).toBe('SYNPBR322 BamHI-EcoRI fragment');
    expect(fragment?.length).toBe(3984);
    expect(fragment?.topology).toBe('linear');
    // The overhang is quoted from the sequence, which pBR322 writes in
    // lowercase; ends are compared case-insensitively when they are ligated.
    expect(fragment?.ends).toEqual({
      left: { kind: "5'", overhang: 'gatc', enzyme: 'BamHI' },
      right: { kind: "5'", overhang: 'aatt', enzyme: 'EcoRI' },
    });
    // The toolbar says what the ends are.
    expect(screen.getByText(/BamHI 5′ GATC \/ EcoRI 5′ AATT/)).toBeInTheDocument();
    // ...and it survives a save and reopen through GenBank.
    const reopened = parseGenBank(writeGenBank(fragment as never)).documents[0];
    expect(reopened?.ends).toEqual(fragment?.ends);
  });
});

describe('golden gate', () => {
  /** A part with a BsaI site at each end pointing inwards; see goldenGate.test.ts. */
  const insert = (name: string, left: string, payload: string, right: string) =>
    SeqDocument.create({ name, sequence: `TTGGTCTCA${left}${payload}${right}AGAGACCTT` });
  const vector = SeqDocument.create({
    name: 'pDest',
    topology: 'circular',
    sequence: 'AATGCCCCCCCCCCCCGCTTAGAGACCTTTTGGTCTCA',
  });

  async function openParts(): Promise<void> {
    render(<App />);
    act(() => {
      editorStore.openDocument(vector, 'pDest.gb');
      editorStore.openDocument(insert('insert1', 'GCTT', 'AAAAAAAAAA', 'CGCT'), 'insert1.gb');
      editorStore.openDocument(insert('insert2', 'CGCT', 'TTTTTTTTTT', 'AATG'), 'insert2.gb');
    });
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Cloning' }));
  }

  it('works out the order from the overhangs and assembles the circle', async () => {
    await openParts();
    expect(screen.getByText(/3 parts join/)).toBeInTheDocument();
    expect(screen.getByText(/44 bp circle/)).toBeInTheDocument();
    // The overhangs chain pDest → insert1 → insert2 and back, whatever
    // order the parts were given in.
    const rows = within(screen.getByRole('list', { name: 'Assembly order' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((li) => li.textContent)).toEqual([
      '1pDest16 bpAATG',
      '2insert114 bpGCTT',
      '3insert214 bpCGCT',
    ]);
    // The five pieces that keep a BsaI site are reported, not silently dropped.
    expect(screen.getByText('5 pieces left out')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    const product = editorStore.document;
    expect(product?.name).toBe('pDest+insert1+insert2 assembly');
    expect(product?.isCircular).toBe(true);
    expect(product?.length).toBe(44);
    expect(product?.sequence.toString()).toBe('AATGCCCCCCCCCCCCGCTTAAAAAAAAAACGCTTTTTTTTTTT');
    // Not a BsaI site left: the product cannot be cut again.
    expect(product?.sequence.toString()).not.toContain('GGTCTC');
    expect(product?.sequence.toString()).not.toContain('GAGACC');
  });

  it('says why the parts do not go together when one is left out', async () => {
    await openParts();
    fireEvent.click(screen.getByRole('checkbox', { name: 'insert2' }));
    expect(screen.queryByRole('button', { name: 'Assemble' })).not.toBeInTheDocument();
    expect(screen.getByText(/CGCT/)).toBeInTheDocument();
    // Ticking it again brings the assembly back.
    fireEvent.click(screen.getByRole('checkbox', { name: 'insert2' }));
    expect(screen.getByRole('button', { name: 'Assemble' })).toBeEnabled();
  });

  it('names the product when the user does', async () => {
    await openParts();
    fireEvent.change(screen.getByRole('textbox', { name: /Name of the assembled/ }), {
      target: { value: 'pFinal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assemble' }));
    expect(editorStore.document?.name).toBe('pFinal');
  });
});
