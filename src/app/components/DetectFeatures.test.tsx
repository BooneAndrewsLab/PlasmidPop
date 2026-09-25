// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, createFeature, rangeSegment } from '@/core';
import pBR322 from '@/io/fixtures/J01749.gb?raw';
import { parseSequenceFile } from '@/io';

import { openFile } from '../openFile';
import { detectionStore } from '../state/detection';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { FeatureList } from './FeatureList';

function bases(): string {
  const [doc] = parseSequenceFile(pBR322, 'J01749.gb').documents;
  if (doc === undefined) throw new Error('no fixture');
  return doc.sequence.toString();
}

/** The Features tab of whatever document is in front, as the app shows it. */
function Tab() {
  const { history } = useEditorState();
  return history === null ? null : <FeatureList doc={history.present} />;
}

function openBare(sequence: string, name = 'bare'): string {
  let id = '';
  act(() => {
    id = editorStore.openDocument(SeqDocument.create({ name, sequence, topology: 'circular' }));
  });
  return id;
}

afterEach(() => {
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.setDetectOnOpen(false);
  });
});

describe('Detect features', () => {
  it('offers the parts found, adds the ticked ones as one undoable edit', async () => {
    const seq = bases();
    // Turned so that bla (complement(3293..4153) in J01749) runs over the origin.
    const rotated = seq.slice(3700) + seq.slice(0, 3700);
    openBare(rotated);
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/^Found \d+ common features?/);
    const panel = screen.getByRole('region', { name: 'Detect features' });
    const amp = within(panel).getByRole('checkbox', { name: 'Add AmpR' });
    const tet = within(panel).getByRole('checkbox', { name: 'Add TcR' });
    expect(amp).toBeChecked();
    expect(within(panel).getByText('complement(join(3954..4361,1..453))')).toBeInTheDocument();
    fireEvent.click(tet);
    expect(tet).not.toBeChecked();
    const add = within(panel).getByRole('button', { name: /^Add \d+ features?$/ });
    const before = editorStore.getState().history?.present.features.size ?? 0;
    const ticked = Number(/\d+/.exec(add.textContent)?.[0]);
    fireEvent.click(add);

    const doc = editorStore.getState().history?.present;
    expect(doc?.features.size).toBe(before + ticked);
    const added = doc?.features.all().find((f) => f.name === 'AmpR');
    expect(added).toMatchObject({
      type: 'CDS',
      strand: 'reverse',
      segments: [rangeSegment(3953, 3953 + 861)],
    });
    expect(doc?.features.all().some((f) => f.name === 'TcR')).toBe(false);
    expect(screen.queryByRole('region', { name: 'Detect features' })).toBeNull();
    expect(editorStore.getState().history?.canUndo).toBe(true);

    act(() => {
      editorStore.undo();
    });
    expect(editorStore.getState().history?.present.features.size).toBe(before);
  });

  it('lists a hit the document already has as annotated, not as an offer', async () => {
    const seq = bases();
    const id = openBare(seq);
    act(() => {
      editorStore.apply(
        {
          type: 'addFeature',
          feature: createFeature({
            type: 'CDS',
            name: 'bla',
            strand: 'reverse',
            segments: [rangeSegment(3292, 4153)],
          }),
        },
        undefined,
        id,
      );
    });
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/already annotated/);
    const panel = screen.getByRole('region', { name: 'Detect features' });
    expect(within(panel).queryByRole('checkbox', { name: 'Add AmpR' })).toBeNull();
    expect(within(panel).getByRole('checkbox', { name: 'Add TcR' })).toBeChecked();
  });

  it('says so when nothing is found, and can be dismissed', async () => {
    openBare('ACGT'.repeat(50));
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText('No common features found.');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('region', { name: 'Detect features' })).toBeNull();
  });

  it('asks for a new search once the bases have changed', async () => {
    const id = openBare(bases());
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/^Found/);
    act(() => {
      editorStore.apply({ type: 'insert', position: 10, text: 'A' }, undefined, id);
    });
    expect(screen.getByText('The sequence has changed since it was searched.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search again' }));
    await screen.findByText(/^Found/);
  });

  it('runs on a file opened without features when the setting is on, and not otherwise', async () => {
    const fasta = `>bare pBR322\n${bases()}\n`;
    let id = await openFile(new File([fasta], 'bare.fa'));
    expect(detectionStore.get(id)).toBeNull();

    act(() => {
      editorStore.closeAllDocuments();
      editorStore.setDetectOnOpen(true);
      editorStore.setSidebarTab('enzymes');
    });
    id = await openFile(new File([fasta], 'bare2.fa'));
    await waitFor(() => {
      expect(detectionStore.get(id)?.status).toBe('done');
    });
    expect(editorStore.getState().sidebarTab).toBe('features');

    // A file with features of its own is left alone.
    const annotated = await openFile(new File([pBR322], 'pBR322.gb'));
    expect(detectionStore.get(annotated)).toBeNull();
  });
});
