// @vitest-environment jsdom
import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../clipboard';
import { AlignmentStackView, type StackHandle } from './AlignmentStackView';
import type * as Draw from './alignmentStackDraw';
import {
  NAME_WIDTH,
  ROW_HEIGHT,
  RULER_HEIGHT,
  drawStack,
  type StackDrawing,
} from './alignmentStackDraw';
import { SAMPLE_FRAME as frame, SAMPLE_STACK as stack } from '../../test/alignmentStackFixture';

vi.mock('../clipboard', () => ({ copyText: vi.fn() }));
// The canvas is not drawn in jsdom: what would be drawn is what the tests read.
vi.mock('./alignmentStackDraw', async (importOriginal) => ({
  ...(await importOriginal<typeof Draw>()),
  drawStack: vi.fn(),
}));

/** The pointer and selection tests of the large view (#366, #370): what a click, a drag, a Shift-click and a press on blank space select. */

const WIDTH = 800;
const HEIGHT = 400;
/** `measureCharWidth` falls back to 8 without a canvas; the stub measures the same. */
const CHAR = 8;
/** A canvas context that takes any drawing call: the stack's own drawing is mocked, the overview's is not. */
const context = new Proxy({} as CanvasRenderingContext2D, {
  get: (_, key) => (key === 'measureText' ? () => ({ width: CHAR * 10 }) : () => undefined),
  set: () => true,
});

/** The reference's bases, and each sample's, with no track, residues or trace. */
const REFERENCE_Y = RULER_HEIGHT + ROW_HEIGHT / 2;
const HEADER = RULER_HEIGHT + ROW_HEIGHT;
const rowY = (r: number): number => HEADER + r * ROW_HEIGHT + ROW_HEIGHT / 2;
const columnX = (c: number): number => NAME_WIDTH + c * CHAR + CHAR / 2;
const mouse = { button: 0, pointerId: 1, pointerType: 'mouse' };

let descriptors: PropertyDescriptor[] = [];
function setup(over: Partial<Parameters<typeof AlignmentStackView>[0]> = {}) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const handle = createRef<StackHandle>();
  const onSelectRow = vi.fn();
  const view = render(
    <AlignmentStackView
      stack={stack}
      referenceName="ref"
      confidentFrom={20}
      selectedRow={null}
      track={null}
      classes={null}
      coverage={null}
      disagreement={[]}
      showTrace={false}
      residues={null}
      onSelectRow={onSelectRow}
      focus={null}
      handle={handle}
      {...over}
    />,
  );
  const canvas = view.container.querySelector('canvas.astack__canvas');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('no canvas');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, HEIGHT);
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;
  canvas.hasPointerCapture = () => false;
  const scroller = view.container.querySelector('.astack__scroller');
  if (!(scroller instanceof HTMLElement)) throw new Error('no scroller');
  return { ...view, canvas, scroller, handle, onSelectRow };
}

/** What the stack was last drawn with. */
const drawn = (): StackDrawing => {
  const call = vi.mocked(drawStack).mock.calls.at(-1);
  if (call === undefined) throw new Error('nothing drawn');
  return call[1];
};
const selected = () => {
  const s = drawn().selection ?? null;
  return s === null ? null : { row: s.row, track: s.track, from: s.anchor, to: s.head };
};
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
const copy = (scroller: HTMLElement, alt = false) => {
  fireEvent.keyDown(scroller, { key: 'c', code: 'KeyC', ctrlKey: true, altKey: alt });
};

