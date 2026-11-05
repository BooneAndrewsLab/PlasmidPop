import { describe, expect, it } from 'vitest';

import {
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  fitZoom,
  letterFont,
  lettersLegible,
  rulerStep,
  stepZoom,
  wheelZoom,
  zoomedScroll,
} from './alignmentZoom';

describe('zoom arithmetic (#263)', () => {
  it('clamps and steps', () => {
    expect(clampZoom(100)).toBe(ZOOM_MAX);
    expect(clampZoom(0)).toBe(ZOOM_MIN);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(stepZoom(1, 1)).toBeCloseTo(1.25);
    expect(stepZoom(1, -2)).toBeCloseTo(0.64);
    expect(stepZoom(ZOOM_MAX, 3)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -3)).toBe(ZOOM_MIN);
  });

  it('fits columns into a width', () => {
    expect(fitZoom(1000, 800, 8)).toBeCloseTo(0.1);
    expect(fitZoom(10, 800, 8)).toBe(ZOOM_MAX);
    expect(fitZoom(0, 800, 8)).toBe(1);
  });

  it('shows letters from a 7 px font up, and bars below', () => {
    expect(lettersLegible(8)).toBe(true);
    expect(lettersLegible(4.2)).toBe(true);
    expect(lettersLegible(4)).toBe(false);
    expect(letterFont(0.5, 13)).toBe(6.5);
    expect(letterFont(2, 13)).toBe(16);
  });

  it('keeps the column under the anchor in place', () => {
    // Column 50 at 8 px sits at 400; at 16 px it must still sit under x = 100.
    const left = zoomedScroll(300, 100, 8, 16);
    expect((left + 100) / 16).toBeCloseTo((300 + 100) / 8);
    expect(zoomedScroll(0, 0, 8, 4)).toBe(0);
    expect(zoomedScroll(10, 400, 8, 1)).toBe(0);
  });

  it('picks the smallest of 10, 20, 50, 100 … whose labels clear each other', () => {
    expect(rulerStep(8, 40)).toBe(10);
    expect(rulerStep(2, 40)).toBe(50);
    expect(rulerStep(3, 40)).toBe(20);
    expect(rulerStep(0.5, 40)).toBe(100);
    expect(rulerStep(0.01, 40)).toBe(5000);
    expect(rulerStep(0, 40)).toBe(10);
  });

  it('turns a wheel into a step: up zooms in, a notch is one step, and it clamps', () => {
    expect(wheelZoom(1, -100)).toBeCloseTo(1.25);
    expect(wheelZoom(1, 100)).toBeCloseTo(0.8);
    expect(wheelZoom(1, -3, 1)).toBeCloseTo(1.25 ** 0.99, 1);
    expect(wheelZoom(1, 0)).toBe(1);
    expect(wheelZoom(ZOOM_MAX, -100)).toBe(ZOOM_MAX);
    expect(wheelZoom(1, -1e6)).toBeCloseTo(1.25 ** 3);
  });
});
