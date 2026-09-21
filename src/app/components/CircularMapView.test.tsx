// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument, createFeature } from '@/core';

import { editorStore } from '../state/editorStore';
import { CircularMapView } from './CircularMapView';

const doc = SeqDocument.create({
  name: 'circle',
  sequence: 'ACGT'.repeat(1000),
  topology: 'circular',
  features: [
    createFeature({
      id: 'f1',
      type: 'CDS',
      name: 'thing',
      segments: [{ kind: 'range', start: 100, end: 900, partialStart: false, partialEnd: false }],
    }),
  ],
});

function setup(): HTMLCanvasElement {
  act(() => {
    editorStore.openDocument(doc);
  });
  const view = render(<CircularMapView doc={doc} />);
  const canvas = view.container.querySelector('canvas');
  if (canvas === null) throw new Error('no canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.hasPointerCapture = () => false;
  return canvas;
}

/** The middle of the map, which is neither the backbone nor a feature lane. */
const EMPTY = { clientX: 300, clientY: 300, button: 0, pointerId: 1 };

describe('CircularMapView', () => {
  it('clears the selection when empty space is clicked', () => {
    const canvas = setup();
    act(() => {
      editorStore.setSelection({ start: 10, end: 20 });
    });
    expect(editorStore.getState().selection).not.toBeNull();
    fireEvent.pointerDown(canvas, EMPTY);
    fireEvent.pointerUp(canvas, EMPTY);
    expect(editorStore.getState().selection).toBeNull();
  });

  it('keeps the selection when empty space is dragged to pan', () => {
    const canvas = setup();
    act(() => {
      editorStore.setSelection({ start: 10, end: 20 });
    });
    fireEvent.pointerDown(canvas, EMPTY);
    fireEvent.pointerMove(canvas, { ...EMPTY, clientX: 340 });
    fireEvent.pointerUp(canvas, { ...EMPTY, clientX: 340 });
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 20 });
  });
});
