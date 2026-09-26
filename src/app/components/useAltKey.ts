import { useEffect, useRef } from 'react';

import { isAltBlocked } from '../keys';
import { formatBinding, matchesBinding, resolveBindings, withShift } from '../keyBindings';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * Runs `action` on the key bound to `actionId` (#79), for a binding that
 * belongs to a component — one that opens its menu or its file picker —
 * rather than to `useViewShortcuts`. The same rules hold as there: nothing
 * while a text field has the key or a modal is up (item 32).
 */
export function useAltKey(actionId: string, action: (() => void) | null): void {
  const { keyBindings } = useEditorState();
  const binding = resolveBindings(keyBindings).get(actionId);
  const latest = useRef(action);
  useEffect(() => {
    latest.current = action;
  });
  const enabled = action !== null && binding !== undefined;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!matchesBinding(e, binding) || isAltBlocked(e.target)) return;
      const { saveReview, comparison, keysDialog } = editorStore.getState();
      if (saveReview !== null || comparison !== null || keysDialog) return;
      e.preventDefault();
      latest.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [binding, enabled]);
}

/**
 * What a binding is called in a tooltip: "Alt+O". With `shift`, the same
 * binding held with Shift, which is how a pair that goes forwards and back
 * is written ("Alt+Shift+N").
 */
export function useBindingLabel(actionId: string, shift = false): string {
  const { keyBindings } = useEditorState();
  const binding = resolveBindings(keyBindings).get(actionId);
  if (binding === undefined) return '';
  return formatBinding(shift ? withShift(binding) : binding);
}
