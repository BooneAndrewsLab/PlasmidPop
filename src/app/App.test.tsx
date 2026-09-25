// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { BLUNT_END, SeqDocument, translateSixFrames } from '@/core';
import { parseGenBank, writeGenBank } from '@/io';
import { getRepository } from '@/storage';

import { EXAMPLES } from './examples';
import { shareUrlFor } from './share';
import { sixFrameFasta, sixFrameFileName } from './sixFrameExport';
import { DEFAULT_BENCH } from './state/benchSettings';
import { editorStore } from './state/editorStore';
import {
  DEFAULT_LAYOUT,
  PHONE_QUERY,
  SIDEBAR_STACKED_QUERY,
  VIEWS_STACKED_QUERY,
} from './state/layout';
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
    // The sidebar is shared state too, and clicking the tab that is already
    // open now puts it away: start every test on the Features tab, shown.
    editorStore.setSidebarTab('features');
    editorStore.setSidebarOpen(true);
    editorStore.setView('both');
    editorStore.resetLayout();
    // What the Cloning tab and the Bench were left on is shared state too.
    editorStore.setCloningReaction('digest');
    editorStore.restoreBench(DEFAULT_BENCH);
    editorStore.dismissNewDocument();
  });
});

/** The New sequence dialog's Create, taking the name and topology it offers (#6). */
function create(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
}

/** The Cloning tab and the Bench show one reaction at a time; this is the picker. */
function pickReaction(name: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Reaction' })).getByRole('button', { name });
}

/** Brings the Bench to the front and picks one of its reactions. */
function openBench(reaction: string): void {
  fireEvent.click(screen.getByRole('tab', { name: /^Bench/ }));
  fireEvent.click(pickReaction(reaction));
}

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
    // Asked for a name and a topology first, Untitled and linear as they were.
    expect(screen.getByRole('dialog', { name: 'New sequence' })).toBeInTheDocument();
    expect(editorStore.document).toBeNull();
    create();
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
    create();
    expect(editorStore.document?.length).toBe(0);
    fireEvent.keyDown(box, { key: 'Escape' });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), { key: 't' });
    expect(editorStore.document?.sequence.toString()).toBe('t');
  });

  it('names a new sequence and makes it circular before it opens (#6)', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /start a new sequence/i }));
    const name = screen.getByRole('textbox', { name: 'Name' });
    // Selected, so typing replaces it.
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'pNew' } });
    fireEvent.click(screen.getByRole('button', { name: 'Circular' }));
    create();
    expect(editorStore.document?.name).toBe('pNew');
    expect(editorStore.document?.isCircular).toBe(true);
    expect(screen.getByRole('textbox', { name: 'Sequence' })).toHaveFocus();
    // The next New starts on the topology chosen last; Escape opens nothing.
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    expect(screen.getByRole('button', { name: 'Circular' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'New sequence' })).toBeNull();
    expect(editorStore.getState().documents).toHaveLength(1);
    // Put back for the tests after this one.
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    create();
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
    create();
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
    // The example is not a file on disk, so editing it forks no working copy
    // and the name stays the one the record carries.
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
    // Each row is its step's button and the "⋯" beside it (#4).
    const rows = within(list)
      .getAllByRole('button')
      .filter((b) => b.classList.contains('history-panel__item'));
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

  it('reads a file dropped on the Align box there instead of opening a tab (#46)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Align' }));
    const box = screen.getByRole('textbox', { name: 'Sequence to align' });
    const file = new File(['>read\nGAATTCTCATGTTTGACAGC\n'], 'read.fa');
    fireEvent.drop(box, { dataTransfer: { files: [file], types: ['Files'] } });
    await waitFor(() => {
      expect(box).toHaveValue('>read\nGAATTCTCATGTTTGACAGC\n');
    });
    expect(editorStore.getState().documents).toHaveLength(1);
    expect(editorStore.document?.name).toBe('SYNPBR322');
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

  it('reads the frames with the chosen genetic code, and names it in the export', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Translate' }));
    const range = { start: 0, end: 300 };
    act(() => {
      editorStore.setSelection(range);
    });
    const doc = editorStore.document;
    if (doc === null) throw new Error('expected a document');
    const dna = doc.subsequence(range);
    const plus1 = () => screen.getByRole('region', { name: 'Frame +1' }).textContent;
    // Under the vertebrate mitochondrial code TGA is tryptophan rather than a
    // stop, so 300 bases of pBR322 read differently and the panel must follow.
    const standard = translateSixFrames(dna)[0]?.protein ?? '';
    const mitochondrial = translateSixFrames(dna, { table: 2 })[0]?.protein ?? '';
    expect(mitochondrial).not.toBe(standard);
    expect(plus1()).toContain(standard);

    const code = screen.getByRole('combobox', { name: 'Code' });
    fireEvent.change(code, { target: { value: '2' } });
    expect(plus1()).toContain(mitochondrial);

    const frames = translateSixFrames(dna, { table: 2 });
    expect(sixFrameFasta(doc, range, frames, 2)).toContain(
      'genetic code 2 (Vertebrate Mitochondrial)',
    );
    // The standard code is the assumption, so it is not written out.
    expect(sixFrameFasta(doc, range, frames)).not.toContain('genetic code');
  });
});

