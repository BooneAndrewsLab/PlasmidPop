// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { getRepository } from '@/storage';

import type * as SaveFile from '../saveFile';
import { downloadText } from '../saveFile';
import { myPartsStore } from '../state/myParts';
import { FeatureEditor } from './FeatureEditor';
import { MyPartsSection } from './MyParts';

vi.mock('../saveFile', async (importOriginal) => ({
  ...(await importOriginal<typeof SaveFile>()),
  downloadText: vi.fn(),
}));

const PROMOTER = 'TTGACAATTAATCATCGGCTCGTATAATGTGTGGA';

function file(name: string, text: string): File {
  return new File([text], name, { type: 'text/plain' });
}

async function choose(label: string, files: File[]): Promise<void> {
  const input = screen.getByLabelText(label);
  await act(async () => {
    fireEvent.change(input, { target: { files } });
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('My parts in the Features tab (#210)', () => {
  it('adds parts from a FASTA file, keeps them in IndexedDB, and downloads them as GenBank', async () => {
    render(<MyPartsSection />);
    fireEvent.click(screen.getByRole('button', { name: /My parts/ }));
    await screen.findByText(/0 parts in this browser/);
    await choose('Add parts from a GenBank or FASTA file', [
      file('lab.fa', `>lab promoter\n${PROMOTER}\n>too short\nACGT\n`),
    ]);
    await screen.findByText(/Added 1 part; left out: 1 too short/);
    expect(await getRepository().loadMyParts()).toMatchObject([
      { name: 'lab', sequence: PROMOTER },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Download as GenBank' }));
    expect(vi.mocked(downloadText).mock.calls[0]?.[0]).toBe('my-parts.gb');
    expect(vi.mocked(downloadText).mock.calls[0]?.[1]).toContain('LOCUS');
    await act(() => myPartsStore.remove(myPartsStore.getState().parts.map((p) => p.id)));
  });

  it('imports a pLannotate database from its FASTA and table, labelled with its source, and removes the list', async () => {
    render(<MyPartsSection />);
    fireEvent.click(screen.getByRole('button', { name: /My parts/ }));
    await choose('Import a pLannotate database', [
      file('snapgene.csv', 'sseqid,name,type,blurb\nT7_promoter,T7 promoter,promoter,Phage\n'),
      file('snapgene.fasta', `>T7_promoter\n${PROMOTER}\n`),
    ]);
    await screen.findByText(/pLannotate snapgene: 1 sequence read, 1 described/);
    expect(myPartsStore.getState().parts).toMatchObject([
      { name: 'T7 promoter', origin: 'pLannotate: snapgene' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove this list' }));
    await waitFor(() => {
      expect(myPartsStore.getState().parts).toEqual([]);
    });
  });

  it('explains a table chosen without its FASTA', async () => {
    render(<MyPartsSection />);
    fireEvent.click(screen.getByRole('button', { name: /My parts/ }));
    await choose('Import a pLannotate database', [file('snapgene.csv', 'sseqid,name\na,b\n')]);
    await screen.findByText(/Choose the FASTA file/);
  });
});

describe('Save to My parts', () => {
  it('keeps a feature of the document as a part', async () => {
    const doc = SeqDocument.create({
      name: 'c',
      sequence: `AAAAAAAAAA${PROMOTER}CCCCCCCCCC`,
      features: [
        createFeature({
          type: 'promoter',
          name: 'pX',
          segments: [rangeSegment(10, 10 + PROMOTER.length)],
        }),
      ],
    });
    const feature = doc.features.all()[0];
    if (feature === undefined) throw new Error('no feature');
    render(<FeatureEditor doc={doc} feature={feature} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save to My parts' }));
    await screen.findByText('Saved to My parts.');
    expect(myPartsStore.getState().parts).toMatchObject([{ name: 'pX', sequence: PROMOTER }]);
    fireEvent.click(screen.getByRole('button', { name: 'Save to My parts' }));
    await screen.findByText('Already in My parts.');
  });
});
