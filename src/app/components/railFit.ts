import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The height a tab takes besides its label: padding, icon, gap and border
 * (`.sidebar__tab`, `.sidebar__tab-icon` in styles.css).
 */
export const RAIL_TAB_CHROME = 37;

/**
 * Whether every label of the sidebar rail fits at full length in the height
 * the rail has (#292). The labels are measured, so the answer follows the
 * window, the font and the number of tabs rather than a fixed height.
 */
export function railLabelsFit(available: number, labelLengths: readonly number[]): boolean {
  if (available <= 0) return true; // not laid out (jsdom, a hidden tab): say nothing
  const needed = labelLengths.reduce((sum, length) => sum + length + RAIL_TAB_CHROME, 0);
  return needed <= available;
}

/**
 * Whether the rail's labels fit, kept up to date. The labels stay in the
 * layout (hidden, unclipped) when they are not shown, so they can still be
 * measured and the answer does not flip back and forth.
 */
export function useRailLabelsFit(
  rail: RefObject<HTMLElement | null>,
  enabled: boolean,
  tabCount: number,
): boolean {
  const [fit, setFit] = useState(true);
  useLayoutEffect(() => {
    const el = rail.current;
    if (!enabled || el === null || typeof ResizeObserver === 'undefined') return;
    const labels = Array.from(el.querySelectorAll<HTMLElement>('.sidebar__tab-label'));
    const measure = (): void => {
      setFit(
        railLabelsFit(
          el.clientHeight,
          labels.map((label) => label.scrollHeight),
        ),
      );
    };
    // Observing reports once at once, so the first measurement comes from
    // here; the labels are watched too, as a font arriving resizes them.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    for (const label of labels) observer.observe(label);
    return () => {
      observer.disconnect();
    };
  }, [rail, enabled, tabCount]);
  return !enabled || fit;
}