describe('previews', () => {
  it('draws every find match, and takes them away when the bar closes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const find = screen.getByRole('searchbox', { name: 'Find' });
    fireEvent.change(find, { target: { value: 'GGATCC' } });
    const count = await waitFor(() => {
      const shown = /of (\d+)/.exec(screen.getByRole('search').textContent);
      if (shown === null) throw new Error('no match count yet');
      return Number(shown[1]);
    });
    expect(count).toBeGreaterThan(0);
    expect(editorStore.getState().preview?.items).toHaveLength(count);
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(editorStore.getState().preview).toBeNull();
  });

  it('shows a primer pair and what it would amplify without touching the document', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const before = editorStore.document;
    act(() => {
      editorStore.setSelection({ start: 600, end: 900 });
      editorStore.setSidebarTab('primers');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    const [show] = await screen.findAllByRole('button', { name: 'Show' });
    if (show === undefined) throw new Error('expected a designed pair');
    fireEvent.click(show);
    const preview = editorStore.getState().preview;
    expect(preview?.items.map((i) => i.id)).toEqual([
      'primers:product',
      'primers:forward',
      'primers:reverse',
    ]);
    const product = preview?.items[0];
    // The product is selected, so the map and the sequence view scroll to it...
    expect(editorStore.getState().selection).toEqual(product?.range);
    // ...and nothing about the document changed.
    expect(editorStore.document).toBe(before);
    expect(editorStore.getState().dirty).toBe(false);
    // Leaving the tab takes the preview off; coming back brings the design,
    // and the pair that was shown, back with it (#32).
    fireEvent.click(screen.getByRole('tab', { name: 'Features' }));
    expect(editorStore.getState().preview).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Primers' }));
    expect(editorStore.getState().preview?.items).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(editorStore.getState().preview).toBeNull();
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

  it('blunts a sticky-ended molecule from the edit bar, undoably', () => {
    render(<App />);
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({
          name: 'frag',
          sequence: 'aattcGGGCCCg',
          topology: 'linear',
          ends: {
            left: { kind: "5'", overhang: 'aatt', enzyme: 'EcoRI' },
            right: { kind: "5'", overhang: 'gatc', enzyme: 'BamHI' },
          },
        }),
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Blunt (fill in)' }));
    expect(editorStore.document?.sequence.toString()).toBe('aattcGGGCCCggatc');
    expect(editorStore.document?.ends).toBeNull();
    // Nothing left to blunt, so the buttons go.
    expect(screen.queryByRole('button', { name: 'Blunt (trim)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blunt (trim)' }));
    expect(editorStore.document?.sequence.toString()).toBe('cGGGCCCg');
    act(() => {
      editorStore.closeDocument();
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

  it('moves the boundaries between the panes and remembers where they were left', () => {
    const { unmount } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    expect(
      screen.getByRole('separator', { name: 'Resize the map and the sequence' }),
    ).toHaveAttribute('aria-orientation', 'vertical');
    const sidebarSplit = screen.getByRole('separator', { name: 'Resize the sidebar' });
    act(() => {
      editorStore.setLayout({ sidebarWidth: 420, viewsSplit: 0.55 });
    });
    const main = document.querySelector('.app__main');
    expect(main?.getAttribute('style')).toContain('420px');
    expect(document.querySelector('.app__views')?.getAttribute('style')).toContain('0.55fr');
    // A double-click puts that one boundary back, and leaves the other alone.
    fireEvent.doubleClick(sidebarSplit);
    expect(editorStore.getState().layout).toMatchObject({
      sidebarWidth: DEFAULT_LAYOUT.sidebarWidth,
      viewsSplit: 0.55,
    });
    unmount();
    act(() => {
      editorStore.resetLayout();
    });
    render(<App />);
    expect(editorStore.getState().layout.viewsSplit).toBe(0.55);
  });

  it('puts the panel away from its own tab and brings it back from the rail', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    // Clicking the tab that is open collapses the sidebar to its rail.
    fireEvent.click(screen.getByRole('tab', { name: 'Features' }));
    expect(screen.getByRole('tab', { name: 'Features' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tabpanel', { hidden: true })).not.toBeVisible();
    expect(screen.queryByRole('separator', { name: 'Resize the sidebar' })).toBeNull();
    // The rail is still there, and any label brings the panel back on that tab.
    fireEvent.click(screen.getByRole('tab', { name: 'Enzymes' }));
    expect(screen.getByRole('tab', { name: 'Enzymes' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toBeVisible();
    expect(screen.getByRole('separator', { name: 'Resize the sidebar' })).toBeInTheDocument();
    // Reset the layout opens it again as well, from the Format menu.
    act(() => {
      editorStore.setSidebarOpen(false);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset the layout' }));
    expect(editorStore.getState()).toMatchObject({ sidebarOpen: true, layout: DEFAULT_LAYOUT });
  });

  it('takes the keyboard to a boundary with Alt+B and back with Escape, and collapses past a floor', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const views = screen.getByRole('separator', { name: 'Resize the map and the sequence' });
    const sidebar = screen.getByRole('separator', { name: 'Resize the sidebar' });
    const sequence = screen.getByRole('textbox', { name: 'Sequence' });
    sequence.focus();
    fireEvent.keyDown(sequence, { code: 'KeyB', altKey: true });
    expect(views).toHaveFocus();
    fireEvent.keyDown(views, { code: 'KeyB', altKey: true });
    expect(sidebar).toHaveFocus();
    fireEvent.keyDown(sidebar, { key: 'Escape' });
    expect(sequence).toHaveFocus();
    // With the sidebar at its floor (jsdom lays nothing out, so the boxes are
    // stated), one more arrow toward it puts it away, as a drag past it would.
    const container = sidebar.parentElement;
    if (container === null) throw new Error('no container');
    container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
    sidebar.getBoundingClientRect = () => new DOMRect(1000 - 6 - 240, 0, 6, 600);
    fireEvent.keyDown(sidebar, { key: 'ArrowRight' });
    expect(editorStore.getState().sidebarOpen).toBe(false);
    act(() => {
      editorStore.setSidebarOpen(true);
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
      'Download GenBank…Ctrl+S', // the two ways a document leaves the app:
      'Copy share linkAlt+L', // as a file, or inside a link that goes nowhere near a server
      'Copy link to selection',
      'Compare with…Alt+K', // and the one that reads a file without opening it
      'Export map as SVG',
      'Export sequence view as SVG…',
      'Export sequence as FASTA',
      'Export selection as GenBank',
      'Export selection as FASTA',
      'Show files',
      'Close',
    ]);
    expect(screen.getByRole('menuitem', { name: 'Export selection as FASTA' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
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
  it('keeps several documents open in tabs, with the file list and the Bench as the first tabs', () => {
    act(() => {
      editorStore.setView('both'); // the sequence view must be on screen to type into
    });
    render(<App />);
    const strip = { name: 'Open documents' };
    const tabs = () => within(screen.getByRole('tablist', strip)).getAllByRole('tab');
    // On a desktop the strip is there from the start, with the file list in front.
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'Bench']);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'Bench', 'SYNPBR322']);
    expect(tabs()[2]).toHaveAttribute('aria-selected', 'true');
    // New opens a second tab and brings it to the front.
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    create();
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'Bench', 'SYNPBR322', 'Untitled']);
    expect(editorStore.document?.name).toBe('Untitled');
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Sequence' }), { key: 'a' });
    expect(tabs()[3]).toHaveTextContent('Untitled •');
    // Back to the first; its own view state comes with it.
    fireEvent.click(screen.getByRole('tab', { name: /^SYNPBR322/ }));
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(screen.getByText('4,361 bp, circular')).toBeInTheDocument();
    // The file list is a tab too, and the others stay open behind it.
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(editorStore.document).toBeNull();
    expect(screen.getByText(/Drop a GenBank, FASTA or SnapGene file/)).toBeInTheDocument();
    expect(tabs()).toHaveLength(4);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
    // Closing a tab keeps the rest.
    fireEvent.click(screen.getByRole('button', { name: 'Close Untitled' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'Bench', 'SYNPBR322']);
    // Closing the last one keeps the strip, so Files and the Bench can still be reached.
    fireEvent.click(screen.getByRole('button', { name: 'Close SYNPBR322' }));
    expect(tabs().map((t) => t.textContent)).toEqual(['Files', 'Bench']);
    expect(tabs()[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('closes the front tab with Alt+W and moves it along the strip with Alt+Shift+PageUp/Down', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    create();
    const names = () =>
      within(screen.getByRole('tablist', { name: 'Open documents' }))
        .getAllByRole('tab')
        .map((t) => t.textContent);
    expect(names()).toEqual(['Files', 'Bench', 'SYNPBR322', 'Untitled']);
    fireEvent.keyDown(window, { key: 'PageUp', code: 'PageUp', altKey: true, shiftKey: true });
    expect(names()).toEqual(['Files', 'Bench', 'Untitled', 'SYNPBR322']);
    // Already first: stays.
    fireEvent.keyDown(window, { key: 'PageUp', code: 'PageUp', altKey: true, shiftKey: true });
    expect(names()).toEqual(['Files', 'Bench', 'Untitled', 'SYNPBR322']);
    expect(editorStore.document?.name).toBe('Untitled');
    fireEvent.keyDown(window, { key: 'w', code: 'KeyW', altKey: true });
    expect(names()).toEqual(['Files', 'Bench', 'SYNPBR322']);
    expect(editorStore.document?.name).toBe('SYNPBR322');
  });

  it('reorders tabs by dragging one onto another, and ignores other drags', () => {
    render(<App />);
    act(() => {
      for (const name of ['pA', 'pB', 'pC']) {
        editorStore.openDocument(SeqDocument.create({ name, sequence: 'ACGT' }), `${name}.gb`);
      }
    });
    const tabOf = (name: string): HTMLElement => {
      const tab = screen.getByRole('tab', { name }).parentElement;
      if (tab === null) throw new Error(`no tab ${name}`);
      return tab;
    };
    const names = () => editorStore.getState().documents.map((d) => d.history.present.name);
    const store = new Map<string, string>();
    const dataTransfer = {
      get types() {
        return [...store.keys()];
      },
      setData: (type: string, value: string) => store.set(type, value),
      getData: (type: string) => store.get(type) ?? '',
      effectAllowed: 'none',
      dropEffect: 'none',
    };
    // pA onto the left half of pC: it lands between pB and pC. (jsdom's drag
    // events carry no pointer position, so the left half is where they land.)
    const target = tabOf('pC');
    target.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;
    fireEvent.dragStart(tabOf('pA'), { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveClass('doctabs__tab--drop-before');
    fireEvent.drop(target, { dataTransfer });
    expect(names()).toEqual(['pB', 'pA', 'pC']);
    expect(target).not.toHaveClass('doctabs__tab--drop-before');
    // A file dragged over the strip is not a tab, and moves nothing.
    const files = { types: ['Files'], files: [] };
    fireEvent.dragOver(tabOf('pB'), { dataTransfer: files });
    expect(tabOf('pB')).not.toHaveClass('doctabs__tab--drop-before');
    expect(names()).toEqual(['pB', 'pA', 'pC']);
  });

  it('comes back to a tab scrolled to the row it was left on', () => {
    act(() => {
      editorStore.setView('sequence');
    });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const view = () => screen.getByRole('textbox', { name: 'Sequence' });
    view().scrollTop = 3000;
    fireEvent.scroll(view());
    const left = view().scrollTop;
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    create();
    expect(view().scrollTop).toBe(0);
    fireEvent.click(screen.getByRole('tab', { name: /^SYNPBR322/ }));
    // The top of the row that was at the top: at or just above where it was left.
    expect(view().scrollTop).toBeGreaterThan(left - 200);
    expect(view().scrollTop).toBeLessThanOrEqual(left);
  });

  it('comes back to a tab with its map zoomed as it was left', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Show the whole map' })).toBeEnabled();
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({ name: 'pRing', sequence: 'ACGT'.repeat(500), topology: 'circular' }),
        'pRing.gb',
      );
    });
    // A tab of its own shows its whole map.
    expect(screen.getByRole('button', { name: 'Show the whole map' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: /^SYNPBR322/ }));
    expect(screen.getByRole('button', { name: 'Show the whole map' })).toBeEnabled();
  });

  it('closes the front tab from the File menu and moves to its neighbour', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'New sequence' }));
    create();
    fileMenu('Close');
    expect(editorStore.document?.name).toBe('SYNPBR322');
    expect(
      within(screen.getByRole('tablist', { name: 'Open documents' })).getAllByRole('tab'),
    ).toHaveLength(3);
  });

  it('opens the Bench as a tab of its own, counting the parts on the shelf', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const bench = () => screen.getByRole('tab', { name: /^Bench/ });
    expect(bench()).toHaveTextContent(/^Bench$/);
    act(() => {
      editorStore.addToShelf({
        sequence: 'ACGT',
        features: [],
        range: { start: 0, end: 4 },
        left: { kind: 'blunt', overhang: '', enzyme: null },
        right: { kind: 'blunt', overhang: '', enzyme: null },
        source: 'SYNPBR322',
      });
    });
    expect(bench()).toHaveAccessibleName('Bench, 1 part on the shelf');
    // A part arriving pulses the count, so an Add in the sidebar shows where it went (#81).
    const count = () => bench().querySelector('.doctabs__count');
    expect(count()).toHaveClass('doctabs__count--pulse');
    fireEvent.click(bench());
    expect(editorStore.getState().front).toBe('bench');
    expect(editorStore.document).toBeNull();
    expect(bench()).toHaveAttribute('aria-selected', 'true');
    expect(
      within(screen.getByRole('region', { name: 'Parts' })).getByRole('list', { name: 'Shelf' }),
    ).toBeInTheDocument();
    // The documents stay open behind it. With the last of them closed and the
    // shelf empty, the strip stays, so an empty Bench is not a dead end:
    // Files is still a tab away.
    fireEvent.click(screen.getByRole('button', { name: 'Close SYNPBR322' }));
    expect(bench()).toHaveAttribute('aria-selected', 'true');
    act(() => {
      editorStore.clearShelf();
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Files' }));
    expect(editorStore.getState().front).toBe('files');
  });

  it('takes the logo home from the Bench, and keeps it live on the file list', () => {
    render(<App />);
    const logo = () => screen.getByRole('button', { name: 'PlasmidPop' });
    // On the file list it is home already: still a button, and clicking it stays put.
    expect(editorStore.getState().front).toBe('files');
    expect(logo()).toBeEnabled();
    fireEvent.click(logo());
    expect(editorStore.getState().front).toBe('files');
    // From an empty Bench it is the way back to the file list.
    act(() => {
      editorStore.showBench();
    });
    expect(editorStore.getState().front).toBe('bench');
    expect(logo()).toBeEnabled();
    fireEvent.click(logo());
    expect(editorStore.getState().front).toBe('files');
  });

  it('does not pulse the Bench count for a shelf restored at load (#81)', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.restoreShelf([
        {
          id: 'restored',
          flipped: false,
          fragment: {
            sequence: 'ACGT',
            features: [],
            range: { start: 0, end: 4 },
            left: { kind: 'blunt', overhang: '', enzyme: null },
            right: { kind: 'blunt', overhang: '', enzyme: null },
            source: 'SYNPBR322',
          },
        },
      ]);
    });
    const bench = screen.getByRole('tab', { name: /^Bench/ });
    expect(bench).toHaveAccessibleName('Bench, 1 part on the shelf');
    expect(bench.querySelector('.doctabs__count')).not.toHaveClass('doctabs__count--pulse');
    act(() => {
      editorStore.clearShelf();
    });
  });

  it("undoes the shelf's changes from the toolbar and with Ctrl+Z while the Bench is in front", () => {
    render(<App />);
    act(() => {
      editorStore.clearShelf();
      editorStore.addToShelf({
        sequence: 'ACGT',
        features: [],
        range: { start: 0, end: 4 },
        left: { kind: 'blunt', overhang: '', enzyme: null },
        right: { kind: 'blunt', overhang: '', enzyme: null },
        source: 'pKeep',
      });
      editorStore.showBench();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove part 1' }));
    expect(editorStore.getState().shelf).toHaveLength(0);
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toHaveAttribute('title', 'Undo Remove pKeep fragment (Ctrl+Z)');
    fireEvent.click(undo);
    expect(editorStore.getState().shelf).toHaveLength(1);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(editorStore.getState().shelf).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(editorStore.getState().shelf).toHaveLength(1);
    expect(screen.getByText('Cloning Bench')).toBeInTheDocument();
    act(() => {
      editorStore.clearShelf();
    });
  });
});

describe('downloading', () => {
  it('reviews a working copy before writing it, from the menu and from Ctrl+S', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open file' }));
    // The example is nobody's file on disk, so open a file to get an origin.
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(
        SeqDocument.create({ name: 'pDown', sequence: 'ACGTACGTAC' }),
        'pDown.gb',
      );
      editorStore.apply({ type: 'insert', position: 0, text: 'A' });
    });
    fileMenu(/^Download GenBank…/);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/working copy of/);
    expect(dialog).toHaveTextContent('pDown.gb');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Ctrl+S is the same action.
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(editorStore.getState().saveReview).toBeNull();
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
    expect(screen.getByText(/The shelf holds 2 parts, 4,361 bp/)).toBeInTheDocument();
    // They are joined on the Bench.
    openBench('Ligation');
    expect(screen.getByText(/2 parts, 4,361 bp/)).toBeInTheDocument();
    const joins = () =>
      screen
        .getAllByRole('listitem', { name: /compatible/ })
        .map((li) => li.getAttribute('aria-label'));
    expect(joins()).toEqual([
      'Join: BamHI 5′ GATC to BamHI 5′ GATC, compatible',
      'Closing join: EcoRI 5′ AATT to EcoRI 5′ AATT, compatible',
    ]);
    expect(screen.getByLabelText('Product')).toHaveTextContent(/^Product: 4,361 bp, circular · /);
    // The Bench draws the product beside the reaction, with a digest to check it by.
    const column = within(screen.getByRole('region', { name: 'What it makes' }));
    expect(column.getByRole('img', { name: /^Map of SYNPBR322/ })).toBeInTheDocument();
    const check = column.getByRole('combobox', { name: 'Check digest enzyme' });
    const first = within(check).getAllByRole('option')[0];
    expect(first?.textContent).toMatch(/ \+ .* bp \(clearest\)$/);
    expect(column.getByRole('figure')).toBeInTheDocument();
    // Flipping the insert puts EcoRI against BamHI at both joins (the insert is directional).
    fireEvent.click(screen.getByRole('button', { name: 'Flip part 1' }));
    expect(joins()).toEqual([
      'Join: EcoRI 5′ AATT to BamHI 5′ GATC, incompatible',
      'Closing join: EcoRI 5′ AATT to BamHI 5′ GATC, incompatible',
    ]);
    // On the shelf, where it was flipped, and in the ligation's order below it.
    expect(screen.getAllByText(/\(flipped\)/)).toHaveLength(2);
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
    // The shelf keeps its fragments: the vector may take another insert next.
    expect(editorStore.getState().shelf).toHaveLength(2);
    expect(screen.getByText(/4,361 bp, circular/)).toBeInTheDocument();
    act(() => {
      editorStore.clearShelf();
    });
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
    openBench('Golden Gate');
  }

  it('takes a second enzyme, and warns about overhangs a ligase could confuse', async () => {
    render(<App />);
    act(() => {
      // pDest's second overhang is AATC, one base from its first, AATG. The
      // insert is made for BsmBI rather than BsaI.
      editorStore.openDocument(
        SeqDocument.create({
          name: 'pDest',
          topology: 'circular',
          sequence: 'AATGCCCCCCCCCCCCAATCAGAGACCTTTTGGTCTCA',
        }),
        'pDest.gb',
      );
      editorStore.openDocument(
        SeqDocument.create({ name: 'part', sequence: 'TTCGTCTCAAATCAAAAAAAAAAAATGAGAGACGTT' }),
        'part.gb',
      );
    });
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
    openBench('Golden Gate');
    expect(screen.queryByRole('button', { name: 'Assemble by Golden Gate' })).toBeNull();
    fireEvent.change(screen.getByRole('combobox', { name: 'Second enzyme' }), {
      target: { value: 'BsmBI' },
    });
    expect(screen.getByText(/2 parts join/)).toBeInTheDocument();
    const warnings = screen.getByRole('list', { name: 'Assembly warnings' });
    expect(within(warnings).getByText(/AATG and AATC differ at one base/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assemble by Golden Gate' })).toBeEnabled();
  });

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
    // What it would make, said before it is made (#15).
    expect(screen.getByLabelText('Product')).toHaveTextContent(
      'Product: 44 bp, circular, no features',
    );
    // The five pieces that keep a BsaI site are reported, not silently dropped.
    expect(screen.getByText('5 pieces left out')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assemble by Golden Gate' }));
    const product = editorStore.document;
    expect(product?.name).toBe('pDest+insert1+insert2 assembly');
    expect(product?.isCircular).toBe(true);
    expect(product?.length).toBe(44);
    expect(product?.sequence.toString()).toBe('AATGCCCCCCCCCCCCGCTTAAAAAAAAAACGCTTTTTTTTTTT');
    // Not a BsaI site left: the product cannot be cut again.
    expect(product?.sequence.toString()).not.toContain('GGTCTC');
    expect(product?.sequence.toString()).not.toContain('GAGACC');
  });

  it('takes a part off the ligation shelf as well as an open document', async () => {
    render(<App />);
    act(() => {
      editorStore.clearShelf();
      editorStore.openDocument(vector, 'pDest.gb');
      editorStore.openDocument(insert('insert1', 'GCTT', 'AAAAAAAAAA', 'CGCT'), 'insert1.gb');
      // The third part arrives as a fragment somebody collected rather than
      // as a file. It carries no BsaI site, so the reaction leaves it whole
      // and it joins on the sticky ends it already has.
      editorStore.addToShelf({
        sequence: 'CGCTTTTTTTTTTT',
        features: [],
        range: { start: 0, end: 14 },
        left: { kind: "5'", overhang: 'CGCT', enzyme: 'BsaI' },
        right: { kind: "5'", overhang: 'AATG', enzyme: 'BsaI' },
        source: 'insert2',
      });
    });
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
    openBench('Golden Gate');

    const tube = screen.getByRole('list', { name: 'Documents in the Golden Gate' });
    expect(within(tube).getByRole('checkbox', { name: 'insert2 BsaI fragment' })).toBeChecked();
    expect(screen.getByText(/3 parts join/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assemble by Golden Gate' }));
    expect(editorStore.document?.isCircular).toBe(true);
    expect(editorStore.document?.sequence.toString()).toBe(
      'AATGCCCCCCCCCCCCGCTTAAAAAAAAAACGCTTTTTTTTTTT',
    );
    act(() => {
      editorStore.clearShelf();
    });
  });

  it('says why the parts do not go together when one is left out', async () => {
    await openParts();
    // The Gibson section below lists the same documents, so the tick has to
    // be the Golden Gate's own.
    const tube = (): HTMLElement =>
      within(screen.getByRole('list', { name: 'Documents in the Golden Gate' })).getByRole(
        'checkbox',
        { name: 'insert2' },
      );
    fireEvent.click(tube());
    expect(
      screen.queryByRole('button', { name: 'Assemble by Golden Gate' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/CGCT/)).toBeInTheDocument();
    // Ticking it again brings the assembly back.
    fireEvent.click(tube());
    expect(screen.getByRole('button', { name: 'Assemble by Golden Gate' })).toBeEnabled();
  });

  it('names the product when the user does', async () => {
    await openParts();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the Golden Gate product' }), {
      target: { value: 'pFinal' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assemble by Golden Gate' }));
    expect(editorStore.document?.name).toBe('pFinal');
  });
});

describe('gibson', () => {
  // Twenty bases at each junction, the tails a designer would put on their
  // primers. Balanced enough to anneal at the 50 °C the reaction runs at.
  const A = 'GCATTGACCTAGGCTTACAG';
  const B = 'TTCAGCCGATACGTGCAATC';
  const vectorBody = 'CCCCCCCCCCGGGGGGGGGGAAAATTTTAA';
  const insertBody = 'ATGGCTAGCAAAGGTGAAGAACTGTTTACC';
  const vector = SeqDocument.create({ name: 'pBackbone', sequence: `${A}${vectorBody}${B}` });
  const insert = SeqDocument.create({ name: 'gfp', sequence: `${B}${insertBody}${A}` });

  async function openParts(): Promise<void> {
    render(<App />);
    act(() => {
      editorStore.openDocument(vector, 'pBackbone.gb');
      editorStore.openDocument(insert, 'gfp.gb');
    });
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
    openBench('Gibson');
  }

  it('finds the order from the shared ends and closes the circle', async () => {
    await openParts();
    const rows = within(screen.getByRole('list', { name: 'Gibson assembly order' })).getAllByRole(
      'listitem',
    );
    expect(rows.map((li) => li.textContent)).toEqual([
      '1pBackbone70 bp',
      expect.stringContaining('20 bp overlap'),
      '2gfp70 bp',
      expect.stringContaining('closes: 20 bp overlap'),
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Assemble by Gibson' }));
    const product = editorStore.document;
    expect(product?.name).toBe('pBackbone+gfp assembly');
    expect(product?.isCircular).toBe(true);
    // Seamless: each shared stretch is in the product once.
    expect(product?.sequence.toString()).toBe(`${A}${vectorBody}${B}${insertBody}`);
  });

  it('says what is missing when a part is left out of the tube', async () => {
    await openParts();
    const tube = (): HTMLElement =>
      within(screen.getByRole('list', { name: 'Documents in the Gibson' })).getByRole('checkbox', {
        name: 'gfp',
      });
    fireEvent.click(tube());
    expect(screen.queryByRole('button', { name: 'Assemble by Gibson' })).not.toBeInTheDocument();
    expect(screen.getByText(/do not close into a circle/)).toBeInTheDocument();
    fireEvent.click(tube());
    expect(screen.getByRole('button', { name: 'Assemble by Gibson' })).toBeEnabled();
  });

  it('takes a part off the ligation shelf as well as an open document', async () => {
    render(<App />);
    act(() => {
      editorStore.clearShelf();
      editorStore.openDocument(vector, 'pBackbone.gb');
      // The insert arrives as a digest fragment rather than a file, the way
      // a backbone cut out of a plasmid does.
      editorStore.addToShelf({
        sequence: insert.sequence.toString(),
        features: [],
        range: { start: 0, end: insert.length },
        left: BLUNT_END,
        right: BLUNT_END,
        source: 'gfp cassette',
      });
    });
    await waitFor(() => {
      expect(editorStore.getState().analysis?.doc).toBe(editorStore.document);
    });
    openBench('Gibson');

    const tube = screen.getByRole('list', { name: 'Documents in the Gibson' });
    expect(within(tube).getByRole('checkbox', { name: 'pBackbone' })).toBeChecked();
    expect(within(tube).getByRole('checkbox', { name: 'gfp cassette fragment' })).toBeChecked();
    expect(within(tube).getByText('70 bp from the shelf')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Assemble by Gibson' }));
    const product = editorStore.document;
    expect(product?.isCircular).toBe(true);
    expect(product?.sequence.toString()).toBe(`${A}${vectorBody}${B}${insertBody}`);
    act(() => {
      editorStore.clearShelf();
    });
  });

  it('refuses the junctions when more homology is asked for', async () => {
    await openParts();
    fireEvent.change(screen.getByRole('combobox', { name: /Overlap/ }), {
      target: { value: '25' },
    });
    expect(screen.queryByRole('list', { name: 'Gibson assembly order' })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing follows|do not close/)).toBeInTheDocument();
  });
});

describe('share links', () => {
  afterEach(() => {
    globalThis.location.hash = '';
  });

  it('opens the document a link carries, and takes it off the address bar', async () => {
    const example = EXAMPLES[0];
    if (example === undefined) throw new Error('expected a bundled example');
    const doc = parseGenBank(example.text).documents[0];
    if (doc === undefined) throw new Error('expected a document');
    const url = await shareUrlFor(doc, 'https://example.org/PlasmidPop/');
    globalThis.location.hash = new URL(url).hash;

    render(<App />);
    await waitFor(() => {
      expect(editorStore.document?.name).toBe(doc.name);
    });
    expect(editorStore.document?.sequence.toString()).toBe(doc.sequence.toString());
    expect(editorStore.document?.features.all()).toHaveLength(doc.features.all().length);
    // The sequence has no business staying in the URL or in this browser's history.
    expect(globalThis.location.hash).toBe('');
  });

  it('says what a copied link is, and the notice can be dismissed', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fileMenu(/^Copy share link/);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/Share link copied — [\d,]+ characters/);
    expect(notice).toHaveTextContent(/nothing was uploaded/);
    fireEvent.click(within(notice).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Share link copied/)).not.toBeInTheDocument();
  });

  it('copies a link to the selection only, and says so (#39)', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    expect(screen.getByRole('menuitem', { name: /^Copy link to selection/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'File' }));
    act(() => {
      editorStore.setSelection({ start: 0, end: 300 });
    });
    fileMenu(/^Copy link to selection/);
    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(/Link to the selection copied — [\d,]+ characters/);
  });

  it('reports a damaged link instead of opening a tab', async () => {
    globalThis.location.hash = '#d=1thisisnotapayload';
    render(<App />);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/damaged/);
    });
    expect(editorStore.getState().documents).toHaveLength(0);
  });
});

describe('App on a narrow window', () => {
  // Answer the queries of a window under 720 px that is not a phone.
  const real = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeEach(() => {
    const matchMedia = (query: string): MediaQueryList =>
      ({
        matches: query === SIDEBAR_STACKED_QUERY || query === VIEWS_STACKED_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      value: matchMedia,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    if (real === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', real);
  });

  it('gives the sidebar under the editor a handle of its own, and remembers its height', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const handle = screen.getByRole('separator', { name: 'Resize the sidebar' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    const main = () => document.querySelector('.app__main')?.getAttribute('style') ?? '';
    expect(main()).toContain(`${DEFAULT_LAYOUT.sidebarHeightStacked}px`);
    act(() => {
      editorStore.setLayout({ sidebarHeightStacked: 320 });
    });
    expect(main()).toContain('320px');
    fireEvent.doubleClick(handle);
    expect(editorStore.getState().layout.sidebarHeightStacked).toBe(
      DEFAULT_LAYOUT.sidebarHeightStacked,
    );
    act(() => {
      editorStore.setSidebarOpen(false);
    });
    expect(screen.queryByRole('separator', { name: 'Resize the sidebar' })).toBeNull();
    act(() => {
      editorStore.setSidebarOpen(true);
    });
  });
});

describe('App on a phone', () => {
  // jsdom has no matchMedia; answer the phone query alone and put it back after.
  const real = Object.getOwnPropertyDescriptor(window, 'matchMedia');
  beforeEach(() => {
    const matchMedia = (query: string): MediaQueryList =>
      ({
        matches: query === PHONE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }) as MediaQueryList;
    Object.defineProperty(window, 'matchMedia', {
      value: matchMedia,
      configurable: true,
      writable: true,
    });
  });
  afterEach(() => {
    if (real === undefined) Reflect.deleteProperty(window, 'matchMedia');
    else Object.defineProperty(window, 'matchMedia', real);
  });

  it('reads one pane at a time, with the size and shape above and nothing to drag', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /open pBR322/i }));
    expect(screen.getByText('4,361 bp, circular')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Show' })).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    expect(screen.getByRole('img', { name: /^Map of/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    const [tet] = screen.getAllByRole('button', { name: /^tetgene/i });
    if (tet === undefined) throw new Error('expected a tet feature');
    // Tapping a feature in the list goes to where it is.
    fireEvent.click(tet);
    expect(screen.getByRole('img', { name: /^Map of/ })).toBeInTheDocument();
    expect(screen.getByText(/bp selected/)).toBeInTheDocument();
  });
});
