// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAP_ZOOM_STEP, MapZoomControls } from './MapZoomControls';

afterEach(cleanup);

const button = (name: string): HTMLButtonElement => {
  const el = screen.getByRole('button', { name });
  if (!(el instanceof HTMLButtonElement)) throw new Error('not a button');
  return el;
};

const renderControls = (
  zoom: number,
  extra: Partial<Parameters<typeof MapZoomControls>[0]> = {},
  maxZoom = 40,
) => {
  const onZoomBy = vi.fn();
  const onFit = vi.fn();
  render(
    <MapZoomControls zoom={zoom} maxZoom={maxZoom} onZoomBy={onZoomBy} onFit={onFit} {...extra} />,
  );
  return { onZoomBy, onFit };
};

describe('MapZoomControls', () => {
  it('disables out and fit and hides the readout at zoom 1', () => {
    renderControls(1);
    expect(button('Zoom out').disabled).toBe(true);
    expect(button('Show the whole map').disabled).toBe(true);
    expect(button('Zoom in').disabled).toBe(false);
    expect(screen.queryByText(/×$/)).toBeNull();
  });

  it('disables zoom in at the maximum', () => {
    renderControls(40);
    expect(button('Zoom in').disabled).toBe(true);
    expect(button('Zoom out').disabled).toBe(false);
  });

  it('reads the zoom to one decimal below 10 and rounded from 10', () => {
    renderControls(1.6);
    expect(screen.getByText('1.6×')).toBeTruthy();
    cleanup();
    renderControls(12.4);
    expect(screen.getByText('12×')).toBeTruthy();
  });

  it('zooms by a step and its inverse, and fits', () => {
    const { onZoomBy, onFit } = renderControls(2);
    fireEvent.click(button('Zoom in'));
    expect(onZoomBy).toHaveBeenLastCalledWith(MAP_ZOOM_STEP);
    expect(MAP_ZOOM_STEP).toBe(1.6);
    fireEvent.click(button('Zoom out'));
    expect(onZoomBy).toHaveBeenLastCalledWith(1 / 1.6);
    fireEvent.click(button('Show the whole map'));
    expect(onFit).toHaveBeenCalledTimes(1);
  });

  it('has no selection button unless given one', () => {
    renderControls(1);
    expect(screen.queryByRole('button', { name: 'Zoom to selection' })).toBeNull();
  });

  it('shows the selection button between out and fit, disabled as told, and calls it', () => {
    const onClick = vi.fn();
    renderControls(1, { zoomToSelection: { disabled: true, onClick } });
    expect(button('Zoom to selection').disabled).toBe(true);
    cleanup();
    renderControls(1, { zoomToSelection: { disabled: false, onClick } });
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Zoom in', 'Zoom out', 'Zoom to selection', 'Show the whole map']);
    fireEvent.click(button('Zoom to selection'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
