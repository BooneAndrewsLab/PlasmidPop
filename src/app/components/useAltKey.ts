import { useEffect, useRef } from 'react';

import { isAltBlocked, isAltKey } from '../keys';
import { editorStore } from '../state/editorStore';

/**
 * Runs `action` on `Alt` and the key with this `code`, for a binding that
 * belongs to a component — one that opens its menu or its file picker —
 * rather than to `useViewShortcuts`. The same rules hold as there: nothing
 * while a text field has the key or a modal is up (item 32).
 */
export function useAltKey(code: string, action: (() => void) | null): void {
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });
  const enabled = action !== null;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!isAltKey(e, code) || isAltBlocked(e.target)) return;
      const { saveReview, comparison } = editorStore.getState();
      if (saveReview !== null || comparison !== null) return;
      e.preventDefault();
      latest.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [code, enabled]);
}
