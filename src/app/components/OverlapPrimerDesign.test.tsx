// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { vi } from 'vitest';

import { SeqDocument } from '@/core';

import { copyText } from '../clipboard';
import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { OverlapPrimerDesign } from './OverlapPrimerDesign';

vi.mock('../clipboard', () => ({ copyText: vi.fn() }));

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const VECTOR = filler(2000, 31).toLowerCase();
const vector = SeqDocument.create({ name: 'pCut', sequence: VECTOR, topology: 'linear' });
const source = SeqDocument.create({ name: 'gDNA', sequence: filler(3000, 77), topology: 'linear' });

describe('OverlapPrimerDesign', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('puts the vector’s ends on the tails and closes the circle', () => {
    act(() => {
      editorStore.openDocument(vector);
      editorStore.openDocument(source);
      editorStore.setSelection({ start: 800, end: 1600 });
    });
    render(<OverlapPrimerDesign />);
    // The design folds away under the Gibson panel until it is wanted;
    // jsdom does not open a <details> on a click, so it is opened here.
    act(() => {
      screen
        .getByText('Design insert primers (In-Fusion, NEBuilder)')
        .closest('details')
        ?.setAttribute('open', '');
    });
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('Linearised vector'), { target: { value: ids[0] } });
      fireEvent.change(screen.getByLabelText('Insert from'), { target: { value: ids[1] } });
    });
    const primers = within(screen.getByRole('list', { name: 'Insert primers' }));
    // In-Fusion's 15 bases of vector by default.
    expect(primers.getAllByText(/15 of vector/)).toHaveLength(2);
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,800 bp, circular');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'NEBuilder HiFi' }));
    });
    expect(primers.getAllByText(/20 of vector/)).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.document?.isCircular).toBe(true);
    expect(editorStore.document?.length).toBe(2800);
  });

  it('offers all of a linear template when its tab has no selection', () => {
    act(() => {
      editorStore.openDocument(vector);
      editorStore.openDocument(source);
    });
    render(<OverlapPrimerDesign />);
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('Insert from'), { target: { value: ids[1] } });
    });
    const insert = screen.getByRole('combobox', { name: 'Insert' });
    expect(
      within(insert)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      `All of it (1–${source.length.toLocaleString()}, ${source.length.toLocaleString()} bp)`,
    ]);
  });

  it('writes a selection through the origin of a circular template with its end wrapped (#143)', () => {
    const plasmid = SeqDocument.create({
      name: 'pSrc',
      sequence: filler(600, 5),
      topology: 'circular',
    });
    act(() => {
      editorStore.openDocument(vector);
      editorStore.openDocument(plasmid);
      editorStore.setSelection({ start: 590, end: 620 });
    });
    render(<OverlapPrimerDesign />);
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('Insert from'), { target: { value: ids[1] } });
    });
    const insert = screen.getByRole('combobox', { name: 'Insert' });
    expect(within(insert).getAllByRole('option')[0]?.textContent).toBe(
      'The selection (591–20, 30 bp)',
    );
  });
});

describe('OverlapPrimerDesign with several inserts (#413)', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('adds an insert, designs the junction tails, and takes it away again', () => {
    act(() => {
      editorStore.openDocument(vector);
      editorStore.openDocument(source);
      editorStore.setSelection({ start: 500, end: 1200 });
    });
    const other = SeqDocument.create({
      name: 'gene2',
      sequence: filler(1500, 5),
      topology: 'linear',
    });
    act(() => {
      editorStore.openDocument(other);
    });
    render(<OverlapPrimerDesign fixedKit="yeast" />);
    act(() => {
      screen
        .getByText('Design insert primers (Yeast assembly)')
        .closest('details')
        ?.setAttribute('open', '');
    });
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.change(screen.getByLabelText('Linearised vector'), { target: { value: ids[0] } });
      fireEvent.change(screen.getByLabelText('Insert from'), { target: { value: ids[1] } });
    });
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,700 bp, circular');

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add another insert' }));
    });
    act(() => {
      fireEvent.change(screen.getByLabelText('Insert 2 from'), { target: { value: ids[2] } });
    });
    // Vector 2,000 + 700 + the whole of the linear second insert, 1,500.
    expect(screen.getByLabelText('Product')).toHaveTextContent('4,200 bp, circular');
    expect(screen.getByRole('list', { name: 'Insert 1 primers' })).toBeInTheDocument();
    // Insert 1's forward tail is 40 of vector; the junction is half on each primer.
    const first = within(screen.getByRole('list', { name: 'Insert 1 primers' }));
    expect(first.getByText(/40 of vector/)).toBeInTheDocument();
    expect(first.getByText(/20 of homology/)).toBeInTheDocument();

    // Each primer copies the sequence its row shows, under the row's label.
    vi.mocked(copyText).mockClear();
    const copy = first.getByRole('button', { name: 'Copy the insert 1 forward primer' });
    const shown = copy.closest('li')?.querySelector('code')?.textContent ?? '';
    expect(shown).toMatch(/^[ACGT]+$/i);
    act(() => {
      fireEvent.click(copy);
    });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(shown);

    act(() => {
      fireEvent.change(screen.getByLabelText('Homology between inserts'), {
        target: { value: 'forward' },
      });
    });
    const second = within(screen.getByRole('list', { name: 'Insert 2 primers' }));
    expect(second.getByText(/40 of homology/)).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove insert 2' }));
    });
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,700 bp, circular');
    expect(screen.queryByLabelText('Insert 2 from')).toBeNull();
  });
});
