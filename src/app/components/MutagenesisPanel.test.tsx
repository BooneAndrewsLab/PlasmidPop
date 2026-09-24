// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { MutagenesisPanel } from './MutagenesisPanel';

function template(length: number, seed = 424242): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const TEXT = template(2000).toLowerCase();
const doc = SeqDocument.create({ name: 'pTest', sequence: TEXT, topology: 'circular' });

describe('MutagenesisPanel', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('designs the primers for the selection and opens the mutant as an undoable edit', () => {
    act(() => {
      editorStore.openDocument(doc);
    });
    render(<MutagenesisPanel doc={doc} />);
    expect(screen.getByText(/Select the bases to change/)).toBeInTheDocument();
    act(() => {
      editorStore.setSelection({ start: 800, end: 801 });
    });
    const old = TEXT.charAt(800).toUpperCase();
    const next = old === 'G' ? 'T' : 'G';
    act(() => {
      fireEvent.change(screen.getByLabelText('Change to'), { target: { value: next } });
    });
    expect(screen.getByText(`${old}801${next}`)).toBeInTheDocument();
    const primers = within(screen.getByRole('list', { name: 'Mutagenesis primers' }));
    expect(primers.getByText(/^Forward$/)).toBeInTheDocument();
    expect(primers.getAllByRole('button', { name: /Copy the/ })).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Overlapping' }));
    });
    expect(primers.getAllByText(/\(Agilent\)/)).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open mutant' }));
    });
    const mutant = editorStore.document;
    expect(mutant?.name).toBe(`pTest ${old}801${next}`);
    expect(mutant?.sequence.charAt(800)).toBe(next);
    // The change is the mutant's one edit, so Undo gives the template back.
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.sequence.toString()).toBe(TEXT);
  });
});