describe('selecting in the large view (#370)', () => {
  beforeEach(() => {
    vi.mocked(copyText).mockClear();
    vi.mocked(drawStack).mockClear();
    // The scroller's size is what jsdom cannot lay out.
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

  it('a click on a letter selects that one cell, with no bar and no column marker, and Ctrl+C copies it', () => {
    const { canvas, scroller, onSelectRow } = setup();
    press(canvas, columnX(2), rowY(0));
    release(canvas, columnX(2), rowY(0));
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 2, to: 2 });
    expect(bar()).toBeNull();
    expect(drawn().marked).toBeNull();
    expect(onSelectRow).toHaveBeenCalledWith(0);
    copy(scroller);
    expect(copyText).toHaveBeenCalledWith('G');
  });

  it('a drag selects the run, the bar appears once the button is up, and the click that ends it marks nothing', () => {
    const { canvas } = setup();
    press(canvas, columnX(1), rowY(0));
    move(canvas, columnX(4), rowY(0));
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 1, to: 4 });
    expect(bar()).toBeNull();
    release(canvas, columnX(4), rowY(0));
    expect(bar()).not.toBeNull();
    expect(screen.getByText('4 columns')).toBeInTheDocument();
    expect(drawn().marked).toBeNull();
  });

  it('a drag into another row keeps the row it began on, and the head follows the pointer back', () => {
    const { canvas } = setup();
    press(canvas, columnX(6), REFERENCE_Y);
    move(canvas, columnX(8), rowY(1));
    expect(selected()).toEqual({ row: -1, track: 'bases', from: 6, to: 8 });
    move(canvas, columnX(3), rowY(1));
    release(canvas, columnX(3), rowY(1));
    expect(selected()).toEqual({ row: -1, track: 'bases', from: 6, to: 3 });
  });

  it('Shift-click moves the head from the clicked cell, and a plain click elsewhere starts afresh', () => {
    const { canvas } = setup();
    press(canvas, columnX(1), rowY(0));
    release(canvas, columnX(1), rowY(0));
    press(canvas, columnX(7), rowY(0), { shiftKey: true });
    release(canvas, columnX(7), rowY(0));
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 1, to: 7 });
    expect(screen.getByText('7 columns')).toBeInTheDocument();
    press(canvas, columnX(3), rowY(1));
    release(canvas, columnX(3), rowY(1));
    expect(selected()).toEqual({ row: 1, track: 'bases', from: 3, to: 3 });
    expect(bar()).toBeNull();
  });

  it('a click on a cell the sample does not cover clears the selection and selects nothing', () => {
    const { canvas } = setup();
    press(canvas, columnX(3), rowY(1));
    move(canvas, columnX(6), rowY(1));
    release(canvas, columnX(6), rowY(1));
    expect(bar()).not.toBeNull();
    // s2 starts at column 2: column 0 is blank.
    press(canvas, columnX(0), rowY(1));
    release(canvas, columnX(0), rowY(1));
    expect(selected()).toBeNull();
    expect(bar()).toBeNull();
    // Past the alignment's end is blank on every row, the reference's too.
    press(canvas, columnX(12), REFERENCE_Y);
    release(canvas, columnX(12), REFERENCE_Y);
    expect(selected()).toBeNull();
  });

  it('a drag may begin on a blank cell and run into the letters, and end past them', () => {
    const { canvas } = setup();
    press(canvas, columnX(0), rowY(1));
    expect(selected()).toBeNull();
    move(canvas, columnX(4), rowY(1));
    release(canvas, columnX(4), rowY(1));
    expect(selected()).toEqual({ row: 1, track: 'bases', from: 0, to: 4 });
    press(canvas, columnX(7), rowY(1));
    move(canvas, columnX(12), rowY(1));
    release(canvas, columnX(12), rowY(1));
    expect(selected()).toEqual({ row: 1, track: 'bases', from: 7, to: 9 });
  });

  it('a click on the ruler clears; one on the names only picks the row', () => {
    const { canvas, onSelectRow } = setup();
    press(canvas, columnX(1), rowY(0));
    move(canvas, columnX(4), rowY(0));
    release(canvas, columnX(4), rowY(0));
    press(canvas, 20, rowY(1));
    release(canvas, 20, rowY(1));
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 1, to: 4 });
    expect(onSelectRow).toHaveBeenLastCalledWith(1);
    press(canvas, columnX(5), RULER_HEIGHT / 2);
    release(canvas, columnX(5), RULER_HEIGHT / 2);
    expect(selected()).toBeNull();
  });

  it('an amino-acid strip selects by the codons drawn, and a column outside every codon is blank', () => {
    const { canvas, scroller } = setup({ residues: [frame] });
    const aaY = RULER_HEIGHT + ROW_HEIGHT + 8;
    press(canvas, columnX(1), aaY);
    move(canvas, columnX(8), aaY);
    release(canvas, columnX(8), aaY);
    expect(selected()).toEqual({ row: -1, track: 'aa', from: 1, to: 8 });
    copy(scroller);
    expect(copyText).toHaveBeenCalledWith('MKP');
    // Column 6 is the insertion column, in no codon.
    press(canvas, columnX(6), aaY);
    release(canvas, columnX(6), aaY);
    expect(selected()).toBeNull();
  });

  it('a finger is not a selection', () => {
    const { canvas } = setup();
    const finger = { ...mouse, pointerType: 'touch', pointerId: 2 };
    fireEvent.pointerDown(canvas, { ...finger, clientX: columnX(1), clientY: rowY(0) });
    fireEvent.pointerMove(canvas, { ...finger, clientX: columnX(4), clientY: rowY(0) });
    fireEvent.pointerUp(canvas, { ...finger, clientX: columnX(4), clientY: rowY(0) });
    expect(selected()).toBeNull();
  });

  it('the handle clears the selection for Esc and says whether there was one; the marker is apart from it', () => {
    const { canvas, handle, rerender } = setup();
    press(canvas, columnX(1), rowY(0));
    move(canvas, columnX(4), rowY(0));
    release(canvas, columnX(4), rowY(0));
    // Go to marks a run of columns through every row; the selection stays.
    rerender(
      <AlignmentStackView
        stack={stack}
        referenceName="ref"
        confidentFrom={20}
        selectedRow={null}
        track={null}
        classes={null}
        coverage={null}
        disagreement={[]}
        showTrace={false}
        residues={null}
        onSelectRow={vi.fn()}
        focus={{ start: 7, end: 9, nonce: 1 }}
        handle={handle}
      />,
    );
    expect(drawn().marked).toEqual({ start: 7, end: 9 });
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 1, to: 4 });
    let cleared = false;
    act(() => {
      cleared = handle.current?.clearSelection() ?? false;
    });
    expect(cleared).toBe(true);
    expect(selected()).toBeNull();
    expect(bar()).toBeNull();
    expect(drawn().marked).toEqual({ start: 7, end: 9 });
    act(() => {
      cleared = handle.current?.clearSelection() ?? true;
    });
    expect(cleared).toBe(false);
  });
});

