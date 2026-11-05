// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import { SeqDocument, createFeature, loadFeatureLibrary, rangeSegment } from '@/core';
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

  it('offers the SV40 poly(A) signal of the strand a gene runs into (#282)', async () => {
    const lib = await loadFeatureLibrary();
    const late = lib.parts.find((p) => p.name === 'SV40 late poly(A) signal')?.sequence ?? '';
    // An insert of no part of ours, then the late SV40 fragment after it.
    const insert = 'ATG' + 'GCTGAAAAACTGGGC'.repeat(40) + 'TAA';
    const seq = 'C'.repeat(60) + insert + 'C'.repeat(30) + late + 'C'.repeat(60);
    const names = async (): Promise<string[]> => {
      render(<Tab />);
      fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
      await screen.findByText(/^Found/);
      const panel = screen.getByRole('region', { name: 'Detect features' });
      return within(panel)
        .getAllByRole('checkbox')
        .map((c) => c.getAttribute('aria-label') ?? '')
        .filter((n) => n.includes('SV40') && n.includes('poly(A)'));
    };
    // Nothing runs into it: the generic early signal alone.
    openBare(seq, 'no gene');
    expect(await names()).toEqual(['Add SV40 poly(A) signal']);
    cleanup();
    // The document says the insert is a CDS: it runs into the late strand.
    const id = openBare(seq, 'with gene');
    act(() => {
      editorStore.apply(
        {
          type: 'addFeature',
          feature: createFeature({
            type: 'CDS',
            name: 'insert',
            strand: 'forward',
            segments: [rangeSegment(60, 60 + insert.length)],
          }),
        },
        undefined,
        id,
      );
    });
    expect(await names()).toEqual(['Add SV40 late poly(A) signal']);
  });

  it('counts what the rules hid, shows it on request and never ticks it (#289)', async () => {
    const lib = await loadFeatureLibrary();
    const late = lib.parts.find((p) => p.name === 'SV40 late poly(A) signal')?.sequence ?? '';
    // No gene runs into the late signal: only the early strand is offered.
    openBare('C'.repeat(60) + late + 'C'.repeat(60), 'pCI-like');
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/^Found/);
    const panel = screen.getByRole('region', { name: 'Detect features' });
    expect(
      within(panel).queryByRole('checkbox', { name: 'Add SV40 late poly(A) signal' }),
    ).toBeNull();
    expect(within(panel).queryByText(/Hidden:/)).toBeNull();
    const toggle = within(panel).getByRole('checkbox', { name: /1 hidden/ });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    const row = within(panel).getByRole('checkbox', { name: 'Add SV40 late poly(A) signal' });
    expect(row).not.toBeChecked();
    expect(
      within(panel).getByText('Hidden: the SV40 late poly(A) signal strand no gene runs into'),
    ).toBeInTheDocument();
    // Adding what is ticked adds the early signal, not the hidden one.
    fireEvent.click(within(panel).getByRole('button', { name: 'Add 2 features' }));
    const names = (): string[] =>
      editorStore
        .getState()
        .history?.present.features.all()
        .map((f) => f.name) ?? [];
    expect(names()).toEqual(['SV40 poly(A) signal', 'SV40pA rev']);
    // Run again, and pick the hidden one: it is added like any other.
    act(() => {
      editorStore.undo();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/^Found/);
    const again = screen.getByRole('region', { name: 'Detect features' });
    fireEvent.click(within(again).getByRole('checkbox', { name: /1 hidden/ }));
    fireEvent.click(within(again).getByRole('checkbox', { name: 'Add SV40 late poly(A) signal' }));
    fireEvent.click(within(again).getByRole('button', { name: 'Add 3 features' }));
    expect(names().sort()).toEqual([
      'SV40 late poly(A) signal',
      'SV40 poly(A) signal',
      'SV40pA rev',
    ]);
  });

  it('names the gene a hidden segment belongs to, and "Tick all" leaves it alone (#289)', async () => {
    openBare(bases());
    render(<Tab />);
    fireEvent.click(screen.getByRole('button', { name: 'Detect features' }));
    await screen.findByText(/^Found/);
    const panel = screen.getByRole('region', { name: 'Detect features' });
    expect(within(panel).queryByText(/^Hidden:/)).toBeNull();
    fireEvent.click(within(panel).getByRole('checkbox', { name: /\d+ hidden/ }));
    const reasons = within(panel).getAllByText(/^Hidden: a segment of AmpR$/);
    expect(reasons.length).toBeGreaterThan(0);
    const hiddenBoxes = within(panel)
      .getAllByRole('checkbox')
      .filter((c) => c.closest('li')?.textContent.includes('Hidden:'));
    expect(hiddenBoxes.length).toBeGreaterThan(0);
    for (const c of hiddenBoxes) expect(c).not.toBeChecked();
    // Unticking all and ticking all again leaves them as they were.
    fireEvent.click(within(panel).getByRole('button', { name: 'Untick all' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Tick all' }));
    for (const c of hiddenBoxes) expect(c).not.toBeChecked();
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

    // So is a protein: the parts are DNA (#66).
    const protein = await openFile(
      new File(
        ['>bare protein\nMVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVK\n'],
        'p.faa',
      ),
    );
    expect(editorStore.documentState(protein)?.history.present.alphabet).toBe('protein');
    expect(detectionStore.get(protein)).toBeNull();
  });

  it('is not offered on a protein', () => {
    act(() => {
      editorStore.openDocument(
        SeqDocument.create({ name: 'p', sequence: 'MVHLTPEEKSAVTALWGKV', alphabet: 'protein' }),
      );
    });
    render(<Tab />);
    expect(screen.queryByRole('button', { name: 'Detect features' })).toBeNull();
  });
});
