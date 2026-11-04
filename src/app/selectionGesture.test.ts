import { describe, expect, it } from 'vitest';

import {
  BAR_FROM_COLUMNS,
  barWanted,
  gestureMove,
  gesturePress,
  gestureRelease,
  idleGesture,
  type Gesture,
  type GestureOps,
} from './selectionGesture';

interface Sel {
  readonly row: number;
  readonly anchor: number;
  readonly head: number;
}

const ops: GestureOps<number, Sel> = {
  start: (row, column) => ({ row, anchor: column, head: column }),
  extend: (sel, column) => ({ ...sel, head: column }),
};
const letter = (row: number, column: number) => ({ key: row, column, letter: true });
const blank = (row: number, column: number) => ({ key: row, column, letter: false });
const idle = (): Gesture<number, Sel> => idleGesture();

describe('a press (#370)', () => {
  it('on a letter selects that one cell and starts dragging', () => {
    const g = gesturePress(idle(), letter(1, 5), false, ops);
    expect(g).toEqual({ selection: { row: 1, anchor: 5, head: 5 }, pending: null, dragging: true });
  });

  it('on a letter replaces the selection there was', () => {
    const had = gestureRelease(gesturePress(idle(), letter(0, 2), false, ops));
    expect(gesturePress(had, letter(1, 7), false, ops).selection).toEqual({
      row: 1,
      anchor: 7,
      head: 7,
    });
  });

  it('off every row clears everything', () => {
    const had = gestureRelease(gesturePress(idle(), letter(0, 2), false, ops));
    expect(gesturePress(had, null, false, ops)).toEqual(idle());
    expect(gesturePress(had, null, true, ops)).toEqual(idle());
  });

  it('on a blank cell clears the selection and selects nothing on its own', () => {
    const had = gestureRelease(gesturePress(idle(), letter(0, 2), false, ops));
    const g = gesturePress(had, blank(0, 9), false, ops);
    expect(g.selection).toBeNull();
    expect(g.pending).toEqual({ key: 0, column: 9 });
    expect(gestureRelease(g)).toEqual(idle());
  });

  it('with Shift moves the head of the selection, blank cell or not, and whatever the row', () => {
    const had = gestureRelease(gesturePress(idle(), letter(0, 2), false, ops));
    expect(gesturePress(had, letter(0, 8), true, ops).selection).toEqual({
      row: 0,
      anchor: 2,
      head: 8,
    });
    expect(gesturePress(had, blank(2, 11), true, ops).selection).toEqual({
      row: 0,
      anchor: 2,
      head: 11,
    });
  });

  it('with Shift but nothing selected is a plain press', () => {
    expect(gesturePress(idle(), letter(1, 3), true, ops).selection).toEqual({
      row: 1,
      anchor: 3,
      head: 3,
    });
    expect(gesturePress(idle(), blank(1, 3), true, ops).selection).toBeNull();
  });
});

describe('a drag', () => {
  it('extends the selection with the pointer, and returns the same object when the column is the same', () => {
    const g = gesturePress(idle(), letter(1, 5), false, ops);
    expect(gestureMove(g, 5, ops)).toBe(g);
    const moved = gestureMove(g, 9, ops);
    expect(moved.selection).toEqual({ row: 1, anchor: 5, head: 9 });
    expect(gestureMove(moved, 3, ops).selection).toEqual({ row: 1, anchor: 5, head: 3 });
  });

  it('that begins on a blank cell selects from it once the pointer reaches another column', () => {
    const g = gesturePress(idle(), blank(1, 12), false, ops);
    expect(gestureMove(g, 12, ops)).toBe(g);
    const moved = gestureMove(g, 8, ops);
    expect(moved).toEqual({
      selection: { row: 1, anchor: 12, head: 8 },
      pending: null,
      dragging: true,
    });
    expect(gestureRelease(moved).selection).toEqual({ row: 1, anchor: 12, head: 8 });
  });

  it('does nothing with the button up', () => {
    const g = gestureRelease(gesturePress(idle(), letter(1, 5), false, ops));
    expect(gestureMove(g, 9, ops)).toBe(g);
    expect(gestureMove(idle(), 9, ops)).toEqual(idle());
  });

  it('ends on release, keeping the selection; a release with nothing pressed is the same object', () => {
    const g = gestureRelease(gestureMove(gesturePress(idle(), letter(1, 5), false, ops), 7, ops));
    expect(g).toEqual({ selection: { row: 1, anchor: 5, head: 7 }, pending: null, dragging: false });
    expect(gestureRelease(g)).toBe(g);
  });
});

describe('the bar', () => {
  it(`floats beside ${BAR_FROM_COLUMNS} columns or more once the button is up, never beside one clicked cell`, () => {
    const one = gestureRelease(gesturePress(idle(), letter(1, 5), false, ops));
    expect(barWanted(one, { start: 5, end: 6 })).toBe(false);
    const dragging = gestureMove(gesturePress(idle(), letter(1, 5), false, ops), 7, ops);
    expect(barWanted(dragging, { start: 5, end: 8 })).toBe(false);
    expect(barWanted(gestureRelease(dragging), { start: 5, end: 8 })).toBe(true);
    expect(barWanted(gestureRelease(dragging), null)).toBe(false);
  });
});
