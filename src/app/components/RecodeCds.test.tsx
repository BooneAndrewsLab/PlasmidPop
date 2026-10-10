// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import {
  SeqDocument,
  createFeature,
  rangeSegment,
  reverseComplement,
  translate,
  translateCds,
} from '@/core';

import { editorStore } from '../state/editorStore';
import { ProteinPanel } from './ProteinPanel';
import { TranslatePanel } from './TranslatePanel';

// ATG, rare codons for Leu Leu Glu Phe Lys, stop; EcoRI inside.
const CDS = 'ATGTTATTAGAATTCAAATAA';

function docOf(strand: 'forward' | 'reverse'): SeqDocument {
  const body = strand === 'forward' ? CDS : reverseComplement(CDS);
  return SeqDocument.create({
    name: 'gene',
    sequence: `GGGG${body}CCCC`,
    features: [
      createFeature({
        type: 'CDS',
        name: 'orf',
        strand,
        segments: [rangeSegment(4, 4 + CDS.length)],
      }),
    ],
  });
}

function open(doc: SeqDocument): void {
  act(() => {
    editorStore.openDocument(doc);
  });
}

describe('Recode on the Translate tab (#209)', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  for (const strand of ['forward', 'reverse'] as const) {
    it(`previews, then applies as one undo step, on the ${strand} strand`, async () => {
      const doc = docOf(strand);
      open(doc);
      render(<TranslatePanel doc={doc} />);
      fireEvent.click(screen.getByRole('button', { name: 'Recode…' }));
      fireEvent.change(screen.getByLabelText('Enzymes whose sites to avoid'), {
        target: { value: 'EcoRI' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Recode' }));
      await waitFor(() => {
        expect(screen.getByText(/The protein reads the same/)).toBeInTheDocument();
      });
      // Nothing has changed yet.
      expect(editorStore.getState().history?.present).toBe(doc);
      const stepsBefore = editorStore.getState().history?.undoDepth ?? 0;
      fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
      const after = editorStore.getState().history?.present;
      if (after === undefined) throw new Error('no document');
      expect(after.length).toBe(doc.length);
      expect(after.sequence.toString()).not.toBe(doc.sequence.toString());
      const feature = after.features.all()[0];
      if (feature === undefined) throw new Error('no feature');
      expect(translateCds(after, feature).protein).toBe(translate(CDS));
      const gene = after.subsequence({ start: 4, end: 4 + CDS.length });
      expect(strand === 'forward' ? gene : reverseComplement(gene)).not.toContain('GAATTC');
      expect(feature.qualifiers.some((q) => q.value?.startsWith('Recoded for E. coli'))).toBe(true);
      // The bases and the note are one step, and Undo takes both back.
      expect(editorStore.getState().history?.undoDepth).toBe(stepsBefore + 1);
      expect(editorStore.getState().history?.undoLabel).toMatch(/^Recode orf for E\. coli/);
      act(() => {
        editorStore.undo();
      });
      expect(editorStore.getState().history?.present.sequence.toString()).toBe(
        doc.sequence.toString(),
      );
      expect(editorStore.getState().history?.present.features.all()[0]?.qualifiers).toEqual([]);
    });
  }

  it('is disabled, and says why, for a CDS made of pieces', () => {
    const doc = SeqDocument.create({
      name: 'spliced',
      sequence: 'ATGAAATTTCCCGGGTAA',
      features: [
        createFeature({
          type: 'CDS',
          segments: [rangeSegment(0, 6), rangeSegment(9, 18)],
        }),
      ],
    });
    open(doc);
    render(<TranslatePanel doc={doc} />);
    const button = screen.getByRole('button', { name: 'Recode…' });
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/several pieces/);
  });
});

describe('Back-translate on the Protein tab (#209)', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('opens a DNA document that translates to the protein', async () => {
    const protein = SeqDocument.create({ name: 'prot', sequence: 'MKLVEF', alphabet: 'protein' });
    open(protein);
    render(<ProteinPanel doc={protein} />);
    fireEvent.click(screen.getByRole('button', { name: 'Back-translate' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open as DNA' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Open as DNA' }));
    const dna = editorStore.getState().history?.present;
    if (dna === undefined) throw new Error('no document');
    expect(dna.alphabet).toBe('nucleotide');
    expect(translate(dna.sequence.toString())).toBe('MKLVEF*');
    expect(dna.features.all()[0]?.type).toBe('CDS');
  });
});
