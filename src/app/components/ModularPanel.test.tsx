// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { DEFAULT_BENCH, DESTINATION_TAG, NO_POSITION_TAG } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { ModularPanel } from './ModularPanel';

function part(name: string, left: string, payload: string, right: string): SeqDocument {
  return SeqDocument.create({ name, sequence: `TTGGTCTCA${left}${payload}${right}AGAGACCTT` });
}
const dest = SeqDocument.create({
  name: 'pDest',
  topology: 'circular',
  sequence: 'CGCTCCCCCCCCCCGGAGAGAGACCTTTTGGTCTCA',
});
const pro1 = part('pro1', 'GGAG', 'AAAAAAAAAA', 'AATG');
const pro2 = part('pro2', 'GGAG', 'AAAACCCCAA', 'AATG');
const cds = part('cds', 'AATG', 'TTTTTTTTTT', 'GCTT');
const bad = part('cdsBad', 'AATG', 'TTTTGGGGTT', 'AAAA');
const term = part('term', 'GCTT', 'GGGGGGGGGG', 'CGCT');
const stray = part('stray', 'ACAC', 'GGGGGGGGGG', 'CACA');

function setup(docs: readonly SeqDocument[]): void {
  act(() => {
    for (const d of docs) editorStore.openDocument(d);
    editorStore.setCloningReaction('modular');
  });
  render(<ModularPanel />);
}

describe('ModularPanel (#214)', () => {
  afterEach(async () => {
    for (const s of editorStore.getState().customStandards) await persistence.removeStandard(s.id);
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('places the parts by their ends and plans every combination', () => {
    setup([dest, pro1, pro2, cds, term]);
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent('2 combinations: 2 assemble.');
    const slots = within(screen.getByRole('list', { name: 'Plan slots' }));
    expect(slots.getByText('Destination')).toBeInTheDocument();
    expect(slots.getByText(/GGAG-AATG · pro1, pro2/)).toBeInTheDocument();
    expect(screen.getByLabelText('Position of pro1').textContent).toContain(
      'Detected: Promoter + 5′UTR',
    );
  });

  it('lists the combinations that cannot form, and opens one that can', () => {
    setup([dest, pro1, cds, bad, term]);
    expect(screen.getByText(/Not placed: cdsBad/)).toBeInTheDocument();
    // Set by hand to the CDS slot, though its ends do not fit there.
    act(() => {
      fireEvent.change(screen.getByLabelText('Position of cdsBad'), { target: { value: 'CDS' } });
    });
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent(
      '2 combinations: 1 assemble, 1 cannot form.',
    );
    const products = within(screen.getByRole('list', { name: 'Plan products' }));
    expect(products.getAllByRole('listitem')[0]).toHaveTextContent('pDest + pro1 + cdsBad + term');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble pDest + pro1 + cds + term' }));
    });
    expect(editorStore.document?.name).toBe('pDest+pro1+cds+term assembly');
  });

  it('opens every product that forms with Assemble all', () => {
    setup([dest, pro1, pro2, cds, term]);
    const before = editorStore.getState().documents.length;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Assemble all 2' }));
    });
    expect(editorStore.getState().documents.length).toBe(before + 2);
  });

  it('says which parts it could not place, and takes a position by hand', () => {
    setup([dest, pro1, cds, term, stray]);
    expect(screen.getByText(/Not placed: stray/)).toBeInTheDocument();
    act(() => {
      fireEvent.change(screen.getByLabelText('Position of stray'), {
        target: { value: NO_POSITION_TAG },
      });
    });
    expect(screen.getByLabelText('Position of stray')).toHaveValue(NO_POSITION_TAG);
    act(() => {
      fireEvent.change(screen.getByLabelText('Position of stray'), { target: { value: 'CDS' } });
    });
    // Two parts in the CDS slot, one that cannot join.
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent(/2 combinations/);
    act(() => {
      fireEvent.change(screen.getByLabelText('Position of pDest'), {
        target: { value: DESTINATION_TAG },
      });
    });
    expect(screen.getByLabelText('Plan summary')).toHaveTextContent(/2 combinations/);
  });

  it('reports a ring with a position missing', () => {
    setup([dest, pro1, term]);
    expect(screen.getByText(/Nothing follows Promoter \+ 5′UTR/)).toBeInTheDocument();
  });

  it('imports a standard from a file and keeps it', async () => {
    setup([dest, pro1, cds, term]);
    const input = screen.getByLabelText('Standard file');
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [new File(['# Mine\nA,GGAG,AATG\nB,AATG,GCTT'], 'mine.csv')] },
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText('Mine: 2 positions.')).toBeInTheDocument();
    expect(editorStore.getState().customStandards.map((s) => s.name)).toEqual(['Mine']);
    expect(editorStore.getState().bench.modular.standard).toBe('custom:mine');
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(['A,GG,'], 'bad.csv')] } });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(await screen.findByText(/overhangs should be 2 to 6 bases/)).toBeInTheDocument();
  });

  it('asks for parts when the tube is empty', () => {
    act(() => {
      editorStore.setCloningReaction('modular');
    });
    render(<ModularPanel />);
    expect(screen.getByText(/Open the destination vector and the parts/)).toBeInTheDocument();
  });
});
