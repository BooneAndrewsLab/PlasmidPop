// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MultipleAlignment } from '@/core';

import { copyText } from '../clipboard';
import { MsaDialog } from './MsaDialog';
import type * as Draw from './msaDraw';
import {
  MSA_CHAR_WIDTH,
  MSA_HEADER_HEIGHT,
  MSA_NAME_WIDTH,
  MSA_ROW_HEIGHT,
  MSA_RULER_HEIGHT,
  drawMsa,
  type MsaDrawing,
} from './msaDraw';

vi.mock('../clipboard', () => ({ copyText: vi.fn() }));
// The canvas is not drawn in jsdom: what would be drawn is what the tests read.
vi.mock('./msaDraw', async (importOriginal) => ({
  ...(await importOriginal<typeof Draw>()),
  drawMsa: vi.fn(),
}));

/** The pointer, selection and Esc tests of the multiple alignment's window (#368, #370), the same rules as the large view's. */

const alignment: MultipleAlignment = {
  alphabet: 'nucleotide',
  rows: ['AC-GTA', 'ACTG-A', '--TGTA'],
  columns: 6,
  tree: '',
};
const WIDTH = 800;
const HEIGHT = 400;
const context = new Proxy({} as CanvasRenderingContext2D, {
  get: () => () => undefined,
  set: () => true,
});
const CONSENSUS_Y = MSA_RULER_HEIGHT + MSA_ROW_HEIGHT / 2;
const rowY = (r: number): number => MSA_HEADER_HEIGHT + r * MSA_ROW_HEIGHT + MSA_ROW_HEIGHT / 2;
const columnX = (c: number): number => MSA_NAME_WIDTH + c * MSA_CHAR_WIDTH + MSA_CHAR_WIDTH / 2;
const mouse = { button: 0, pointerId: 1, pointerType: 'mouse' };