describe('zoom in the large view (#263)', () => {
  beforeEach(() => {
    vi.mocked(drawStack).mockClear();
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

  it('draws the columns at the zoomed width, and a click lands on the column drawn there', () => {
    const { canvas } = setup({ zoom: 0.5 });
    expect(drawn().charWidth).toBeCloseTo(CHAR / 2);
    // Column 4 spans 4 * 4 .. 5 * 4 px from the names' edge at half size.
    press(canvas, NAME_WIDTH + 4 * (CHAR / 2) + 1, rowY(0));
    release(canvas, NAME_WIDTH + 4 * (CHAR / 2) + 1, rowY(0));
    expect(selected()).toEqual({ row: 0, track: 'bases', from: 4, to: 4 });
  });

  it('a picture is drawn at full size whatever the zoom, and the handle says what fits', () => {
    const { handle } = setup({ zoom: 0.25 });
    expect(handle.current?.drawing()?.charWidth).toBe(CHAR);
    expect(drawn().charWidth).toBeCloseTo(CHAR / 4);
    const fit = handle.current?.fitZoom() ?? 0;
    expect(fit).toBeCloseTo(Math.min(2, (WIDTH - NAME_WIDTH) / stack.columns / CHAR), 5);
  });

  it('Ctrl+wheel and the keys ask for a zoom; a plain wheel does not', () => {
    const onZoom = vi.fn();
    const { scroller } = setup({ onZoom });
    fireEvent.wheel(scroller, { deltaY: -100 });
    expect(onZoom).not.toHaveBeenCalled();
    fireEvent.wheel(scroller, { deltaY: -100, ctrlKey: true, clientX: 300 });
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(1.25, 3));
    fireEvent.keyDown(scroller, { key: '-' });
    expect(onZoom).toHaveBeenLastCalledWith(expect.closeTo(0.8, 3));
    fireEvent.keyDown(scroller, { key: '0' });
    expect(onZoom).toHaveBeenLastCalledWith(1);
  });
});
