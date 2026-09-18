// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { editorStore } from './state/editorStore';
import { App } from './App';

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

  it('renames the document from the toolbar', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('button', { name: 'SYNPBR322' }));
    const field = screen.getByRole('textbox', { name: 'Document name' });
    expect(field).toHaveValue('SYNPBR322');
    fireEvent.change(field, { target: { value: '  pBR322 edited ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(editorStore.document?.name).toBe('pBR322 edited');
    expect(screen.getByRole('button', { name: /pBR322 edited/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document name' })).toBeNull();
    // Escape cancels.
    fireEvent.click(screen.getByRole('button', { name: /pBR322 edited/ }));
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

  it('lists restriction enzymes and ORFs once analysis finishes', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Enzymes' }));
    await waitFor(() => {
      expect(screen.getByText('EcoRI')).toBeInTheDocument();
    });
    // pBR322 has single EcoRI, BamHI, PstI sites among others
    expect(screen.getByRole('checkbox', { name: /EcoRI/ })).toBeChecked();
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
    expect(screen.getByText('4,361 bp, circular')).toBeInTheDocument();
  });
});
