// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { createFeature, rangeSegment } from '@/core';

import { App } from './App';
import { FRAGMENT_MIME, resetClipboardMemory, writeFragment } from './clipboard';
import { editorStore } from './state/editorStore';

/**
 * Copy, cut and paste in the sequence view as Firefox delivers them (#267):
 * to `<body>`, not to the focused view, which is not editable.
 */

function clipboard(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? '',
  } as unknown as DataTransfer;
}

function newSequence(): HTMLElement {
  act(() => {
    editorStore.closeAllDocuments();
  });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /start a new sequence/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create' }));
  const box = screen.getByRole('textbox', { name: 'Sequence' });
  box.focus();
  return box;
}

const sequence = (): string | undefined => editorStore.document?.sequence.toString();

describe('the sequence view’s clipboard in Firefox (#267)', () => {
  beforeEach(() => {
    resetClipboardMemory();
  });

  it('pastes text sent to the body while the view has the focus', () => {
    newSequence();
    const data = clipboard();
    data.setData('text/plain', 'acgt');
    fireEvent.paste(document.body, { clipboardData: data });
    expect(sequence()).toBe('acgt');
  });

  it('copies, cuts and pastes back a fragment with its features', () => {
    newSequence();
    const original = clipboard();
    writeFragment(original, {
      sequence: 'GGGGGG',
      features: [
        createFeature({ id: 'f', type: 'gene', name: 'g', segments: [rangeSegment(1, 5)] }),
      ],
    });
    resetClipboardMemory();
    fireEvent.paste(document.body, { clipboardData: original });
    expect(sequence()).toBe('GGGGGG');

    act(() => {
      editorStore.setSelection({ start: 0, end: 6 });
    });
    const copied = clipboard();
    fireEvent.copy(document.body, { clipboardData: copied });
    expect(copied.getData('text/plain')).toBe('GGGGGG');
    expect(copied.getData(FRAGMENT_MIME)).not.toBe('');

    const cut = clipboard();
    fireEvent.cut(document.body, { clipboardData: cut });
    expect(sequence()).toBe('');
    resetClipboardMemory();
    fireEvent.paste(document.body, { clipboardData: cut });
    expect(sequence()).toBe('GGGGGG');
    expect(editorStore.document?.features.size).toBe(1);
  });

  it('leaves a paste alone when the view does not have the focus', () => {
    const box = newSequence();
    box.blur();
    const data = clipboard();
    data.setData('text/plain', 'acgt');
    fireEvent.paste(document.body, { clipboardData: data });
    expect(sequence()).toBe('');
  });
});
