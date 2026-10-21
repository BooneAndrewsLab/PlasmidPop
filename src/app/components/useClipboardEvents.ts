import { type RefObject, useEffect, useRef } from 'react';

export interface ClipboardHandlers {
  copy: (e: ClipboardEvent) => void;
  cut: (e: ClipboardEvent) => void;
  paste: (e: ClipboardEvent) => void;
}

function isField(node: unknown): boolean {
  return (
    node instanceof HTMLInputElement ||
    node instanceof HTMLTextAreaElement ||
    (node instanceof HTMLElement && node.isContentEditable)
  );
}

/**
 * Copy, cut and paste for a focusable element that is not editable, such
 * as the sequence view's `div[tabIndex=0]` (#267).
 *
 * Chrome sends a clipboard event to the focused element, editable or not.
 * Firefox does not: with no editable element focused it sends the event to
 * the node holding the page's text selection, or to `<body>`, so an
 * `onPaste` on the element never runs there. Listening on the document
 * catches the event wherever it lands; it is ours when it lands inside the
 * element (Chrome) or when the element has the focus (Firefox), and never
 * when a text field takes it.
 */
export function useClipboardEvents(
  ref: RefObject<HTMLElement | null>,
  handlers: ClipboardHandlers,
): void {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    const route =
      (kind: keyof ClipboardHandlers) =>
      (e: ClipboardEvent): void => {
        const el = ref.current;
        if (el === null || e.defaultPrevented || isField(e.target)) return;
        const target = e.target instanceof Node ? e.target : null;
        const active = document.activeElement;
        const ours =
          (target !== null && el.contains(target)) || (active !== null && el.contains(active));
        if (!ours || isField(active)) return;
        latest.current[kind](e);
      };
    const copy = route('copy');
    const cut = route('cut');
    const paste = route('paste');
    document.addEventListener('copy', copy);
    document.addEventListener('cut', cut);
    document.addEventListener('paste', paste);
    return () => {
      document.removeEventListener('copy', copy);
      document.removeEventListener('cut', cut);
      document.removeEventListener('paste', paste);
    };
  }, [ref]);
}
