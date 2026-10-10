// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, within } from '@testing-library/react';

import { SeqDocument } from '@/core';
import { getRepository } from '@/storage';

import { DEFAULT_BENCH, normalizeBenchSettings } from '../state/benchSettings';
import { editorStore } from '../state/editorStore';
import { primerCollection } from '../state/primerCollection';
import { SoePanel } from './SoePanel';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const a = SeqDocument.create({ name: 'partA', sequence: filler(900, 5), topology: 'linear' });
const b = SeqDocument.create({ name: 'partB', sequence: filler(700, 6), topology: 'linear' });
const c = SeqDocument.create({ name: 'partC', sequence: filler(600, 7), topology: 'linear' });

function pick(): void {
  const ids = editorStore.getState().documents.map((d) => d.documentId);
  act(() => {
    fireEvent.change(screen.getByLabelText('Fragment 1 from'), { target: { value: ids[0] } });
    fireEvent.change(screen.getByLabelText('Fragment 2 from'), { target: { value: ids[1] } });
  });
}

describe('SoePanel', () => {
  beforeEach(async () => {
    await primerCollection.load();
    await primerCollection.remove(primerCollection.getState().primers.map((p) => p.id));
  });
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
      editorStore.restoreBench(DEFAULT_BENCH);
    });
  });

  it('asks for the fragments, then lists the primers and the overlap', () => {
    act(() => {
      editorStore.openDocument(a);
      editorStore.openDocument(b);
    });
    render(<SoePanel />);
    expect(screen.getByText(/Choose a tab, and the part of it/)).toBeTruthy();
    pick();
    const primers = within(screen.getByRole('list', { name: 'Overlap-extension primers' }));
    expect(primers.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByText(/Junction 1: \d+ bp overlap, Tm \d+ °C/)).toBeTruthy();
    expect(screen.getByLabelText('Product')).toHaveTextContent('1,600 bp, linear');
  });

  it('opens the fused product with how it was made', () => {
    act(() => {
      editorStore.openDocument(a);
      editorStore.openDocument(b);
    });
    render(<SoePanel />);
    pick();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Open product' }));
    });
    expect(editorStore.document?.length).toBe(1600);
    expect(editorStore.document?.isCircular).toBe(false);
    expect(editorStore.document?.metadata.lineage?.step?.op).toBe('pcr');
  });

  it('takes a third fragment, and puts the order back when one is moved', () => {
    act(() => {
      editorStore.openDocument(a);
      editorStore.openDocument(b);
      editorStore.openDocument(c);
    });
    render(<SoePanel />);
    const ids = editorStore.getState().documents.map((d) => d.documentId);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add fragment' }));
    });
    act(() => {
      ids.forEach((id, i) => {
        fireEvent.change(screen.getByLabelText(`Fragment ${i + 1} from`), {
          target: { value: id },
        });
      });
    });
    expect(screen.getByLabelText('Product')).toHaveTextContent('2,200 bp');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Move fragment 3 up' }));
    });
    expect(screen.getByLabelText('Fragment 2 from')).toHaveValue(ids[2]);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove fragment 3' }));
    });
    expect(screen.queryByLabelText('Fragment 3 from')).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove fragment 2' })).toBeDisabled();
  });

  it('keeps the primers in My primers', async () => {
    act(() => {
      editorStore.openDocument(a);
      editorStore.openDocument(b);
    });
    render(<SoePanel />);
    pick();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save primers' }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await screen.findByText('Saved 4 primers to My primers.')).toBeTruthy();
    const stored = await getRepository().loadPrimers();
    expect(stored.map((p) => p.name)).toEqual([
      'SOE partA-partB F1',
      'SOE partA-partB R1',
      'SOE partA-partB F2',
      'SOE partA-partB R2',
    ]);
    expect(stored[1]?.notes).toMatch(/inner reverse primer for partA/);
  });

  it('refuses a design that does not work in words', () => {
    const tiny = SeqDocument.create({ name: 'tiny', sequence: 'ACGTACGTAC', topology: 'linear' });
    act(() => {
      editorStore.openDocument(a);
      editorStore.openDocument(tiny);
    });
    render(<SoePanel />);
    pick();
    expect(screen.getByText(/too short to fuse/)).toBeTruthy();
  });
});

describe('the Bench settings of an overlap PCR', () => {
  it('read back as they were left, and mended when they are not', () => {
    expect(
      normalizeBenchSettings({
        soe: {
          fragments: [{ templateId: 'x', insert: 'whole' }, { templateId: 'y' }],
          overlapTm: 65,
        },
      }).soe,
    ).toEqual({
      fragments: [
        { templateId: 'x', insert: 'whole' },
        { templateId: 'y', insert: '' },
      ],
      overlapTm: 65,
      name: '',
    });
    expect(normalizeBenchSettings({ soe: { fragments: 'nope', overlapTm: 3 } }).soe).toEqual(
      DEFAULT_BENCH.soe,
    );
    expect(
      normalizeBenchSettings({ soe: { fragments: [{ templateId: 'x' }] } }).soe.fragments,
    ).toEqual(DEFAULT_BENCH.soe.fragments);
  });
});
