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
