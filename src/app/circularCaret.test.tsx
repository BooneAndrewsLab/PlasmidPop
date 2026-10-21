// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { createFeature, rangeSegment } from '@/core';

import { App } from './App';
import { resetClipboardMemory, writeFragment } from './clipboard';
import { editorStore } from './state/editorStore';

/**
 * The caret on a circular sequence (#265): a boundary in [0, length], so the
 * end can be reached and typed at, and typing goes in at the caret and moves
 * it on, as on a linear sequence.
 */

/** A clipboard as the browser hands it to a paste event. */
function clipboardOf(copy: (data: DataTransfer) => void): DataTransfer {
  const store = new Map<string, string>();
  const data = {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
  copy(data);
  return data;
}

function newSequence(kind: 'Linear' | 'Circular' | 'Protein'): HTMLElement {
  act(() => {
    editorStore.closeAllDocuments();
  });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /start a new sequence/i }));
  fireEvent.click(screen.getByRole('button', { name: kind }));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  expect(editorStore.document?.length).toBe(0);
  return screen.getByRole('textbox', { name: 'Sequence' });
}

function type(box: HTMLElement, text: string): void {
  for (const key of text) fireEvent.keyDown(box, { key });
}

function pasteText(box: HTMLElement, text: string): void {
  fireEvent.paste(box, {
    clipboardData: clipboardOf((d) => {
      d.setData('text/plain', text);
    }),
  });
}

const sequence = (): string | undefined => editorStore.document?.sequence.toString();
const caret = () => editorStore.getState().selection;
const at = (p: number) => ({ start: p, end: p });

const fragment = {
  sequence: 'GGGGGG',
  features: [createFeature({ id: 'f', type: 'gene', name: 'g', segments: [rangeSegment(1, 5)] })],
};

describe('the caret on a circular sequence (#265)', () => {
  beforeEach(resetClipboardMemory);

  for (const kind of ['Linear', 'Circular', 'Protein'] as const) {
    it(`types base after base in order and moves the caret on, ${kind}`, () => {
      const box = newSequence(kind);
      type(box, kind === 'Protein' ? 'mkv' : 'actg');
      expect(sequence()).toBe(kind === 'Protein' ? 'mkv' : 'actg');
      expect(caret()).toEqual(at(kind === 'Protein' ? 3 : 4));
    });

    it(`inserts pasted plain bases into an empty document, ${kind}`, () => {
      const box = newSequence(kind);
      pasteText(box, kind === 'Protein' ? 'MKVL' : 'acgtacgt');
      expect(sequence()).toBe(kind === 'Protein' ? 'MKVL' : 'acgtacgt');
      expect(caret()).toEqual(at(kind === 'Protein' ? 4 : 8));
    });
  }

  for (const kind of ['Linear', 'Circular'] as const) {
    it(`pastes a copied fragment into an empty document, features and all, ${kind}`, () => {
      const box = newSequence(kind);
      fireEvent.paste(box, {
        clipboardData: clipboardOf((d) => {
          writeFragment(d, fragment);
        }),
      });
      expect(sequence()).toBe('GGGGGG');
      expect(editorStore.document?.features.size).toBe(1);
      expect(caret()).toEqual(at(6));
      // and typing carries on after it
      type(box, 'a');
      expect(sequence()).toBe('GGGGGGa');
    });

    it(`pastes a copied fragment into an empty document with no caret, ${kind}`, () => {
      const box = newSequence(kind);
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(caret()).toBeNull();
      fireEvent.paste(box, {
        clipboardData: clipboardOf((d) => {
          writeFragment(d, fragment);
        }),
      });
      expect(sequence()).toBe('GGGGGG');
      expect(editorStore.document?.features.size).toBe(1);
    });
  }

  it('reaches the end with Arrow Right, and types there by appending', () => {
    const box = newSequence('Circular');
    pasteText(box, 'acgt');
    act(() => {
      editorStore.setSelection(at(3));
    });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(caret()).toEqual(at(4));
    type(box, 'ga');
    expect(sequence()).toBe('acgtga');
    expect(caret()).toEqual(at(6));
    // Past the end the caret comes round to the start, passing no base,
    // and back again.
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(caret()).toEqual(at(0));
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(caret()).toEqual(at(1));
    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    expect(caret()).toEqual(at(6));
    fireEvent.keyDown(box, { key: 'ArrowLeft' });
    expect(caret()).toEqual(at(5));
  });

  it('extends a selection to the end with Shift+Arrow Right', () => {
    const box = newSequence('Circular');
    pasteText(box, 'acgt');
    act(() => {
      editorStore.setSelection(at(2));
    });
    fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
    expect(caret()).toEqual({ start: 2, end: 4 });
    // and stops there rather than reaching round the circle
    fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
    expect(caret()).toEqual({ start: 2, end: 4 });
  });

  it('goes to the end with Ctrl+End and End', () => {
    const box = newSequence('Circular');
    pasteText(box, 'acgtacgt');
    act(() => {
      editorStore.setSelection(at(2));
    });
    fireEvent.keyDown(box, { key: 'End', ctrlKey: true });
    expect(caret()).toEqual(at(8));
    act(() => {
      editorStore.setSelection(at(2));
    });
    fireEvent.keyDown(box, { key: 'End' });
    expect(caret()).toEqual(at(8));
    type(box, 'c');
    expect(sequence()).toBe('acgtacgtc');
  });

  it('pastes at the end and in the middle of a circle at the caret', () => {
    const box = newSequence('Circular');
    pasteText(box, 'acgt');
    pasteText(box, 'tt');
    expect(sequence()).toBe('acgttt');
    expect(caret()).toEqual(at(6));
    act(() => {
      editorStore.setSelection(at(2));
    });
    pasteText(box, 'gg');
    expect(sequence()).toBe('acgggttt');
    expect(caret()).toEqual(at(4));
    // A copied fragment at the end, which a circle used to refuse.
    act(() => {
      editorStore.setSelection(at(8));
    });
    fireEvent.paste(box, {
      clipboardData: clipboardOf((d) => {
        writeFragment(d, fragment);
      }),
    });
    expect(sequence()).toBe('acgggttt' + 'GGGGGG');
    expect(caret()).toEqual(at(14));
  });

  it('backspaces at the end of a circle and stays at the end', () => {
    const box = newSequence('Circular');
    type(box, 'acgt');
    fireEvent.keyDown(box, { key: 'Backspace' });
    expect(sequence()).toBe('acg');
    expect(caret()).toEqual(at(3));
    fireEvent.keyDown(box, { key: 'Delete' });
    expect(sequence()).toBe('cg');
    expect(caret()).toEqual(at(2));
  });

  it('still types over a selection that wraps the origin', () => {
    const box = newSequence('Circular');
    pasteText(box, 'acgtacgtac');
    act(() => {
      editorStore.setSelection({ start: 8, end: 12 });
    });
    type(box, 'g');
    // a, c, a, c went; the g is written over the first of them
    expect(sequence()).toBe('gtacgtg');
    expect(caret()).toEqual(at(7));
  });
});
