// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/react';

import { SPLITTER_SIZE, Splitter } from './Splitter';

/** Container 1000 px wide, handle at 400: panes of 400 and 594. */
const CONTAINER = 1000;
const HANDLE_AT = 400;

interface Move {
  readonly before: number;
  readonly extent: number;
}

function setup(
  axis: 'x' | 'y' = 'x',
  props: Partial<{ minBefore: number; minAfter: number }> = {},
): { handle: HTMLElement; moves: Move[]; resets: () => number } {
  const moves: Move[] = [];
  let resetCount = 0;
  const view = render(
    <Splitter
      axis={axis}
      label="Resize"
      minBefore={props.minBefore ?? 200}
      minAfter={props.minAfter ?? 260}
      value={40}
      min={5}
      max={95}
      valueText="40%"
      onMove={(before, extent) => moves.push({ before, extent })}
      onReset={() => {
        resetCount += 1;
      }}
    />,
  );
  const handle = view.container.querySelector('[role="separator"]');
  if (handle === null) throw new Error('no separator');
  const el = handle as HTMLElement;
  const parent = el.parentElement;
  if (parent === null) throw new Error('no container');
  // jsdom lays nothing out, so both boxes are stated.
  parent.getBoundingClientRect = () =>
    axis === 'x' ? new DOMRect(0, 0, CONTAINER, 500) : new DOMRect(0, 0, 500, CONTAINER);
  el.getBoundingClientRect = () =>
    axis === 'x'
      ? new DOMRect(HANDLE_AT, 0, SPLITTER_SIZE, 500)
      : new DOMRect(0, HANDLE_AT, 500, SPLITTER_SIZE);
  el.setPointerCapture = () => undefined;
  el.releasePointerCapture = () => undefined;
  el.hasPointerCapture = () => true;
  return { handle: el, moves, resets: () => resetCount };
}

/** The room the two panes share: everything but the handle. */
const EXTENT = CONTAINER - SPLITTER_SIZE;

describe('Splitter', () => {
  it('describes itself as a separator on the axis it divides', () => {
    const { handle } = setup('x');
    expect(handle.getAttribute('aria-orientation')).toBe('vertical');
    expect(handle.getAttribute('aria-valuenow')).toBe('40');
    expect(handle.getAttribute('aria-valuetext')).toBe('40%');
    expect(handle.tabIndex).toBe(0);
    expect(setup('y').handle.getAttribute('aria-orientation')).toBe('horizontal');
  });

  it('moves the boundary with the pointer, keeping where it was grabbed', () => {
    const { handle, moves } = setup('x');
    // Grabbed 4 px into the handle, so the pane is the pointer less those 4.
    fireEvent.pointerDown(handle, { clientX: HANDLE_AT + 4, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 604, clientY: 10, pointerId: 1 });
    expect(moves).toEqual([{ before: 600, extent: EXTENT }]);
  });

  it('ignores a move before the handle was taken hold of', () => {
    const { handle, moves } = setup('x');
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 10, pointerId: 1 });
    expect(moves).toEqual([]);
    // And stops following once the button is let go.
    fireEvent.pointerDown(handle, { clientX: HANDLE_AT, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: HANDLE_AT, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 700, clientY: 10, pointerId: 1 });
    expect(moves).toEqual([]);
  });

  it('holds both panes to their floors', () => {
    const { handle, moves } = setup('x', { minBefore: 200, minAfter: 260 });
    fireEvent.pointerDown(handle, { clientX: HANDLE_AT, clientY: 10, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: -50, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 5000, clientY: 10, pointerId: 1 });
    expect(moves).toEqual([
      { before: 200, extent: EXTENT },
      { before: EXTENT - 260, extent: EXTENT },
    ]);
  });

  it('follows the pointer down the other axis when it divides two rows', () => {
    const { handle, moves } = setup('y');
    fireEvent.pointerDown(handle, { clientX: 10, clientY: HANDLE_AT, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 10, clientY: 300, pointerId: 1 });
    expect(moves).toEqual([{ before: 300, extent: EXTENT }]);
  });

  it('moves with the arrow keys of its own axis, and jumps with the page keys', () => {
    const { handle, moves } = setup('x');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    fireEvent.keyDown(handle, { key: 'PageDown' });
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'End' });
    // Up and down belong to the other axis and are left to the page.
    fireEvent.keyDown(handle, { key: 'ArrowUp' });
    expect(moves.map((m) => m.before)).toEqual([416, 384, 464, 200, EXTENT - 260]);
  });

  it('puts the boundary back on a double-click', () => {
    const { handle, resets } = setup('x');
    fireEvent.doubleClick(handle);
    expect(resets()).toBe(1);
  });
});
