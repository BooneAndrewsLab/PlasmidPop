// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';

import { type Orf, SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { OrfPanel } from './OrfPanel';

const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(500), topology: 'circular' });
const orfs: Orf[] = [
  { range: { start: 10, end: 310 }, strand: 'forward', frame: 1, codons: 99 },
  // Over the origin, unrolled as the scan gives it.
  { range: { start: 1900, end: 2150 }, strand: 'reverse', frame: 0, codons: 82 },
];

describe('OrfPanel', () => {
  afterEach(() => {
    act(() => {
      while (editorStore.getState().documents.length > 0) editorStore.closeDocument();
    });
  });

  it('draws every ORF on the views while open, and selects one clicked there (#32)', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setAnalysis(doc, [], orfs);
    });
    const view = render(<OrfPanel doc={doc} />);
    const preview = editorStore.getState().preview;
    expect(preview?.owners).toEqual(['orfs']);
    expect(preview?.items.map((i) => [i.label, i.strand, i.shape, i.range])).toEqual([
      ['99 aa', 'forward', 'arrow', { start: 10, end: 310 }],
      ['82 aa', 'reverse', 'arrow', { start: 1900, end: 2150 }],
    ]);
    const second = preview?.items[1];
    if (second === undefined) throw new Error('no second ORF');
    act(() => {
      editorStore.activatePreview(second.id);
    });
    expect(editorStore.getState().selection).toEqual({ start: 1900, end: 2150 });
    expect(screen.getByText('ORF translation')).toBeInTheDocument();
    // Leaving the tab takes them off.
    view.unmount();
    expect(editorStore.getState().preview).toBeNull();
  });
});
