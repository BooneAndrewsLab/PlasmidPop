// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';

import { SeqDocument } from '@/core';

import { editorStore } from '../state/editorStore';
import { LONG_PRESS_MS, LinearSequenceView } from './LinearSequenceView';

/**
 * Without a canvas, `measureCharWidth` falls back to 8 px a character and the
 * default font gives a 72 px gutter, so a column's x is predictable here.
 */
const CHAR_WIDTH = 8;
const LEFT_GUTTER = 72;

const doc = SeqDocument.create({ sequence: 'ACGT'.repeat(500) });

function setup() {
  act(() => {
    editorStore.openDocument(doc);
    editorStore.setSeqBasesPerRow(120);
  });
  const view = render(<LinearSequenceView doc={doc} />);
  const canvas = view.container.querySelector('canvas');
  const container = view.container.querySelector('.seq-view');
  if (canvas === null || container === null) throw new Error('no view');
  canvas.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  return { canvas, container };
}

/** Scrolls the container sideways the way a real scrollbar would. */
function scrollTo(container: Element, scrollLeft: number): void {
  Object.defineProperty(container, 'scrollLeft', { value: scrollLeft, configurable: true });
  fireEvent.scroll(container);
}

function clickColumn(canvas: Element, x: number): void {
  fireEvent.pointerDown(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: x, clientY: 30, button: 0, pointerId: 1 });
}

/** A finger at column `x`. */
function touch(x: number): Record<string, unknown> {
  return { clientX: x, clientY: 30, button: 0, pointerId: 2, pointerType: 'touch' };
}

