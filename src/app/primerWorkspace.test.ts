// @vitest-environment jsdom
import { act } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { openPrimerWorkspace, recallWorkspace } from './primerWorkspace';
import { editorStore } from './state/editorStore';
import { forgetPanels } from './state/panelMemory';

const doc = SeqDocument.create({ name: 'vector', sequence: 'ACGTACGTAC'.repeat(30) });

describe('openPrimerWorkspace', () => {
  beforeEach(() => {
    act(() => {
      editorStore.openDocument(doc);
    });
  });
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
    forgetPanels();
  });

  it('writes the page and the mode it is given (#381)', () => {
    const id = editorStore.getState().documentId;
    act(() => {
      openPrimerWorkspace(id, 'design', 'cloning');
    });
    expect(editorStore.getState().workspace).toBe('primers');
    expect(recallWorkspace(id)).toEqual({ page: 'design', mode: 'cloning' });
  });

  it('keeps the remembered mode when none is given', () => {
    const id = editorStore.getState().documentId;
    act(() => {
      openPrimerWorkspace(id, 'design', 'cloning');
      editorStore.setWorkspace(null);
      openPrimerWorkspace(id, 'results');
    });
    expect(recallWorkspace(id)).toEqual({ page: 'results', mode: 'cloning' });
  });

  it('starts on the plain mode, on Design', () => {
    expect(recallWorkspace(editorStore.getState().documentId)).toEqual({
      page: 'design',
      mode: 'plain',
    });
  });
});
