/**
 * Opening the guide from somewhere other than the "?" button.
 *
 * The dialog belongs to `HelpButton`, which is in the toolbar; a notice
 * elsewhere on the screen that wants to point at a page should not have to
 * be wired through the store for it. An event on the window is enough: there
 * is one help button, and nothing else needs to know.
 */

const EVENT = 'plasmidpop:open-guide';

/** Opens the guide at `pageId` (a file stem, as in `docs/guide`). */
export function openGuide(pageId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: pageId }));
}

/** Listens for `openGuide`; returns the unsubscribe function. */
export function onOpenGuide(handle: (pageId: string) => void): () => void {
  const listener = (e: Event): void => {
    const { detail } = e as CustomEvent<unknown>;
    if (typeof detail === 'string') handle(detail);
  };
  window.addEventListener(EVENT, listener);
  return () => {
    window.removeEventListener(EVENT, listener);
  };
}
