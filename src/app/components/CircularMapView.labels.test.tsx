// @vitest-environment jsdom
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { SeqDocument, createFeature } from '@/core';
import type * as circular from '@/view/circular';
import type { renderCircularMap } from '@/view/circular';

import { editorStore } from '../state/editorStore';
import { CircularMapView } from './CircularMapView';

// jsdom draws nothing, so no label is ever placed: the renderer is stood in
// for by one that reports a feature's label and a cut site's at known boxes,
// and remembers what it was asked to highlight.
const rendered = vi.hoisted(() => ({ calls: [] as Parameters<typeof renderCircularMap>[1][] }));
vi.mock('@/view/circular', async (importOriginal) => {
  const real = await importOriginal<typeof circular>();
  return {
    ...real,
    renderCircularMap: (_ctx: unknown, p: Parameters<typeof renderCircularMap>[1]) => {
      rendered.calls.push(p);
      return {
        dropped: 0,
        labels: [
          {
            box: { left: 10, right: 60, top: 10, bottom: 24 },
            target: { kind: 'feature', featureId: 'f1' },
          },
          {
            box: { left: 10, right: 60, top: 40, bottom: 54 },
            target: { kind: 'cut', position: 7 },
          },
        ],
      };
    },
  };
});

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

async function setup(): Promise<HTMLCanvasElement> {
  rendered.calls.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
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
  // The labels are known once the first frame is drawn.
  await waitFor(() => {
    expect(rendered.calls.length).toBeGreaterThan(0);
  });
  return canvas;
}

const last = (): Parameters<typeof renderCircularMap>[1] | undefined => rendered.calls.at(-1);

describe('CircularMapView labels on a touch screen (#42)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lights a tapped feature label and its leader, as a tap on the feature does', async () => {
    const canvas = await setup();
    const finger = { clientX: 30, clientY: 16, button: 0, pointerId: 2, pointerType: 'touch' };
    fireEvent.pointerDown(canvas, finger);
    fireEvent.pointerUp(canvas, finger);
    fireEvent.pointerLeave(canvas, finger);
    expect(editorStore.getState().selectedFeatureId).toBe('f1');
    await waitFor(() => {
      expect(last()?.hoveredFeatureId).toBe('f1');
    });
  });

  it('lights a tapped cut-site label', async () => {
    const canvas = await setup();
    const finger = { clientX: 30, clientY: 46, button: 0, pointerId: 2, pointerType: 'touch' };
    fireEvent.pointerDown(canvas, finger);
    fireEvent.pointerUp(canvas, finger);
    fireEvent.pointerLeave(canvas, finger);
    await waitFor(() => {
      expect(last()?.hoveredCut).toBe(7);
    });
    expect(last()?.hoveredFeatureId).toBeNull();
  });

  it('leaves a mouse click to the hover it already has', async () => {
    const canvas = await setup();
    const mouse = { clientX: 30, clientY: 16, button: 0, pointerId: 1, pointerType: 'mouse' };
    fireEvent.pointerDown(canvas, mouse);
    fireEvent.pointerUp(canvas, mouse);
    expect(editorStore.getState().selectedFeatureId).toBe('f1');
    expect(last()?.hoveredFeatureId).toBeNull();
  });
});
