// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { getRepository } from '@/storage';

import { App } from './App';
import { editorStore } from './state/editorStore';

function alt(code: string): void {
  fireEvent.keyDown(window, { code, altKey: true });
}

beforeEach(() => {
  getRepository().setLastDocumentId(null);
  getRepository().setOpenDocumentIds([]);
  localStorage.removeItem('plasmidpop.viewPrefs');
  act(() => {
    editorStore.closeAllDocuments();
    editorStore.setSidebarOpen(true);
    editorStore.setShowComplement(true);
    editorStore.setShowCutSites(true);
    editorStore.setEditsBaseline('opened');
  });
});

describe('view shortcuts', () => {
  it('toggles the three view switches, the marks and the sidebar', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));

    alt('KeyC');
    expect(editorStore.getState().showComplement).toBe(false);
    alt('KeyC');
    expect(editorStore.getState().showComplement).toBe(true);

    alt('KeyR');
    expect(editorStore.getState().showCutSites).toBe(false);

    alt('KeyS');
    expect(editorStore.getState().sidebarOpen).toBe(false);
    alt('KeyS');
    expect(editorStore.getState().sidebarOpen).toBe(true);
  });

  it('turns the edit marks off and brings back the baseline that was chosen', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      editorStore.setEditsBaseline('saved');
    });
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('off');
    alt('KeyE');
    expect(editorStore.getState().editsBaseline).toBe('saved');
  });

  it('brings the nth document forward', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    const first = editorStore.getState().documentId;
    act(() => {
      editorStore.newDocument();
    });
    const second = editorStore.getState().documentId;
    expect(second).not.toBe(first);

    alt('Digit1');
    expect(editorStore.getState().documentId).toBe(first);
    alt('Digit2');
    expect(editorStore.getState().documentId).toBe(second);
    // Nothing happens where there is no such tab.
    alt('Digit9');
    expect(editorStore.getState().documentId).toBe(second);
  });

  it('leaves a shortcut alone while text is being typed into a field', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const find = screen.getByRole('searchbox', { name: 'Find' });
    fireEvent.keyDown(find, { code: 'KeyC', altKey: true });
    expect(editorStore.getState().showComplement).toBe(true);
  });
});

describe('selecting by codon', () => {
  it('takes the caret’s codon, then one more for each press', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    // pBR322's tet CDS runs 86..1276 (1-based), so 0-based 85..1276 with
    // codons starting at 85. Position 100 is in the sixth codon, 100..102.
    act(() => {
      editorStore.setSelection({ start: 100, end: 100 });
    });
    const view = document.querySelector('.seq-view');
    if (view === null) throw new Error('no sequence view');

    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    const first = editorStore.getState().selection;
    expect(first).toEqual({ start: 100, end: 103 });

    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(editorStore.getState().selection).toEqual({ start: 100, end: 106 });

    // A plain arrow goes back to one base at a time and ends the run.
    fireEvent.keyDown(view, { key: 'ArrowRight', code: 'ArrowRight', shiftKey: true });
    expect(editorStore.getState().selection?.end).toBe(107);
  });

  it('does nothing where the caret is in no coding feature', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open example' }));
    act(() => {
      // Before the first CDS of pBR322.
      editorStore.setSelection({ start: 10, end: 10 });
    });
    const view = document.querySelector('.seq-view');
    if (view === null) throw new Error('no sequence view');
    fireEvent.keyDown(view, {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      shiftKey: true,
    });
    // Falls through to the plain Ctrl+arrow, which moves nothing.
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });
});
