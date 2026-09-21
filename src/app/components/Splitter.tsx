import {
  type PointerEvent as ReactPointerEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from 'react';

/** Thickness of the handle: the grid track the splitter takes between two panes. */
export const SPLITTER_SIZE = 6;

const ARROW_STEP = 16;
const PAGE_STEP = 64;

export interface SplitterProps {
  /** Which axis the handle moves along: 'x' divides two columns, 'y' two rows. */
  readonly axis: 'x' | 'y';
  readonly label: string;
  /** Px the pane before the handle must keep. */
  readonly minBefore: number;
  /** Px the pane after it must keep. */
  readonly minAfter: number;
  /**
   * The size the pane before the handle should take and the room the two
   * panes share (the container less the handle), both in px and already
   * held to the floors. The caller turns that into whatever it stores.
   */
  readonly onMove: (before: number, extent: number) => void;
  /** Double-click: put the boundary back where it started. */
  readonly onReset: () => void;
  /** Where the boundary is, for a screen reader; units are the caller's. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly valueText: string;
}

interface Measurement {
  /** The container's start edge in client coordinates. */
  readonly start: number;
  /** Room the two panes share: the container less the handle. */
  readonly extent: number;
  /** Size of the pane before the handle. */
  readonly before: number;
}

/**
 * Reads the geometry off the DOM rather than keeping a copy of it: the
 * container is the handle's own grid parent, and its size is whatever the
 * window has just made it. Nothing has to be told the panes changed size —
 * both views already re-measure themselves.
 */
function measure(handle: HTMLElement, axis: 'x' | 'y'): Measurement | null {
  const container = handle.parentElement;
  if (container === null) return null;
  const c = container.getBoundingClientRect();
  const h = handle.getBoundingClientRect();
  const start = axis === 'x' ? c.left : c.top;
  const size = axis === 'x' ? c.width : c.height;
  const handleSize = axis === 'x' ? h.width : h.height;
  return {
    start,
    extent: Math.max(0, size - handleSize),
    before: (axis === 'x' ? h.left : h.top) - start,
  };
}

/**
 * A draggable boundary between two panes of a grid. It is one grid item of
 * its own, so the panes stay plain children and the caller only has to give
 * the track a width.
 *
 * Built once and used twice, as item 28 asked: between the map and the
 * sequence in the Both view, and on the sidebar's inner edge.
 */
export function Splitter({
  axis,
  label,
  minBefore,
  minAfter,
  onMove,
  onReset,
  value,
  min,
  max,
  valueText,
}: SplitterProps) {
  const ref = useRef<HTMLDivElement>(null);
  /** Where in the handle it was grabbed, so a drag does not jump on the first move. */
  const grab = useRef(0);
  /**
   * Whether a drag is under way. A ref rather than state: the first move can
   * arrive before React has re-rendered, and a boundary that ignores it
   * jumps when the second one lands. The state beside it is for the class.
   */
  const dragging = useRef(false);
  const [active, setActive] = useState(false);

  const emit = (before: number, extent: number): void => {
    // The upper bound is floored at minBefore so a container too small for
    // both floors gives the first pane its own rather than a negative size.
    const ceiling = Math.max(minBefore, extent - minAfter);
    onMove(Math.min(Math.max(before, minBefore), ceiling), extent);
  };

  const pointerAt = (e: ReactPointerEvent<HTMLDivElement>): number =>
    axis === 'x' ? e.clientX : e.clientY;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (el === null) return;
    const m = measure(el, axis);
    if (m === null) return;
    grab.current = pointerAt(e) - m.start - m.before;
    // Pointer capture, so a fast drag that outruns the handle keeps the grab.
    el.setPointerCapture(e.pointerId);
    dragging.current = true;
    setActive(true);
    e.preventDefault();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (el === null || !dragging.current) return;
    const m = measure(el, axis);
    if (m === null) return;
    emit(pointerAt(e) - m.start - grab.current, m.extent);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    setActive(false);
    const el = ref.current;
    if (el?.hasPointerCapture(e.pointerId) === true) el.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (el === null) return;
    const back = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    let delta: number | null = null;
    if (e.key === back) delta = -ARROW_STEP;
    else if (e.key === forward) delta = ARROW_STEP;
    else if (e.key === 'PageUp') delta = -PAGE_STEP;
    else if (e.key === 'PageDown') delta = PAGE_STEP;
    else if (e.key !== 'Home' && e.key !== 'End') return;
    const m = measure(el, axis);
    if (m === null) return;
    e.preventDefault();
    if (delta === null) emit(e.key === 'Home' ? 0 : m.extent, m.extent);
    else emit(m.before + delta, m.extent);
  };

  return (
    <div
      ref={ref}
      role="separator"
      tabIndex={0}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={Math.round(min)}
      aria-valuemax={Math.round(max)}
      aria-valuetext={valueText}
      className={`splitter splitter--${axis}${active ? ' splitter--dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  );
}
