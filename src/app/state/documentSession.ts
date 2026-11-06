import { useSyncExternalStore } from 'react';

/*
 * A per-document store outside React: a map of session objects by document
 * id, with listeners and `useSyncExternalStore` over it (item 129, shared
 * since item 133). A panel's state lives here, rather than in component
 * state or the panel memory (`panelMemory.ts`), when a worker result can land
 * after the panel that asked has unmounted: a React setter of an unmounted
 * component writes nothing, and this store takes the write wherever the
 * panel is. `alignSession.ts` and `crisprSession.ts` are instances.
 */

export interface DocumentSession<T> {
  /** The document's session, or the initial one before anything was written. */
  read: (documentId: string | null) => T;
  update: (documentId: string | null, patch: Partial<T> | ((s: T) => Partial<T>)) => void;
  /** The session of the document in front, live. */
  use: (documentId: string | null) => T;
  /** Forgets every session, for tests. */
  forget: () => void;
}

function keyOf(documentId: string | null): string {
  return documentId ?? '';
}

export function createDocumentSession<T>(initial: T): DocumentSession<T> {
  const sessions = new Map<string, T>();
  const listeners = new Set<() => void>();

  const read = (documentId: string | null): T => sessions.get(keyOf(documentId)) ?? initial;

  return {
    read,
    update(documentId, patch) {
      const key = keyOf(documentId);
      const current = sessions.get(key) ?? initial;
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      sessions.set(key, next);
      for (const l of listeners) l();
    },
    use(documentId) {
      return useSyncExternalStore(
        (l) => {
          listeners.add(l);
          return () => {
            listeners.delete(l);
          };
        },
        () => read(documentId),
        () => read(documentId),
      );
    },
    forget() {
      sessions.clear();
      for (const l of listeners) l();
    },
  };
}
