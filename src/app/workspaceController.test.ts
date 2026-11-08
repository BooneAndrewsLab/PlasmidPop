// @vitest-environment jsdom
import { act } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from './state/editorStore';
import { forgetPanels } from './state/panelMemory';
import { createWorkspaceController } from './workspaceController';

const doc = SeqDocument.create({ name: 'target', sequence: 'TTTTACGTACGTGGCCAATTGGCCTTTT' });
const controller = createWorkspaceController('align', ['align', 'results'] as const, 'align');

describe('createWorkspaceController', () => {
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

  it('opens on a page, remembers it per document, and shuts', () => {
    const id = editorStore.getState().documentId;
    expect(controller.recallPage(id)).toBe('align');
    act(() => {
      controller.open(id, 'results');
    });
    expect(editorStore.getState().workspace).toBe('align');
    expect(controller.recallPage(id)).toBe('results');
    expect(controller.recallPage('another')).toBe('align');
    act(() => {
      controller.close();
    });
    expect(editorStore.getState().workspace).toBeNull();
  });

  it('opens on the remembered page when none is given', () => {
    const id = editorStore.getState().documentId;
    controller.rememberPage(id, 'results');
    act(() => {
      controller.open(id);
    });
    expect(controller.recallPage(id)).toBe('results');
  });

  it('hands the keyboard back once, only when asked to', () => {
    controller.close(true);
    expect(controller.takeFocusRequest()).toBe(true);
    expect(controller.takeFocusRequest()).toBe(false);
    controller.close();
    expect(controller.takeFocusRequest()).toBe(false);
  });

  it('shuts only its own workspace', () => {
    act(() => {
      editorStore.setWorkspace('primers');
    });
    controller.close();
    expect(editorStore.getState().workspace).toBe('primers');
  });

  it('goes back to the opening tab on a close that returns focus, and leaves the keyboard there', () => {
    act(() => {
      editorStore.setSidebarTab('cloning');
      controller.open(editorStore.getState().documentId);
    });
    expect(editorStore.getState().sidebarTab).toBe('align');
    act(() => {
      controller.close(true);
    });
    expect(editorStore.getState()).toMatchObject({ workspace: null, sidebarTab: 'cloning' });
    expect(controller.takeFocusRequest()).toBe(false);
  });

  it('stays on its own tab, asking for the keyboard, when it was opened from there', () => {
    act(() => {
      editorStore.setSidebarTab('align');
      controller.open(editorStore.getState().documentId);
    });
    act(() => {
      controller.close(true);
    });
    expect(editorStore.getState()).toMatchObject({ workspace: null, sidebarTab: 'align' });
    expect(controller.takeFocusRequest()).toBe(true);
  });

  it('stays on its own tab when closed without returning focus, or opened with no tab to return to', () => {
    act(() => {
      editorStore.setSidebarTab('cloning');
      controller.open(editorStore.getState().documentId);
      controller.close();
    });
    expect(editorStore.getState().sidebarTab).toBe('align');
    act(() => {
      editorStore.setSidebarTab('cloning');
      controller.open(editorStore.getState().documentId, undefined, false);
      controller.close(true);
    });
    expect(editorStore.getState().sidebarTab).toBe('align');
  });
});
