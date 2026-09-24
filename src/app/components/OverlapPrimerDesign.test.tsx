// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { DEFAULT_BENCH } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { OverlapPrimerDesign } from './OverlapPrimerDesign';

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
});
