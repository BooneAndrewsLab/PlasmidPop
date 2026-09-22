// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument, createFeature } from '@/core';
import { CircularLayout } from '@/view/circular';

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

/** A point on the feature's arc, from the same layout the view builds for a 600 px canvas. */
const ON_FEATURE = ((): { clientX: number; clientY: number } => {
  const layout = new CircularLayout(doc.length, 'circular', {
    width: 600,
    height: 600,
    laneCount: 1,
    ringWidth: 14,
    outerMargin: 110,
  });
  const pt = layout.pointAt(500, layout.laneRadius(0));
  return { clientX: pt.x, clientY: pt.y };
})();
const MOUSE_ON_FEATURE = { ...ON_FEATURE, button: 0, pointerId: 1, pointerType: 'mouse' };
const FINGER_ON_FEATURE = { ...ON_FEATURE, button: 0, pointerId: 2, pointerType: 'touch' };

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

  it('lets a hover go when the mouse leaves', () => {
    const canvas = setup();
    fireEvent.pointerMove(canvas, MOUSE_ON_FEATURE);
    expect(canvas.style.cursor).toBe('pointer');
    fireEvent.pointerLeave(canvas, MOUSE_ON_FEATURE);
    expect(canvas.style.cursor).not.toBe('pointer');
  });

  it('keeps a tapped feature lit after the finger lifts, until the next tap', () => {
    const canvas = setup();
    fireEvent.pointerDown(canvas, FINGER_ON_FEATURE);
    fireEvent.pointerUp(canvas, FINGER_ON_FEATURE);
    // A finger leaves the moment it lifts; a mouse hover would be lost here.
    fireEvent.pointerLeave(canvas, FINGER_ON_FEATURE);
    expect(editorStore.getState().selectedFeatureId).toBe('f1');
    expect(canvas.style.cursor).toBe('pointer');
    const emptyFinger = { ...EMPTY, pointerId: 2, pointerType: 'touch' };
    fireEvent.pointerDown(canvas, emptyFinger);
    fireEvent.pointerUp(canvas, emptyFinger);
    expect(editorStore.getState().selection).toBeNull();
    expect(canvas.style.cursor).not.toBe('pointer');
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
