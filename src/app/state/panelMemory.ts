import { useCallback, useState } from 'react';

/**
 * What a sidebar panel was left at, per document, for the page load (#32):
 * the primers typed into PCR, the pairs Primers designed and the one shown,
 * the change Mutate was given. A panel is unmounted when another sidebar tab
 * is picked, or another of the Cloning tab's three, and with `useState` all
 * of that went with it — and so did any preview drawn from it, which is how
 * the loss was noticed. Kept by document, because the sidebar outlives a
 * switch of document tabs and a design for one molecule means nothing on
 * the next.
 *
 * Outside the store, like the views' `viewMemory`: nothing but the panel
 * that wrote a value reads it, and it would be no use across a reload,
 * which rebuilds the documents it refers to.
 */
const memory = new Map<string, unknown>();

function keyOf(slot: string, documentId: string | null): string {
  return `${documentId ?? ''}\u0000${slot}`;
}

/**
 * `useState`, remembered under `slot` for the document in front: the value
 * comes back when the panel is shown again, and follows the panel to
 * another document's value when the front document changes.
 */
export function useRemembered<T>(
  slot: string,
  documentId: string | null,
  initial: T,
): [T, (next: T | ((previous: T) => T)) => void] {
  const key = keyOf(slot, documentId);
  const read = (): T => (memory.has(key) ? (memory.get(key) as T) : initial);
  const [held, setHeld] = useState(() => ({ key, value: read() }));
  // Another document came to the front: show its value, not this one's.
  let current = held;
  if (held.key !== key) {
    current = { key, value: read() };
    setHeld(current);
  }
  const set = useCallback((next: T | ((previous: T) => T)): void => {
    setHeld((h) => {
      const value = typeof next === 'function' ? (next as (previous: T) => T)(h.value) : next;
      memory.set(h.key, value);
      return { key: h.key, value };
    });
  }, []);
  return [current.value, set];
}

/**
 * Sets what a panel will find under `slot` for a document the next time it
 * is shown, from outside it: how the Primers tab hands a primer of the
 * collection to PCR (#64), whose panel is not mounted while Primers is.
 */
export function rememberPanel(slot: string, documentId: string | null, value: unknown): void {
  memory.set(keyOf(slot, documentId), value);
}

/** What a panel was left at under `slot`, or `initial` when nothing was. */
export function recallPanel<T>(slot: string, documentId: string | null, initial: T): T {
  const key = keyOf(slot, documentId);
  return memory.has(key) ? (memory.get(key) as T) : initial;
}

/** Forgets every panel's values, for tests. */
export function forgetPanels(): void {
  memory.clear();
}
