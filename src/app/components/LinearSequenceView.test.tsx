// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { LinearSequenceView } from './LinearSequenceView';

/**
 * Without a canvas, `measureCharWidth` falls back to 8 px a character and the
 * default font gives a 72 px gutter, so a column's x is predictable here.
 */
const CHAR_WIDTH = 8;
const LEFT_GUTTER = 72;

const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(500) });

function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setSeqBasesPerRow(120);
  });
  const view = render(<LinearSequenceView doc={doc} />);
  const canvas = view.container.querySelector('canvas');
  const container = view.container.querySelector('.seq-view');
  if (canvas === null || container === null) throw new Error('no view');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  return { canvas, container };
}

/** Scrolls the container sideways the way a real scrollbar would. */
function scrollTo(container: Element, scrollLeft: number): void {
  Object.defineProperty(container, 'scrollLeft', { value: scrollLeft, configurable: true });
  fireEvent.scroll(container);
}

function clickColumn(canvas: Element, x: number): void {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
}

/** A finger at column `x`. */
function touch(x: number): Record<string, unknown> {
  return { clientX: x, clientY: 30, button: 0, pointerId: 2, pointerType: 'touch' };
}

describe('LinearSequenceView', () => {
  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.closeDocument();
    });
  });

  it('puts the caret where the pointer is', () => {
    const { canvas } = setup();
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('acts on a finger only once it lifts where it landed', () => {
    const { canvas } = setup();
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(x));
    // Down alone decides nothing: it may be the start of a scroll.
    expect(editorStore.getState().selection).toBeNull();
    fireEvent.pointerUp(canvas, touch(x));
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('leaves a finger that scrolled alone', () => {
    const { canvas } = setup();
    const from = LEFT_GUTTER + 10 * CHAR_WIDTH;
    const to = LEFT_GUTTER + 30 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerMove(canvas, touch(to));
    fireEvent.pointerUp(canvas, touch(to));
    expect(editorStore.getState().selection).toBeNull();
    // The browser taking the gesture for a scroll arrives as a cancel.
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerCancel(canvas, touch(from));
    expect(editorStore.getState().selection).toBeNull();
  });

  it('shows the bases alone in the reader, whatever the toggles say', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setShowComplement(true);
    });
    const spacerHeight = (view: ReturnType<typeof render>): number => {
      const spacer = view.container.querySelector<HTMLElement>('.seq-view__spacer');
      if (spacer === null) throw new Error('no spacer');
      return parseFloat(spacer.style.height);
    };
    const full = render(<LinearSequenceView doc={doc} />);
    const fullHeight = spacerHeight(full);
    full.unmount();
    const reader = render(<LinearSequenceView doc={doc} reader />);
    expect(spacerHeight(reader)).toBeLessThan(fullHeight);
  });

  it('follows the view sideways when a fixed row width scrolls', () => {
    const { canvas, container } = setup();
    act(() => {
      scrollTo(container, 10 * CHAR_WIDTH);
    });
    // The canvas stays put (it is sticky); the same point on screen is now ten
    // bases further into the row.
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 20, end: 20 });
  });
});
