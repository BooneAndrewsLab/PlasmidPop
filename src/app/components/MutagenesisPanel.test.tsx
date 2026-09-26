// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument, createFeature, editedSinceMade, rangeSegment } from '@/core';

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
    // It is the molecule its lineage records, made from the template (#67).
    expect(mutant?.metadata.lineage?.step).toMatchObject({
      op: 'mutagenesis',
      change: `${old}801${next}`,
      method: 'overlapping',
    });
    expect(mutant?.metadata.lineage?.step?.parents[0]?.name).toBe('pTest');
    expect(mutant !== null && editedSinceMade(mutant)).toBe(false);
    // The change is the mutant's one edit, so Undo gives the template back.
    act(() => {
      editorStore.undo();
    });
    expect(editorStore.document?.sequence.toString()).toBe(TEXT);
    const undone = editorStore.document;
    expect(undone !== null && editedSinceMade(undone)).toBe(true);
  });
});

/** The first of the elements found, which a test expects to be there. */
function first(elements: readonly HTMLElement[]): HTMLElement {
  const [element] = elements;
  if (element === undefined) throw new Error('nothing found');
  return element;
}

describe('MutagenesisPanel: changing a residue (#69)', () => {
  // A CDS of M K E F * in the middle of the plasmid, on the forward strand.
  const coding = 'ATGAAAGAATTCTAA';
  const withCds = SeqDocument.create({
    name: 'pCds',
    sequence: `${TEXT.slice(0, 500)}${coding}${TEXT.slice(515)}`,
    topology: 'circular',
    features: [
      createFeature({
        id: 'cds',
        type: 'CDS',
        name: 'gene',
        strand: 'forward',
        segments: [rangeSegment(500, 515)],
      }),
    ],
  });

  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  function open(position: number) {
    act(() => {
      editorStore.openDocument(withCds);
    });
    const view = render(<MutagenesisPanel doc={withCds} />);
    act(() => {
      editorStore.setSelection({ start: position, end: position });
    });
    return view;
  }

  it('names the codon under the caret and offers the host its commonest codons', () => {
    open(504); // the second codon, AAA (K)
    expect(screen.getByText(/gene K2 \(AAA\)/)).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByLabelText('New amino acid'), { target: { value: 'R' } });
    });
    const codons = within(screen.getByRole('list', { name: 'Codons for the new residue' }));
    const buttons = codons.getAllByRole('button').map((b) => b.textContent);
    // E. coli's arginine codons, its commonest (CGC) first and starred.
    expect(buttons[0]).toMatch(/^CGC/);
    expect(buttons[0]).toContain('★');
    expect(buttons).toHaveLength(6);

    // Picking one selects the codon and puts its bases in the change box.
    act(() => {
      fireEvent.click(first(codons.getAllByRole('button')));
    });
    expect(editorStore.getState().selection).toEqual({ start: 503, end: 506 });
    expect(screen.getByLabelText('Change to')).toHaveValue('CGC');
    expect(screen.getByText('AAA504–506CGC')).toBeInTheDocument();
    // And the panel says what it does to the protein.
    expect(screen.getByText(/gene K2R/)).toBeInTheDocument();
  });

  it('orders the codons by the host that is picked', () => {
    open(504);
    act(() => {
      fireEvent.change(screen.getByLabelText('New amino acid'), { target: { value: 'R' } });
      fireEvent.change(screen.getByLabelText('Codon usage host'), { target: { value: 'yeast' } });
    });
    const codons = within(screen.getByRole('list', { name: 'Codons for the new residue' }));
    expect(codons.getAllByRole('button')[0]?.textContent).toMatch(/^AGA/);
  });

  it('makes a library from a degenerate codon, and says what it covers', () => {
    open(504);
    act(() => {
      fireEvent.change(screen.getByLabelText('Degenerate codon'), { target: { value: 'NNK' } });
    });
    expect(screen.getByLabelText('Change to')).toHaveValue('NNK');
    // 32 codons, every amino acid and one stop; 95 colonies give a 95 %
    // chance of any one of the 32.
    const said = screen.getByText(/32 codons for 20 amino acids/).textContent;
    expect(said).toContain('one stop');
    expect(said).toContain('about 95 colonies');
  });

  it('gives NEB its own Tm and annealing temperature for a Q5 design', () => {
    open(504);
    act(() => {
      fireEvent.change(screen.getByLabelText('New amino acid'), { target: { value: 'R' } });
    });
    const codons = within(screen.getByRole('list', { name: 'Codons for the new residue' }));
    act(() => {
      fireEvent.click(first(codons.getAllByRole('button')));
    });
    const primers = within(screen.getByRole('list', { name: 'Mutagenesis primers' }));
    expect(primers.getAllByText(/NEB Q5 \d+ °C/)).toHaveLength(2);
    expect(screen.getByText(/annealing at \d+ °C \(NEB's for Q5\)/)).toBeInTheDocument();
    // Agilent's design is not a Q5 protocol, so neither is said of it.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Overlapping' }));
    });
    expect(screen.queryByText(/NEB Q5/)).toBeNull();
    expect(screen.queryByText(/annealing at/)).toBeNull();
  });

  it('offers no residue when the selection covers more than one codon', () => {
    open(504);
    expect(screen.getByLabelText('New amino acid')).toBeInTheDocument();
    act(() => {
      editorStore.setSelection({ start: 504, end: 508 });
    });
    expect(screen.queryByLabelText('New amino acid')).toBeNull();
    // Outside the CDS there is no codon either.
    act(() => {
      editorStore.setSelection({ start: 100, end: 100 });
    });
    expect(screen.queryByLabelText('New amino acid')).toBeNull();
  });
});
