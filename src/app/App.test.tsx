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
