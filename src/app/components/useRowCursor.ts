import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react';

import { nextRowIndex } from './tableKeys';

/**
 * The keyboard side of a `wst` table whose rows act on a click: one row in
 * the tab order (`cursor`), the arrow keys, `Home` and `End` moving focus
 * between rows, and a row that takes focus becoming the cursor. Rows carry
 * `data-row={index}` and `tabIndex`. Unlike the Enzymes table's, the cursor
 * is not a selection: moving it chooses nothing until `Enter`.
 *
 * With `scrollToIndex` (from `useRowWindow`), a key that moves to a row the
 * window has not drawn yet scrolls to it first and focuses it once it is.
 */
export function useRowCursor(count: number, scrollToIndex?: (index: number) => void) {
  const body = useRef<HTMLTableSectionElement>(null);
  const [held, setCursor] = useState(0);
  const want = useRef<number | null>(null);
  const cursor = Math.min(held, Math.max(0, count - 1));

  useLayoutEffect(() => {
    const index = want.current;
    if (index === null) return;
    const row = body.current?.querySelector<HTMLElement>(`tr[data-row="${index.toString()}"]`);
    if (row === null || row === undefined) return;
    want.current = null;
    row.focus();
  });

  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const from =
      e.target instanceof Element
        ? e.target.closest('tr[data-row]')?.getAttribute('data-row')
        : null;
    const to = nextRowIndex(
      e.key,
      from === null || from === undefined ? cursor : Number(from),
      count,
    );
    if (to === null) return;
    e.preventDefault();
    scrollToIndex?.(to);
    setCursor(to);
    want.current = to;
  };

  return { body, cursor, setCursor, onKeyDown };
}
