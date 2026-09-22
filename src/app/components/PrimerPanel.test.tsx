// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { PrimerPanel } from './PrimerPanel';

// A pseudo-random but fixed 600-bp template with balanced composition, the
// same one the design tests use, so pairs are found.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

const doc = SeqDocument.create({ sequence: template() });

/** Opens the document with a target selected and the first pair designed. */
function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setSelection({ start: 250, end: 350 });
  });
  const view = render(<PrimerPanel doc={doc} />);
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
  });
  return view;
}

function firstToggle(): HTMLElement {
  const button = screen.getAllByRole('button', { name: /^Show$|^Hide$/ })[0];
  if (button === undefined) throw new Error('no pair was designed');
  return button;
}

describe('PrimerPanel', () => {
  afterEach(() => {
    act(() => {
      editorStore.closeDocument();
    });
  });

  it('gives the selection back when a shown pair is hidden', () => {
    setup();
    const target = editorStore.getState().selection;
    act(() => {
      fireEvent.click(firstToggle());
    });
    const product = editorStore.getState().selection;
    expect(product).not.toBeNull();
    expect(product).not.toEqual(target);
    expect(editorStore.getState().preview?.items.length).toBe(3);

    act(() => {
      fireEvent.click(firstToggle());
    });
    // The preview and the highlight go together: a product left selected
    // reads as a pair still being shown.
    expect(editorStore.getState().selection).toBeNull();
    expect(editorStore.getState().preview).toBeNull();
  });

  it('leaves a selection the user made since alone', () => {
    setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    const mine = { start: 10, end: 20 };
    act(() => {
      editorStore.setSelection(mine);
    });
    act(() => {
      fireEvent.click(firstToggle());
    });
    expect(editorStore.getState().selection).toEqual(mine);
  });

  it('takes its selection away with it when the tab is left', () => {
    const view = setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    expect(editorStore.getState().selection).not.toBeNull();
    act(() => {
      view.unmount();
    });
    expect(editorStore.getState().selection).toBeNull();
  });

  it('keeps the target when the same selection is designed for again', () => {
    setup();
    act(() => {
      fireEvent.click(firstToggle());
    });
    // Designing for the product is a new target, not a preview this panel
    // is holding: hiding nothing must not clear it.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Design primers' }));
    });
    expect(editorStore.getState().selection).not.toBeNull();
  });
});
