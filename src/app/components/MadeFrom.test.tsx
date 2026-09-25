// @vitest-environment jsdom
import 'fake-indexeddb/auto';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  SeqDocument,
  documentFromFragment,
  digest,
  findCutSites,
  fragmentWithLineage,
  getEnzyme,
  ligate,
  recordLigation,
} from '@/core';
import { getRepository } from '@/storage';

import { editorStore } from '../state/editorStore';
import { HistoryPanel } from './HistoryPanel';

function filler(length: number, seed: number): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const vector = SeqDocument.create({
  name: 'pVec',
  topology: 'circular',
  sequence: `GAATTC${filler(300, 1)}GGATCC${filler(2000, 2)}`,
});
const insert = SeqDocument.create({
  name: 'pIns',
  topology: 'circular',
  sequence: `GAATTC${filler(700, 3)}GGATCC${filler(1500, 4)}`,
});
const stranger = SeqDocument.create({
  name: 'pElsewhere',
  topology: 'circular',
  sequence: `GAATTC${filler(500, 5)}GGATCC${filler(900, 6)}`,
});

function pieces(doc: SeqDocument) {
  const enzymes = ['EcoRI', 'BamHI'].map((n) => {
    const e = getEnzyme(n);
    if (e === undefined) throw new Error(n);
    return e;
  });
  const out = digest(doc, findCutSites(doc.sequence.toString(), doc.topology, enzymes)).map((f) =>
    fragmentWithLineage(f, doc),
  );
  return [...out].sort((a, b) => b.sequence.length - a.sequence.length);
}

/** pVec's backbone and pIns's insert, ligated: a two-level tree. */
function product(backboneOf: SeqDocument, insertOf: SeqDocument): SeqDocument {
  const [backbone] = pieces(backboneOf);
  const [, small] = pieces(insertOf);
  if (backbone === undefined || small === undefined) throw new Error('no pieces');
  const parts = [
    { fragment: backbone, flipped: false },
    { fragment: small, flipped: false },
  ];
  return recordLigation(
    ligate(
      parts.map((p) => p.fragment),
      { name: 'pVec+pIns', circular: true },
    ),
    parts,
    true,
  );
}

function openTree(): HTMLElement {
  fireEvent.click(screen.getByText('Made from'));
  return screen.getByRole('list', { name: 'Made from' });
}

describe('Made from, in the History tab (#67)', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeAllDocuments();
    });
  });

  it('shows nothing for a document that was not made here', () => {
    act(() => {
      editorStore.openDocument(vector);
    });
    render(<HistoryPanel />);
    expect(screen.queryByText('Made from')).toBeNull();
  });

  it('draws the product, its fragments and the documents they were cut from, level by level', () => {
    act(() => {
      editorStore.openDocument(product(vector, insert));
    });
    render(<HistoryPanel />);
    // The summary says how it was made before it is opened.
    const summary = screen.getByText('Made from').closest('summary');
    expect(summary?.textContent).toContain('Ligation of 2 parts, circular');
    const tree = openTree();
    const [root] = within(tree).getAllByRole('listitem');
    if (root === undefined) throw new Error('no root');
    expect(within(root).getByText('pVec+pIns')).toBeTruthy();
    expect(within(root).getByText('this document')).toBeTruthy();
    const fragments = within(root).getAllByRole('list')[0];
    if (fragments === undefined) throw new Error('no second level');
    const second = within(fragments)
      .getAllByRole('listitem')
      .filter((li) => li.parentElement === fragments);
    expect(second).toHaveLength(2);
    expect(within(second[0] ?? root).getAllByText(/^Digest with BamHI and EcoRI · /)).toHaveLength(
      1,
    );
    expect(within(second[0] ?? root).getByText('pVec')).toBeTruthy();
    expect(within(second[1] ?? root).getByText('pIns')).toBeTruthy();
    // Its checksum's short form, and the size, on each molecule.
    expect(within(tree).getAllByText(/cdseguid /).length).toBeGreaterThan(0);
    expect(within(tree).getAllByText(/bp, circular/).length).toBeGreaterThan(0);
  });

  it('opens a molecule an open tab holds, and says so of one the browser does not hold', () => {
    let vectorId = '';
    act(() => {
      vectorId = editorStore.openDocument(vector);
      editorStore.openDocument(product(vector, insert));
    });
    render(<HistoryPanel />);
    const tree = openTree();
    fireEvent.click(within(tree).getByRole('button', { name: 'Open pVec' }));
    expect(editorStore.getState().documentId).toBe(vectorId);
    act(() => {
      editorStore.activateDocument(editorStore.getState().documents[1]?.documentId ?? null);
    });
    expect(
      within(screen.getByRole('list', { name: 'Made from' })).getAllByText('not in this browser')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Open pIns' })).toBeNull();
  });

  it('opens a molecule kept in storage whose tab is closed', async () => {
    await getRepository().save('stored-insert', insert, 'pIns.gb');
    act(() => {
      editorStore.openDocument(product(stranger, insert));
    });
    render(<HistoryPanel />);
    const tree = openTree();
    const button = await waitFor(() => within(tree).getByRole('button', { name: 'Open pIns' }));
    fireEvent.click(button);
    await waitFor(() => {
      expect(editorStore.getState().documentId).toBe('stored-insert');
    });
    expect(editorStore.document?.name).toBe('pIns');
  });

  it('says the document has been edited since it was made', () => {
    act(() => {
      editorStore.openDocument(product(vector, insert));
      editorStore.apply({ type: 'insert', position: 10, text: 'AAA' });
    });
    render(<HistoryPanel />);
    const tree = openTree();
    expect(within(tree).getByText('edited since')).toBeTruthy();
  });

  it('shows the lineage an opened fragment carries', () => {
    const [backbone] = pieces(vector);
    if (backbone === undefined) throw new Error('no backbone');
    act(() => {
      editorStore.openDocument(documentFromFragment(backbone));
    });
    render(<HistoryPanel />);
    const summary = screen.getByText('Made from').closest('summary');
    expect(summary?.textContent).toMatch(/Digest with BamHI and EcoRI · \d/);
  });
});