let descriptors: PropertyDescriptor[] = [];
function setup() {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const onClose = vi.fn();
  render(<MsaDialog names={['a', 'b', 'c']} alignment={alignment} onClose={onClose} />);
  const canvas = document.querySelector('canvas.msa-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.hasPointerCapture = () => false;
  const scroller = document.querySelector('.msa-scroll');
  if (!(scroller instanceof HTMLElement)) throw new Error('no scroller');
  return { canvas, scroller, onClose };
}

const drawn = (): MsaDrawing => {
  const call = vi.mocked(drawMsa).mock.calls.at(-1);
  if (call === undefined) throw new Error('nothing drawn');
  return call[1];
};
const selected = () => drawn().selection ?? null;
const press = (canvas: HTMLCanvasElement, x: number, y: number, extra = {}) => {
  fireEvent.pointerDown(canvas, { ...mouse, clientX: x, clientY: y, ...extra });
};
const move = (canvas: HTMLCanvasElement, x: number, y: number) => {
  fireEvent.pointerMove(canvas, { ...mouse, clientX: x, clientY: y });
};
const release = (canvas: HTMLCanvasElement, x: number, y: number) => {
  fireEvent.pointerUp(canvas, { ...mouse, clientX: x, clientY: y });
  fireEvent.click(canvas, { clientX: x, clientY: y });
};
const bar = () => screen.queryByRole('toolbar', { name: 'Selected residues' });
const escape = () => {
  fireEvent.keyDown(document, { key: 'Escape' });
};

describe('selecting in the multiple alignment (#370)', () => {
  beforeEach(() => {
    vi.mocked(copyText).mockClear();
    vi.mocked(drawMsa).mockClear();
    descriptors = ['clientWidth', 'clientHeight'].map((p) => {
      const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, p) ?? {
        configurable: true,
      };
      Object.defineProperty(HTMLElement.prototype, p, {
        configurable: true,
        get: () => (p === 'clientWidth' ? WIDTH : HEIGHT),
      });
      return d;
    });
  });
  afterEach(() => {
    ['clientWidth', 'clientHeight'].forEach((p, i) => {
      const d = descriptors[i];
      if (d !== undefined && 'get' in d) Object.defineProperty(HTMLElement.prototype, p, d);
      else Reflect.deleteProperty(HTMLElement.prototype, p);
    });
    vi.restoreAllMocks();
  });

  it('a click on a letter selects that one cell without the bar; a gap is a letter; Ctrl+C copies it', () => {
    const { canvas, scroller } = setup();
    press(canvas, columnX(2), rowY(1));
    release(canvas, columnX(2), rowY(1));
    expect(selected()).toEqual({ row: 1, start: 2, end: 3 });
    expect(bar()).toBeNull();
    fireEvent.keyDown(scroller, { key: 'c', code: 'KeyC', ctrlKey: true });
    expect(copyText).toHaveBeenCalledWith('T');
    press(canvas, columnX(2), rowY(0));
    release(canvas, columnX(2), rowY(0));
    expect(selected()).toEqual({ row: 0, start: 2, end: 3 });
    fireEvent.keyDown(scroller, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: true });
    expect(copyText).toHaveBeenLastCalledWith('-');
  });

  it('a drag selects the run and the bar comes once the button is up; Shift-click moves the head', () => {
    const { canvas } = setup();
    press(canvas, columnX(1), CONSENSUS_Y);
    move(canvas, columnX(3), rowY(2));
    expect(selected()).toEqual({ row: -1, start: 1, end: 4 });
    expect(bar()).toBeNull();
    release(canvas, columnX(3), rowY(2));
    expect(bar()).not.toBeNull();
    expect(screen.getByText('3 columns')).toBeInTheDocument();
    press(canvas, columnX(5), rowY(0), { shiftKey: true });
    release(canvas, columnX(5), rowY(0));
    expect(selected()).toEqual({ row: -1, start: 1, end: 6 });
  });

  it('a press past the last column, on the ruler, the conservation bar or below the rows clears', () => {
    const { canvas } = setup();
    const select = () => {
      press(canvas, columnX(0), rowY(0));
      move(canvas, columnX(2), rowY(0));
      release(canvas, columnX(2), rowY(0));
      expect(bar()).not.toBeNull();
    };
    for (const [x, y] of [
      [columnX(7), rowY(0)],
      [columnX(1), MSA_RULER_HEIGHT / 2],
      [columnX(1), MSA_HEADER_HEIGHT - 3],
      [columnX(1), rowY(3)],
    ] as const) {
      select();
      press(canvas, x, y);
      release(canvas, x, y);
      expect(selected()).toBeNull();
      expect(bar()).toBeNull();
    }
    // A drag from past the end back into the letters selects to the end.
    press(canvas, columnX(7), rowY(2));
    move(canvas, columnX(4), rowY(2));
    release(canvas, columnX(4), rowY(2));
    expect(selected()).toEqual({ row: 2, start: 4, end: 6 });
  });

  it('a finger is not a selection', () => {
    const { canvas } = setup();
    const finger = { ...mouse, pointerType: 'touch', pointerId: 2 };
    fireEvent.pointerDown(canvas, { ...finger, clientX: columnX(1), clientY: rowY(0) });
    fireEvent.pointerMove(canvas, { ...finger, clientX: columnX(4), clientY: rowY(0) });
    fireEvent.pointerUp(canvas, { ...finger, clientX: columnX(4), clientY: rowY(0) });
    expect(selected()).toBeNull();
  });

  it('Esc clears the selection first and closes the window on the next press', () => {
    const { canvas, onClose } = setup();
    press(canvas, columnX(1), rowY(0));
    move(canvas, columnX(4), rowY(0));
    release(canvas, columnX(4), rowY(0));
    escape();
    expect(selected()).toBeNull();
    expect(bar()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    escape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc closes the Advanced copy panel before the selection', () => {
    const { canvas, onClose } = setup();
    press(canvas, columnX(1), rowY(0));
    move(canvas, columnX(4), rowY(0));
    release(canvas, columnX(4), rowY(0));
    fireEvent.click(screen.getByRole('button', { name: 'Advanced copy…' }));
    expect(screen.getByRole('button', { name: 'Advanced copy…' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    escape();
    expect(screen.getByRole('button', { name: 'Advanced copy…' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(selected()).toEqual({ row: 0, start: 1, end: 5 });
    escape();
    expect(selected()).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
