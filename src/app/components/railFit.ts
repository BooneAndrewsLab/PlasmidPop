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
export function useRailLabelsFit(rail: RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [fit, setFit] = useState(true);
  useLayoutEffect(() => {
    const el = rail.current;
    if (!enabled || el === null) {
      setFit(true);
      return;
    }
    const measure = (): void => {
      const lengths = Array.from(el.querySelectorAll<HTMLElement>('.sidebar__tab-label')).map(
        (label) => label.scrollHeight,
      );
      setFit(railLabelsFit(el.clientHeight, lengths));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  });
  return fit;
}
