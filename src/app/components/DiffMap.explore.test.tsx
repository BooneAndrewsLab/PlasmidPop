// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';

import { type CutSite, SeqDocument, createFeature } from '@/core';
import type * as circular from '@/view/circular';
import type { renderCircularMap } from '@/view/circular';
import { CircularLayout } from '@/view/circular';

import { DiffMap } from './DiffMap';

// jsdom draws nothing: the renderer is stood in for by one that remembers
// what it was asked to highlight and where the view was, and reports one
// label at a known box.
const rendered = vi.hoisted(() => ({ calls: [] as Parameters<typeof renderCircularMap>[1][] }));
vi.mock('@/view/circular', async (importOriginal) => {
  const real = await importOriginal<typeof circular>();
  return {
    ...real,
    renderCircularMap: (_ctx: unknown, p: Parameters<typeof renderCircularMap>[1]) => {
      rendered.calls.push(p);
      return {
        droppedLabels: 0,
        labels: [
          {
            box: { left: 10, right: 60, top: 10, bottom: 24 },
            target: { kind: 'feature', featureId: 'f1' },
          },
        ],
      };
    },
  };
});

const SIZE = 360;
const doc = SeqDocument.create({
  name: 'product',
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
const cut: CutSite = {
  enzyme: 'EcoRI',
  cut: 2000,
  cutBottom: 2004,
  siteStart: 1999,
  strand: 'forward',
};

/** The layout DiffMap builds for this document at its fit. */
const layout = new CircularLayout(doc.length, 'circular', {
  width: SIZE,
  height: SIZE,
  laneCount: 1,
  ringWidth: 12,
  outerMargin: 92,
});
const at = (position: number, radius: number) => {
  const pt = layout.pointAt(position, radius);
  return { clientX: pt.x, clientY: pt.y };
};
const ON_FEATURE = { ...at(500, layout.laneRadius(0)), pointerId: 1, pointerType: 'mouse' };
const ON_CUT = { ...at(2000, layout.radius), pointerId: 1, pointerType: 'mouse' };
const CENTRE = { clientX: SIZE / 2, clientY: SIZE / 2, button: 0, pointerId: 1 };

function setup(explore = true): HTMLCanvasElement {
  rendered.calls.length = 0;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    {} as unknown as CanvasRenderingContext2D,
  );
  const view = render(
    <DiffMap doc={doc} cutSites={[cut]} size={SIZE} label="Map of product" explore={explore} />,
  );
  const canvas = view.container.querySelector('canvas');
  if (canvas === null) throw new Error('no canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, SIZE, SIZE);
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.hasPointerCapture = () => false;
  return canvas;
}

const last = () => {
  const p = rendered.calls[rendered.calls.length - 1];
  if (p === undefined) throw new Error('nothing drawn');
  return p;
};

describe('DiffMap explore (#80)', () => {
  it('brings back the label of a hovered feature, cut site or label, and lets it go', () => {
    const canvas = setup();
    fireEvent.pointerMove(canvas, ON_FEATURE);
    expect(last().hoveredFeatureId).toBe('f1');
    fireEvent.pointerMove(canvas, ON_CUT);
    expect(last().hoveredFeatureId).toBeNull();
    expect(last().hoveredCut).toBe(2000);
    fireEvent.pointerMove(canvas, { clientX: 30, clientY: 15, pointerId: 1 });
    expect(last().hoveredFeatureId).toBe('f1');
    fireEvent.pointerLeave(canvas, { pointerType: 'mouse' });
    expect(last().hoveredFeatureId).toBeNull();
    expect(last().hoveredCut).toBeNull();
  });

  it('keeps a tapped feature lit after the finger lifts', () => {
    const canvas = setup();
    const finger = { ...ON_FEATURE, button: 0, pointerId: 2, pointerType: 'touch' };
    fireEvent.pointerDown(canvas, finger);
    fireEvent.pointerUp(canvas, finger);
    fireEvent.pointerLeave(canvas, finger);
    expect(last().hoveredFeatureId).toBe('f1');
  });

  it('zooms with the buttons and the wheel, pans a zoomed map, and fits it again', () => {
    const canvas = setup();
    const fit = screen.getByRole('button', { name: 'Show the whole map' });
    expect(fit).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(last().layout.zoom).toBeCloseTo(1.6);
    expect(screen.getByText('1.6×')).toBeInTheDocument();
    fireEvent.wheel(canvas, { deltaY: -100, clientX: SIZE / 2, clientY: SIZE / 2 });
    expect(last().layout.zoom).toBeGreaterThan(1.6);
    const before = last().layout.viewport;
    fireEvent.pointerDown(canvas, CENTRE);
    fireEvent.pointerMove(canvas, { ...CENTRE, clientX: CENTRE.clientX + 40 });
    fireEvent.pointerUp(canvas, { ...CENTRE, clientX: CENTRE.clientX + 40 });
    expect(last().layout.viewport.panX).toBeGreaterThan(before.panX);
    fireEvent.click(fit);
    expect(last().layout.zoom).toBe(1);
    expect(fit).toBeDisabled();
  });

  it('fits a double-clicked feature, and zooms about any other point', () => {
    const canvas = setup();
    fireEvent.doubleClick(canvas, ON_FEATURE);
    const fitted = last().layout.zoom;
    expect(fitted).toBeGreaterThan(1.6);
    fireEvent.click(screen.getByRole('button', { name: 'Show the whole map' }));
    fireEvent.doubleClick(canvas, CENTRE);
    expect(last().layout.zoom).toBeCloseTo(1.6);
  });

  it('stays still without explore, as the save review has it', () => {
    const canvas = setup(false);
    expect(screen.queryByRole('toolbar', { name: 'Map zoom' })).toBeNull();
    act(() => {
      fireEvent.pointerMove(canvas, ON_FEATURE);
      fireEvent.wheel(canvas, { deltaY: -100 });
    });
    expect(last().hoveredFeatureId).toBeNull();
    expect(last().layout.zoom).toBe(1);
  });
});
