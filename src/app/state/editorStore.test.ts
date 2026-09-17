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
});
