import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * State for a dropdown menu anchored to a trigger inside `ref`: open/closed,
 * closed again by a click outside the anchor or by Escape.
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

  const toggle = useCallback((): void => {
    setOpen((v) => !v);
  }, []);
  const close = useCallback((): void => {
    setOpen(false);
  }, []);

  return { open, setOpen, toggle, close, ref };
}
