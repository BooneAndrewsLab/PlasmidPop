// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followTooltip, hideFollowTooltip } from './tooltip';
import { SHOW_DELAY_MS, TOOLTIP_ID, TooltipLayer, WARM_MS } from './TooltipLayer';

const VIEW = { width: 800, height: 600 };
const TIP = { width: 100, height: 24 };

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

/** Renders the layer with `ui`; the tooltip node measures `TIP` in an `VIEW` window. */
function setup(ui: ReactNode): HTMLElement {
  render(
    <>
      <TooltipLayer />
      {ui}
    </>,
  );
  const tip = screen.getByRole('tooltip', { hidden: true });
  tip.getBoundingClientRect = () => rect(0, 0, TIP.width, TIP.height);
  return tip;
}

function at(el: HTMLElement, left: number, top: number, width: number, height: number): void {
  el.getBoundingClientRect = () => rect(left, top, width, height);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date', 'performance'] });
  Object.defineProperty(document.documentElement, 'clientWidth', {
    value: VIEW.width,
    configurable: true,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    value: VIEW.height,
    configurable: true,
  });
});

afterEach(() => {
  hideFollowTooltip();
  vi.useRealTimers();
});

describe('TooltipLayer', () => {
  it('shows a control’s tip after the delay and describes the control by it', () => {
    const tip = setup(<button data-tip="Zoom in">+</button>);
    const button = screen.getByRole('button');
    at(button, 100, 100, 40, 20);

    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    expect(tip).not.toBeVisible();
    expect(button).not.toHaveAttribute('aria-describedby');

    vi.advanceTimersByTime(1);
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Zoom in');
    expect(button).toHaveAttribute('aria-describedby', TOOLTIP_ID);
    // Centred under the control, GAP below it.
    expect(tip.style.translate).toBe('70px 126px');

    fireEvent.pointerOut(button, { relatedTarget: document.body });
    expect(tip).not.toBeVisible();
    expect(button).not.toHaveAttribute('aria-describedby');
  });

  it('moves between a control’s children without going away', () => {
    const tip = setup(
      <button data-tip="Undo">
        <span>a</span>
        <span>b</span>
      </button>,
    );
    const [a, b] = screen.getAllByText(/[ab]/);
    if (a === undefined || b === undefined) throw new Error('spans');
    fireEvent.pointerOver(a, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toBeVisible();
    fireEvent.pointerOut(a, { relatedTarget: b });
    fireEvent.pointerOver(b, { pointerType: 'mouse' });
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Undo');
  });

  it('shows the next control’s tip at once while one was just showing', () => {
    const tip = setup(
      <>
        <button data-tip="First">1</button>
        <button data-tip="Second">2</button>
      </>,
    );
    const [first, second] = screen.getAllByRole('button');
    if (first === undefined || second === undefined) throw new Error('buttons');

    fireEvent.pointerOver(first, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toHaveTextContent('First');
    fireEvent.pointerOut(first, { relatedTarget: second });
    fireEvent.pointerOver(second, { pointerType: 'mouse' });
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('Second');
    expect(second).toHaveAttribute('aria-describedby', TOOLTIP_ID);
    expect(first).not.toHaveAttribute('aria-describedby');

    // Once the warm moment has passed, the delay is back.
    fireEvent.pointerOut(second, { relatedTarget: document.body });
    vi.advanceTimersByTime(WARM_MS);
    fireEvent.pointerOver(first, { pointerType: 'mouse' });
    expect(tip).not.toBeVisible();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toBeVisible();
  });

  it('a pointer that only crosses a control shows nothing', () => {
    const tip = setup(<button data-tip="Zoom in">+</button>);
    const button = screen.getByRole('button');
    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS / 2);
    fireEvent.pointerOut(button, { relatedTarget: document.body });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).not.toBeVisible();
  });

  it('keyboard focus shows it at once and Escape hides it; a click’s focus does not', () => {
    const tip = setup(<button data-tip="Zoom in">+</button>);
    const button = screen.getByRole('button');

    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focusIn(button);
    expect(tip).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', TOOLTIP_ID);
    fireEvent.keyDown(button, { key: 'Escape' });
    expect(tip).not.toBeVisible();
    expect(button).not.toHaveAttribute('aria-describedby');

    fireEvent.keyDown(document.body, { key: 'Tab' });
    fireEvent.focusIn(button);
    expect(tip).toBeVisible();
    fireEvent.focusOut(button);
    expect(tip).not.toBeVisible();

    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    fireEvent.focusIn(button);
    expect(tip).not.toBeVisible();
  });

  it('a touch never shows one', () => {
    const tip = setup(<button data-tip="Zoom in">+</button>);
    fireEvent.pointerOver(screen.getByRole('button'), { pointerType: 'touch' });
    vi.advanceTimersByTime(SHOW_DELAY_MS * 2);
    expect(tip).not.toBeVisible();
  });

  it('a pointer down or a scroll hides it', () => {
    const tip = setup(<button data-tip="Zoom in">+</button>);
    const button = screen.getByRole('button');
    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toBeVisible();
    fireEvent.pointerDown(button, { pointerType: 'mouse' });
    expect(tip).not.toBeVisible();

    // Moving the pointer away and back brings it again.
    fireEvent.pointerOver(document.body, { pointerType: 'mouse' });
    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toBeVisible();
    fireEvent.scroll(document.body);
    expect(tip).not.toBeVisible();
  });

  it('stays inside the window: clamped to the sides, above a control at the bottom', () => {
    const tip = setup(
      <>
        <button data-tip="Right">r</button>
        <button data-tip="Bottom">b</button>
        <button data-tip="Left">l</button>
      </>,
    );
    const [right, bottom, left] = screen.getAllByRole('button');
    if (right === undefined || bottom === undefined || left === undefined) throw new Error();
    at(right, 760, 10, 40, 20);
    at(bottom, 300, 580, 40, 20);
    at(left, 0, 10, 20, 20);

    fireEvent.pointerOver(right, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip.style.translate).toBe(`${VIEW.width - 8 - TIP.width}px 36px`);

    fireEvent.pointerOut(right, { relatedTarget: bottom });
    fireEvent.pointerOver(bottom, { pointerType: 'mouse' });
    expect(tip.style.translate).toBe(`270px ${580 - 6 - TIP.height}px`);

    fireEvent.pointerOut(bottom, { relatedTarget: left });
    fireEvent.pointerOver(left, { pointerType: 'mouse' });
    expect(tip.style.translate).toBe('8px 36px');
  });

  it('follows the pointer for a canvas view, at once, and flips at the edges', () => {
    const tip = setup(<canvas />);
    followTooltip('R240S · CGT→AGT · bla', 100, 100);
    expect(tip).toBeVisible();
    expect(tip).toHaveTextContent('R240S · CGT→AGT · bla');
    expect(tip.style.translate).toBe('114px 118px');

    followTooltip('R240S · CGT→AGT · bla', 750, 590);
    expect(tip.style.translate).toBe(`${750 - 14 - TIP.width}px ${590 - 18 - TIP.height}px`);

    hideFollowTooltip();
    expect(tip).not.toBeVisible();
  });

  it('a scroll hides a following tip until the view moves it again', () => {
    const tip = setup(<canvas />);
    followTooltip('A1', 100, 100);
    fireEvent.scroll(document.body);
    expect(tip).not.toBeVisible();
    followTooltip('A1', 100, 110);
    expect(tip).toBeVisible();
  });

  it('keeps a description the control already had', () => {
    const tip = setup(
      <>
        <button data-tip="Zoom in" aria-describedby="note">
          +
        </button>
        <p id="note">A note</p>
      </>,
    );
    const button = screen.getByRole('button');
    fireEvent.pointerOver(button, { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).toBeVisible();
    expect(button).toHaveAttribute('aria-describedby', `note ${TOOLTIP_ID}`);
    fireEvent.pointerOut(button, { relatedTarget: document.body });
    expect(button).toHaveAttribute('aria-describedby', 'note');
  });

  it('an empty tip is no tip', () => {
    const tip = setup(<button data-tip="">+</button>);
    fireEvent.pointerOver(screen.getByRole('button'), { pointerType: 'mouse' });
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(tip).not.toBeVisible();
  });
});
