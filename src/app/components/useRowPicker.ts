import { type KeyboardEvent, useEffect, useLayoutEffect, useRef } from 'react';

import { nextRowIndex } from './tableKeys';
import { useRowWindow } from './useRowWindow';

/**
 * The keyboard and the window of a `wst` table whose rows are *chosen*, as
 * the Guides table's are (item 133, C5): the arrow keys, `Home` and `End`
 * choose the next row and move focus to it, `Enter` chooses the focused one
 * (or puts it away again if it is the open one), `Escape` puts the open row
 * away, and the one row in the tab order is the open row, else the first.
 * Rows carry `data-row={key}`, `tabIndex={stop === key ? 0 : -1}` and
 * `aria-selected`, and `attachRow(key)` on their `tr`.
 *
 * Windowed with `useRowWindow`: a key that lands on a row not drawn yet
 * scrolls to it first and focuses it once it is, and a row opened elsewhere
 * (a click on the map) is scrolled to once.
 */
export function useRowPicker(
  keys: readonly string[],
  openKey: string | null,
  estimate: number,
  choose: (index: number) => void,
  clear: () => void,
) {
  const win = useRowWindow(keys, estimate);
  const { scrollToTop, scrollToIndex } = win;
  // A new list is a new list: the old scroll position means nothing in it.
  useEffect(() => {
    scrollToTop();
  }, [keys, scrollToTop]);

  // A row opened elsewhere is brought into view here, once: scrolling away
  // from it afterwards is the reader's.
  const scrolledTo = useRef<string | null>(null);
  useEffect(() => {
    if (openKey === null) {
      scrolledTo.current = null;
      return;
    }
    if (scrolledTo.current === openKey) return;
    scrolledTo.current = openKey;
    const at = keys.indexOf(openKey);
    if (at >= 0) scrollToIndex(at);
  });

  // A key that moves to a row not drawn yet leaves its focus until it is.
  const body = useRef<HTMLTableSectionElement>(null);
  const focusKey = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focusKey.current;
    if (key === null) return;
    const row = [...(body.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? [])].find(
      (r) => r.getAttribute('data-row') === key,
    );
    if (row === undefined) return;
    focusKey.current = null;
    row.focus();
  });

  const openIndex = openKey === null ? -1 : keys.indexOf(openKey);
  const stop = openIndex >= 0 ? openKey : (keys[0] ?? null);
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Escape puts the row away first; the workspace shuts on the next one.
    if (e.key === 'Escape') {
      if (openIndex < 0) return;
      e.preventDefault();
      clear();
      return;
    }
    const from =
      e.target instanceof Element
        ? e.target.closest('tr[data-row]')?.getAttribute('data-row')
        : null;
    const at = keys.indexOf(from ?? openKey ?? '');
    if (e.key === 'Enter') {
      // On the row itself: a button inside it has its own Enter.
      if (at < 0 || !(e.target instanceof Element) || e.target.closest('button, input') !== null) {
        return;
      }
      e.preventDefault();
      if (at === openIndex) clear();
      else choose(at);
      return;
    }
    const to = nextRowIndex(e.key, at < 0 ? null : at, keys.length);
    if (to === null) return;
    e.preventDefault();
    scrollToIndex(to);
    choose(to);
    focusKey.current = keys[to] ?? null;
  };

  return { ...win, body, stop, onKeyDown };
}
