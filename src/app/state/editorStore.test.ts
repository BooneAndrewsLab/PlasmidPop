import { SeqDocument, createFeature, rangeSegment } from '@/core';
import { parseGenBank } from '@/io';

import { EditorStore } from './editorStore';

const doc = SeqDocument.create({
  sequence: 'ACGTACGTACGTACGTACGT',
  topology: 'circular',
  features: [createFeature({ id: 'f', type: 'gene', segments: [rangeSegment(17, 23)] })],
});

describe('EditorStore', () => {
  it('starts empty and opens documents', () => {
    const store = new EditorStore();
    expect(store.document).toBeNull();
    const listener = vi.fn();
    store.subscribe(listener);
    store.openDocument(doc, 'x.gb');
    expect(store.document).toBe(doc);
    expect(store.getState().fileName).toBe('x.gb');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('opens parse results and reports empty ones', () => {
    const store = new EditorStore();
    store.openParsed(
      parseGenBank('LOCUS       X 4 bp DNA linear\nORIGIN\n        1 acgt\n//\n'),
      'x.gb',
    );
    expect(store.document?.length).toBe(4);
    store.openParsed({ format: 'fasta', documents: [], warnings: [] }, 'e.fa');
    expect(store.getState().error).toMatch(/no sequences/);
    store.dismissError();
    expect(store.getState().error).toBeNull();
  });

  it('applies ops with undo/redo and keeps a caret in place', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.setSelection({ start: 5, end: 5 });
    store.apply({ type: 'insert', position: 2, text: 'NN' });
    expect(store.document?.length).toBe(22);
    expect(store.getState().selection).toEqual({ start: 7, end: 7 });
    expect(store.getState().history?.undoLabel).toBe('Insert 2 bases');
    store.undo();
    expect(store.document).toBe(doc);
    store.redo();
    expect(store.document?.length).toBe(22);
    store.apply({ type: 'rename', text: 'x', name: doc.name } as never); // no-op op does not push
    expect(store.getState().history?.undoDepth).toBe(1);
  });

  it('selects features, including wrapped ones, and requests a reveal', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const nonce = store.getState().reveal?.nonce ?? 0;
    store.selectFeature('f');
    expect(store.getState().selection).toEqual({ start: 17, end: 23 });
    expect(store.getState().reveal).toEqual({ position: 17, nonce: nonce + 1 });
    store.selectFeature('missing');
    expect(store.getState().selection).toEqual({ start: 17, end: 23 });
  });

  it('ignores redundant selection updates', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSelection({ start: 1, end: 3 });
    store.setSelection({ start: 1, end: 3 });
    store.setSelection(null);
    store.setSelection(null);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('follows the selection through reverse complement and set origin', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.setSelection({ start: 2, end: 5 });
    store.apply({ type: 'reverseComplement' });
    expect(store.getState().selection).toEqual({ start: 15, end: 18 });
    store.apply({ type: 'setOrigin', position: 15 });
    expect(store.getState().selection).toEqual({ start: 0, end: 3 });
    expect(store.document?.subsequence({ start: 0, end: 3 })).toBe(
      doc
        .subsequence({ start: 2, end: 5 })
        .split('')
        .reverse()
        .map((c) => ({ A: 'T', C: 'G', G: 'C', T: 'A' })[c] ?? c)
        .join(''),
    );
  });

  it('annotates the selection and asks for a name', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    store.addFeatureFromSelection();
    expect(store.document?.features.size).toBe(1);
    store.setSelection({ start: 3, end: 9 });
    store.addFeatureFromSelection();
    expect(store.document?.features.size).toBe(2);
    const added = store.document?.features.all()[1];
    expect(added).toMatchObject({ type: 'misc_feature', name: 'New feature' });
    expect(store.getState().renameRequest?.id).toBe(added?.id);
    expect(store.getState().selection).toEqual({ start: 3, end: 9 });
    store.finishRename();
    expect(store.getState().renameRequest).toBeNull();
    store.applyPlan(null);
    expect(store.getState().history?.undoDepth).toBe(1);
  });
});

describe('EditorStore analysis', () => {
  it('stores results for the current document only and defaults to single cutters', () => {
    const store = new EditorStore();
    store.openDocument(doc);
    const site = (enzyme: string, cut: number) => ({
      enzyme,
      cut,
      cutBottom: cut,
      siteStart: cut,
      strand: 'forward' as const,
    });
    store.setAnalysis(doc, [site('EcoRI', 3), site('AluI', 5), site('AluI', 9)], []);
    expect([...store.getState().shownEnzymes]).toEqual(['EcoRI']);
    expect(store.visibleCutSites()).toHaveLength(1);
    store.setEnzymeShown('AluI', true);
    expect(store.visibleCutSites()).toHaveLength(3);
    store.setEnzymeShown('AluI', true);
    // Later results keep the user's choice.
    store.setAnalysis(doc, [site('EcoRI', 3)], []);
    expect(store.getState().shownEnzymes.has('AluI')).toBe(true);
    // Results for another document are ignored.
    store.setAnalysis(SeqDocument.create({ sequence: 'ACGT' }), [site('NotI', 1)], []);
    expect(store.getState().analysis?.cutSites.map((s) => s.enzyme)).toEqual(['EcoRI']);
    // Editing invalidates the visible sites until fresh results arrive.
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.visibleCutSites()).toEqual([]);
    store.setOrfMinCodons(30);
    expect(store.getState().analysis).toBeNull();
    store.setShownEnzymes(['NotI']);
    expect([...store.getState().shownEnzymes]).toEqual(['NotI']);
  });
});

describe('EditorStore persistence state', () => {
  it('tracks dirtiness against the saved version', () => {
    const store = new EditorStore();
    store.openDocument(doc, 'x.gb');
    expect(store.getState().dirty).toBe(false);
    expect(store.getState().documentId).toMatch(/[0-9a-f-]{36}/);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    expect(store.getState().dirty).toBe(true);
    store.undo();
    expect(store.getState().dirty).toBe(false);
    store.apply({ type: 'insert', position: 0, text: 'A' });
    store.markSaved('y.gb');
    expect(store.getState()).toMatchObject({ dirty: false, fileName: 'y.gb' });
    store.closeDocument();
    expect(store.document).toBeNull();
    expect(store.getState()).toMatchObject({ documentId: null, dirty: false, fileHandle: null });
  });

  it('treats documents without a file as unsaved and keeps a given id and handle', () => {
    const store = new EditorStore();
    const handle = { name: 'h.gb' } as FileSystemFileHandle;
    store.openDocument(doc, null, [], { id: 'fixed', handle });
    expect(store.getState()).toMatchObject({
      dirty: true,
      documentId: 'fixed',
      fileHandle: handle,
    });
    store.setFileHandle(null);
    expect(store.getState().fileHandle).toBeNull();
  });
});