describe('LinearSequenceView', () => {
  afterEach(() => {
    act(() => {
      editorStore.setSeqBasesPerRow(null);
      editorStore.closeDocument();
    });
  });

  it('floats the selection bar beside a selection once the drag that makes it ends (#89)', () => {
    const { canvas, container } = setup();
    const bar = (): Element | null => container.querySelector('.selection-bar');
    expect(bar()).toBeNull();
    const at = (column: number) => ({
      clientX: LEFT_GUTTER + column * CHAR_WIDTH,
      clientY: 30,
      button: 0,
      pointerId: 1,
    });
    fireEvent.pointerDown(canvas, at(10));
    fireEvent.pointerMove(canvas, at(20));
    // Not while the selection is still being dragged out.
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 20 });
    expect(bar()).toBeNull();
    fireEvent.pointerUp(canvas, at(20));
    expect(bar()).not.toBeNull();
    expect(bar()?.textContent).toContain('10 bp');
    // A caret has nothing for it to act on.
    clickColumn(canvas, LEFT_GUTTER + 5 * CHAR_WIDTH);
    expect(bar()).toBeNull();
  });

  it('shows no selection bar in the phone reader', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setSelection({ start: 10, end: 20 });
    });
    const view = render(<LinearSequenceView doc={doc} reader />);
    expect(view.container.querySelector('.selection-bar')).toBeNull();
  });

  it('puts the caret where the pointer is', () => {
    const { canvas } = setup();
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('acts on a finger only once it lifts where it landed', () => {
    const { canvas } = setup();
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(x));
    // Down alone decides nothing: it may be the start of a scroll.
    expect(editorStore.getState().selection).toBeNull();
    fireEvent.pointerUp(canvas, touch(x));
    expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
  });

  it('leaves a finger that scrolled alone', () => {
    const { canvas } = setup();
    const from = LEFT_GUTTER + 10 * CHAR_WIDTH;
    const to = LEFT_GUTTER + 30 * CHAR_WIDTH;
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerMove(canvas, touch(to));
    fireEvent.pointerUp(canvas, touch(to));
    expect(editorStore.getState().selection).toBeNull();
    // The browser taking the gesture for a scroll arrives as a cancel.
    fireEvent.pointerDown(canvas, touch(from));
    fireEvent.pointerCancel(canvas, touch(from));
    expect(editorStore.getState().selection).toBeNull();
  });

  it('shows the bases alone in the reader, whatever the toggles say', () => {
    act(() => {
      editorStore.openDocument(doc);
      editorStore.setShowComplement(true);
    });
    const spacerHeight = (view: ReturnType<typeof render>): number => {
      const spacer = view.container.querySelector<HTMLElement>('.seq-view__spacer');
      if (spacer === null) throw new Error('no spacer');
      return parseFloat(spacer.style.height);
    };
    const full = render(<LinearSequenceView doc={doc} />);
    const fullHeight = spacerHeight(full);
    full.unmount();
    const reader = render(<LinearSequenceView doc={doc} reader />);
    expect(spacerHeight(reader)).toBeLessThan(fullHeight);
  });

  it('sends a click on a clickable previewed span to the panel that drew it', () => {
    const { canvas } = setup();
    act(() => {
      editorStore.setPreview('cloning', [
        {
          id: 'frag',
          label: '200 bp',
          range: { start: 0, end: 200 },
          strand: 'none',
          shape: 'span',
          clickable: true,
        },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    // The band sits below the feature lanes, whose height depends on the
    // metrics; walk the first row from the top and click each pixel until
    // something answers, rather than restating the layout's arithmetic here.
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    for (
      let y = 0;
      y < 220 && (editorStore.getState().previewActivated?.nonce ?? 0) === before;
      y++
    ) {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 3 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 3 });
    }
    const after = editorStore.getState().previewActivated;
    expect(after?.id).toBe('frag');
    expect(after?.owner).toBe('cloning');
    act(() => {
      editorStore.clearPreview('cloning');
    });
  });

  it('leaves a previewed span that is not clickable inert', () => {
    const { canvas } = setup();
    act(() => {
      editorStore.setPreview('find', [
        { id: 'm0', label: 'match', range: { start: 0, end: 200 }, strand: 'none', shape: 'arrow' },
      ]);
    });
    const before = editorStore.getState().previewActivated?.nonce ?? 0;
    const x = LEFT_GUTTER + 10 * CHAR_WIDTH;
    for (let y = 0; y < 220; y++) {
      fireEvent.pointerDown(canvas, { clientX: x, clientY: y, button: 0, pointerId: 4 });
      fireEvent.pointerUp(canvas, { clientX: x, clientY: y, button: 0, pointerId: 4 });
    }
    expect(editorStore.getState().previewActivated?.nonce ?? 0).toBe(before);
    act(() => {
      editorStore.clearPreview('find');
    });
  });

  it('follows the view sideways when a fixed row width scrolls', () => {
    const { canvas, container } = setup();
    act(() => {
      scrollTo(container, 10 * CHAR_WIDTH);
    });
    // The canvas stays put (it is sticky); the same point on screen is now ten
    // bases further into the row.
    clickColumn(canvas, LEFT_GUTTER + 10 * CHAR_WIDTH);
    expect(editorStore.getState().selection).toEqual({ start: 20, end: 20 });
  });
  describe('long press (#43)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    const column = (n: number): number => LEFT_GUTTER + n * CHAR_WIDTH + CHAR_WIDTH / 2;

    it('selects the base under a finger that rests, and a drag then extends it', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS - 1);
      });
      // Not yet: a finger that has only just come down may be a scroll.
      expect(editorStore.getState().selection).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 11 });
      fireEvent.pointerMove(canvas, touch(column(24)));
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 25 });
      // Back past where it began: the anchor base stays in.
      fireEvent.pointerMove(canvas, touch(column(4)));
      expect(editorStore.getState().selection).toEqual({ start: 4, end: 11 });
      fireEvent.pointerUp(canvas, touch(column(4)));
      // The lift is not a tap: the selection stays.
      expect(editorStore.getState().selection).toEqual({ start: 4, end: 11 });
    });

    it('takes the drag from the browser only once the press has fired', () => {
      const { canvas } = setup();
      const touchmove = (): boolean => {
        const e = new Event('touchmove', { cancelable: true });
        canvas.dispatchEvent(e);
        return e.defaultPrevented;
      };
      fireEvent.pointerDown(canvas, touch(column(10)));
      expect(touchmove()).toBe(false); // still a scroll
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      expect(touchmove()).toBe(true);
      fireEvent.pointerUp(canvas, touch(column(10)));
      expect(touchmove()).toBe(false);
    });

    it('leaves a scroll that started before the press fired a scroll', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerMove(canvas, touch(column(30)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toBeNull();
      // And the browser taking it (a cancel) ends the wait as well.
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerCancel(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toBeNull();
    });

    it('still fires for a finger that trembles within the slop', () => {
      const { canvas } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      fireEvent.pointerMove(canvas, { ...touch(column(10)), clientY: 34 });
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 11 });
    });

    it('offers Copy where the finger let go, and copies the bases', () => {
      const writeText = vi.fn(() => Promise.resolve());
      const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
      try {
        const { canvas, container } = setup();
        fireEvent.pointerDown(canvas, touch(column(10)));
        act(() => {
          vi.advanceTimersByTime(LONG_PRESS_MS);
        });
        // Nothing is offered while the finger is still selecting.
        expect(container.querySelector('.seq-view__copy')).toBeNull();
        fireEvent.pointerMove(canvas, touch(column(17)));
        fireEvent.pointerUp(canvas, touch(column(17)));
        const button = container.querySelector('.seq-view__copy');
        expect(button).toHaveTextContent('Copy 8 bp');
        if (button === null) throw new Error('no button');
        fireEvent.click(button);
        expect(writeText).toHaveBeenCalledWith(doc.sequence.slice(10, 18));
        expect(button).toHaveTextContent('Copied');
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(container.querySelector('.seq-view__copy')).toBeNull();
      } finally {
        if (real === undefined) delete (navigator as { clipboard?: Clipboard }).clipboard;
        else Object.defineProperty(navigator, 'clipboard', real);
      }
    });

    it('takes the offer away when the selection changes', () => {
      const { canvas, container } = setup();
      fireEvent.pointerDown(canvas, touch(column(10)));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS);
      });
      fireEvent.pointerUp(canvas, touch(column(10)));
      expect(container.querySelector('.seq-view__copy')).not.toBeNull();
      act(() => {
        editorStore.setSelection({ start: 0, end: 3 });
      });
      expect(container.querySelector('.seq-view__copy')).toBeNull();
    });

    it('leaves a quick tap a tap', () => {
      const { canvas, container } = setup();
      fireEvent.pointerDown(canvas, touch(LEFT_GUTTER + 10 * CHAR_WIDTH));
      fireEvent.pointerUp(canvas, touch(LEFT_GUTTER + 10 * CHAR_WIDTH));
      act(() => {
        vi.advanceTimersByTime(LONG_PRESS_MS * 2);
      });
      expect(editorStore.getState().selection).toEqual({ start: 10, end: 10 });
      expect(container.querySelector('.seq-view__copy')).toBeNull();
    });
  });
});
