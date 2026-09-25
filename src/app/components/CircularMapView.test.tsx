// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument, createFeature } from '@/core';
import { CircularLayout, overlayRingRadius } from '@/view/circular';

import { goToChange } from '../state/editDiff';
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

/** A point on the preview ring, where the digest draws its fragments. */
const ON_PREVIEW = ((): { clientX: number; clientY: number } => {
  const layout = new CircularLayout(doc.length, 'circular', {
    width: 600,
    height: 600,
    laneCount: 1,
    ringWidth: 14,
    outerMargin: 110,
  });
  const pt = layout.pointAt(500, overlayRingRadius(layout.radius, 0, 1));
  return { clientX: pt.x, clientY: pt.y };
})();

describe('CircularMapView', () => {
  it('sends a click on a clickable previewed span to the panel that drew it', () => {
    const canvas = setup();
    act(() => {
      editorStore.setSelection(null);
      editorStore.setPreview('cloning', [
        {
          id: 'frag',
          label: '800 bp',
          range: { start: 200, end: 1000 },
          strand: 'none',
          shape: 'span',
          clickable: true,
        },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    fireEvent.pointerDown(canvas, { ...ON_PREVIEW, button: 0, pointerId: 5 });
    fireEvent.pointerUp(canvas, { ...ON_PREVIEW, button: 0, pointerId: 5 });
    const after = editorStore.getState().previewActivated;
    expect(after?.nonce).toBeGreaterThan(before);
    expect(after?.id).toBe('frag');
    // The ring sits inside the backbone's own hit band, so the press must
    // not also have started a selection there.
    expect(editorStore.getState().selection).toBeNull();
    act(() => {
      editorStore.clearPreview('cloning');
    });
  });

  it('still selects on the backbone where a span is not clickable', () => {
    const canvas = setup();
    act(() => {
      editorStore.setSelection(null);
      editorStore.setPreview('find', [
        {
          id: 'm0',
          label: 'match',
          range: { start: 200, end: 1000 },
          strand: 'none',
          shape: 'arrow',
        },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    fireEvent.pointerDown(canvas, { ...ON_PREVIEW, button: 0, pointerId: 6 });
    expect(editorStore.getState().previewActivated?.nonce ?? 0).toBe(before);
    expect(editorStore.getState().selection).not.toBeNull();
    fireEvent.pointerUp(canvas, { ...ON_PREVIEW, button: 0, pointerId: 6 });
    act(() => {
      editorStore.clearPreview('find');
    });
  });

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

describe('CircularMapView edit marks', () => {
  const annotated = SeqDocument.create({
    name: 'marked',
    sequence: 'ACGT'.repeat(1000),
    topology: 'circular',
    features: [
      createFeature({
        id: 'keep',
        type: 'CDS',
        name: 'kept',
        segments: [{ kind: 'range', start: 100, end: 900, partialStart: false, partialEnd: false }],
      }),
      createFeature({
        id: 'gone',
        type: 'CDS',
        name: 'lost',
        segments: [
          { kind: 'range', start: 2000, end: 2400, partialStart: false, partialEnd: false },
        ],
      }),
    ],
  });

  /**
   * The map of the document after three edits since it was opened: 40 bases
   * inserted at 3,000, ten deleted at 3,600, and the feature at 2,000..2,400
   * removed — a mark, a wedge and a ghost.
   */
  interface Marked {
    readonly canvas: HTMLCanvasElement;
    /** A pointer at a position, `offset` pixels outside the backbone (inside when negative). */
    readonly at: (position: number, offset?: number) => object;
    /** A pointer on the first feature lane at a position. */
    readonly inLane: (position: number) => object;
  }
  function setupMarked(): Marked {
    act(() => {
      editorStore.closeAllDocuments();
      editorStore.openDocument(annotated);
      editorStore.setEditsBaseline('opened');
      editorStore.apply({ type: 'insert', position: 3000, text: 'T'.repeat(40) });
      editorStore.apply({ type: 'delete', range: { start: 3600, end: 3610 } });
      editorStore.apply({ type: 'removeFeature', id: 'gone' });
    });
    const present = editorStore.getState().history?.present;
    if (present === undefined) throw new Error('no document');
    const view = render(<CircularMapView doc={present} />);
    const canvas = view.container.querySelector('canvas');
    if (canvas === null) throw new Error('no canvas');
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 600, 600);
    canvas.setPointerCapture = () => undefined;
    canvas.releasePointerCapture = () => undefined;
    canvas.hasPointerCapture = () => false;
    // The ghost fits beside the live feature, so the map still has one lane.
    const layout = new CircularLayout(present.length, 'circular', {
      width: 600,
      height: 600,
      laneCount: 1,
      ringWidth: 14,
      outerMargin: 110,
    });
    const pointer = (position: number, r: number): object => {
      const pt = layout.pointAt(position, r);
      return { clientX: pt.x, clientY: pt.y, button: 0, pointerId: 7, pointerType: 'mouse' };
    };
    return {
      canvas,
      at: (position, offset = 0) => pointer(position, layout.radius + offset),
      inLane: (position) => pointer(position, layout.laneRadius(0)),
    };
  }
  const click = (canvas: HTMLCanvasElement, at: object): void => {
    fireEvent.pointerDown(canvas, at);
    fireEvent.pointerUp(canvas, at);
  };

  it('selects an inserted stretch when its mark is clicked, as Next change would', () => {
    const { canvas, at } = setupMarked();
    act(() => {
      editorStore.setSelection({ start: 2990, end: 2990 });
      goToChange(1);
    });
    const next = editorStore.getState().selection;
    expect(next?.start).toBe(3000);
    act(() => {
      editorStore.setSelection(null);
    });
    click(canvas, at(3020));
    expect(editorStore.getState().selection).toEqual(next);
  });

  it('still drags a selection that starts on a mark', () => {
    const { canvas, at } = setupMarked();
    fireEvent.pointerDown(canvas, at(3020));
    fireEvent.pointerMove(canvas, at(3300));
    fireEvent.pointerUp(canvas, at(3300));
    expect(editorStore.getState().selection).toEqual({ start: 3020, end: 3300 });
  });

  it('puts the caret where bases were deleted when the wedge is clicked', () => {
    const { canvas, at } = setupMarked();
    click(canvas, at(3640, -6));
    expect(editorStore.getState().selection).toEqual({ start: 3640, end: 3640 });
  });

  it('selects where a removed feature was when its ghost is clicked', () => {
    const { canvas, inLane } = setupMarked();
    click(canvas, inLane(2200));
    expect(editorStore.getState().selection).toEqual({ start: 2000, end: 2400 });
    expect(editorStore.getState().selectedFeatureId).toBeNull();
  });

  it('lets a live feature win its own arc with marks on', () => {
    const { canvas, inLane } = setupMarked();
    click(canvas, inLane(500));
    expect(editorStore.getState().selectedFeatureId).toBe('keep');
  });

  it('shows a pointer over a mark, and not beside it', () => {
    const { canvas, at } = setupMarked();
    fireEvent.pointerMove(canvas, at(3020));
    expect(canvas.style.cursor).toBe('pointer');
    fireEvent.pointerMove(canvas, at(1500));
    expect(canvas.style.cursor).not.toBe('pointer');
  });

  /** Shows one cut site, of an enzyme made up for it, on the document in front. */
  const showCut = (cut: number): void => {
    const present = editorStore.getState().history?.present;
    if (present === undefined) throw new Error('no document');
    act(() => {
      editorStore.setAnalysis(
        present,
        [{ enzyme: 'TestI', cut, cutBottom: cut, siteStart: cut - 3, strand: 'forward' }],
        [],
      );
      editorStore.setShownEnzymes(['TestI']);
    });
  };

  it('puts the caret at a cut site over a mark, as hovering it says (#82)', () => {
    const { canvas, at } = setupMarked();
    showCut(3020);
    fireEvent.pointerMove(canvas, at(3021));
    expect(canvas.style.cursor).toBe('pointer');
    click(canvas, at(3021));
    // At the cut itself, not at the base pressed on, and not the whole mark.
    expect(editorStore.getState().selection).toEqual({ start: 3020, end: 3020 });
  });

  it('still selects the mark away from the cut site on it', () => {
    const { canvas, at } = setupMarked();
    showCut(3005);
    act(() => {
      editorStore.setSelection({ start: 2990, end: 2990 });
      goToChange(1);
    });
    const mark = editorStore.getState().selection;
    act(() => {
      editorStore.setSelection(null);
    });
    click(canvas, at(3035));
    expect(editorStore.getState().selection).toEqual(mark);
    expect(mark?.start).toBe(3000);
  });

  it('puts the caret at a cut site over a wedge rather than at the deletion', () => {
    const { canvas, at } = setupMarked();
    showCut(3638);
    click(canvas, at(3640, -6));
    expect(editorStore.getState().selection).toEqual({ start: 3638, end: 3638 });
  });

  it('lets a hovered mark go when the diff changes under a still pointer', () => {
    const { canvas, at } = setupMarked();
    fireEvent.pointerMove(canvas, at(3020));
    expect(canvas.style.cursor).toBe('pointer');
    // Another insertion earlier renumbers the marks: the hover would name it.
    act(() => {
      editorStore.apply({ type: 'insert', position: 10, text: 'GG' });
    });
    expect(canvas.style.cursor).not.toBe('pointer');
    fireEvent.pointerMove(canvas, at(3020));
    expect(canvas.style.cursor).toBe('pointer');
  });
});
