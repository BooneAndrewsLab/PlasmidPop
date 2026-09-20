import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Rendering only the rows of a long list that are on screen.
 *
 * The Enzymes tab is the list that needs it: an imported REBASE table has
 * around 1,500 enzymes and most of them cut a plasmid somewhere, and putting
 * every row in the DOM locks the page up for seconds. Rows are not all the
 * same height — a row's cut positions wrap onto as many lines as they need —
 * so heights are measured as rows are rendered and remembered by key; a row
 * never yet seen counts as `estimate` tall, which is only ever used for rows
 * below the viewport, where being a few pixels out moves nothing the user
 * can see.
 */
export interface RowWindow {
  /** Index of the first row to render. */
  readonly first: number;
  /** Index one past the last row to render. */
  readonly end: number;
  /** Height of the rows skipped above and below, as padding on the list. */
  readonly padTop: number;
  readonly padBottom: number;
  /** Ref for the scrolling element that holds the list. */
  readonly attachScroller: (node: HTMLElement | null) => void;
  /** Ref for a rendered row, which measures it. */
  readonly attachRow: (key: string) => (node: HTMLElement | null) => void;
  /** Puts the scroll back to the top, for when the list itself changed. */
  readonly scrollToTop: () => void;
}

/**
 * How far beyond the viewport rows are kept, in pixels, either side.
 *
 * The scroll position reaches React a frame or so after the browser has
 * already painted the new one, so a window that ends at the viewport's edge
 * shows a band of nothing while it catches up. A screenful of slack on each
 * side covers any ordinary wheel or trackpad scroll; rows are cheap, and this
 * is still a few dozen of them rather than a few thousand.
 */
const OVERSCAN_PX = 600;

/**
 * Viewport used before the scrolling element has been measured, in pixels.
 * Only the first paint (and a test with no layout) sees it.
 */
const ASSUMED_VIEWPORT = 600;

export function useRowWindow(keys: readonly string[], estimate: number): RowWindow {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [scroll, setScroll] = useState({ top: 0, viewport: 0 });
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());

  // The node is kept twice over: as state, so the effect below re-runs when
  // the list appears, and in a ref, so scrolling it needs no fresh callback.
  const node = useRef<HTMLElement | null>(null);
  const attachScroller = useCallback((next: HTMLElement | null) => {
    node.current = next;
    setEl(next);
  }, []);

  useLayoutEffect(() => {
    if (el === null) return;
    const update = (): void => {
      setScroll((prev) =>
        prev.top === el.scrollTop && prev.viewport === el.clientHeight
          ? prev
          : { top: el.scrollTop, viewport: el.clientHeight },
      );
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      observer?.disconnect();
    };
  }, [el]);

  const attachRow = useCallback(
    (key: string) => (row: HTMLElement | null) => {
      if (row === null) return;
      const height = row.offsetHeight;
      if (height <= 0) return;
      setHeights((prev) => {
        if (prev.get(key) === height) return prev;
        const next = new Map(prev);
        next.set(key, height);
        return next;
      });
    },
    [],
  );

  const scrollToTop = useCallback(() => {
    const current = node.current;
    if (current !== null) current.scrollTop = 0;
  }, []);

  // Where each row starts, and where the last one ends. O(n) per render, which
  // at a few thousand rows is far less than rendering one of them.
  const offsets = new Array<number>(keys.length + 1);
  let acc = 0;
  for (let i = 0; i < keys.length; i++) {
    offsets[i] = acc;
    acc += heights.get(keys[i] ?? '') ?? estimate;
  }
  offsets[keys.length] = acc;

  const viewport = scroll.viewport > 0 ? scroll.viewport : ASSUMED_VIEWPORT;
  // The scroll position can outrun the list when a filter shortens it; the
  // browser clamps its own scrollTop and tells us, but not before this render.
  const top = Math.max(0, Math.min(scroll.top, acc - viewport));

  const first = binarySearch(offsets, top - OVERSCAN_PX);
  let end = first;
  while (end < keys.length && (offsets[end] ?? 0) < top + viewport + OVERSCAN_PX) end++;

  return {
    first,
    end,
    padTop: offsets[first] ?? 0,
    padBottom: acc - (offsets[end] ?? acc),
    attachScroller,
    attachRow,
    scrollToTop,
  };
}

/** The last index whose offset is at or before `target`. */
function binarySearch(offsets: readonly number[], target: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
