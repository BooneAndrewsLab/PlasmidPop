import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Least gap kept between an open menu and the window's edges, px. */
const EDGE = 8;

/**
 * State for a dropdown menu anchored to a trigger inside `ref`: open/closed,
 * closed again by a click outside the anchor or by Escape. An open list that
 * would run past the window's left or right edge is shifted back inside it,
 * and one too tall for the room below it scrolls: on a phone the File menu
 * ran past both and the browser scrolled the whole page to show it.
 */
export function useMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  useLayoutEffect(() => {
    const list = open ? ref.current?.querySelector<HTMLElement>('.menu__list') : null;
    if (list === null || list === undefined) return;
    list.style.translate = '';
    list.style.maxHeight = '';
    const { clientWidth: width, clientHeight: height } = document.documentElement;
    if (width === 0) return; // not laid out (jsdom)
    // Too tall for the room below (or above, for a list that opens up): it
    // scrolls inside itself instead of making the page scroll. Capped first,
    // as the scrollbar that brings can widen the list.
    const { top, bottom } = list.getBoundingClientRect();
    const room = list.classList.contains('menu__list--up') ? bottom - EDGE : height - EDGE - top;
    if (bottom - top > room) list.style.maxHeight = `${Math.max(room, 0)}px`;
    const { left, right } = list.getBoundingClientRect();
    const past = right - (width - EDGE);
    const shift = past > 0 ? -Math.min(past, left - EDGE) : left < EDGE ? EDGE - left : 0;
    if (shift !== 0) list.style.translate = `${shift}px 0`;
  }, [open]);

  const toggle = useCallback((): void => {
    setOpen((v) => !v);
  }, []);
  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  return { open, setOpen, toggle, close, ref };
}
