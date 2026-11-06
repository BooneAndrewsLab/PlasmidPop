import { useCallback } from 'react';

import { analytics } from './analytics';
import { type Workspace, editorStore } from './state/editorStore';
import { recallPanel, rememberPanel, useRemembered } from './state/panelMemory';

/**
 * Where a workspace is on screen (point 5): beside the live map (`split`,
 * 1000 px and wider), the whole main area under a foldable map strip
 * (`full`, 601 to 1000 px) or the whole screen with the rail across the top
 * (`phone`).
 */
export type WorkspaceLayout = 'split' | 'full' | 'phone';

/** What a workspace's analytics event calls it (item 38's catalogue). */
const EVENT: Readonly<Record<Workspace, string>> = {
  primers: 'primer-workspace',
  align: 'align-workspace',
};

/**
 * What every workspace does the same (items 107 and 129): open on the
 * document in front, on a page; shut, handing the keyboard back to the slim
 * panel; and remember which page it was left on, per document.
 */
export interface WorkspaceController<P extends string> {
  readonly kind: Workspace;
  readonly pages: readonly P[];
  /**
   * Opens the workspace on the document in front, on `page` (or the page it
   * was last on). The store puts the sidebar on the workspace's tab; the
   * page is the panels' own memory, so a slim panel's links can land on a
   * page without the store knowing the pages.
   */
  open(documentId: string | null, page?: P): void;
  /** Shuts the workspace; with `returnFocus`, the slim panel takes the keyboard. */
  close(returnFocus?: boolean): void;
  /**
   * Whether the slim panel should take the keyboard now; asking clears it.
   * The panel mounts only after the shut, so it asks on its first render
   * rather than the workspace reaching for a button that does not exist yet.
   */
  takeFocusRequest(): boolean;
  recallPage(documentId: string | null): P;
  rememberPage(documentId: string | null, page: P): void;
  /** The page in front, as state, remembered for the document. */
  usePage(documentId: string | null): [P, (page: P) => void];
}

export function createWorkspaceController<P extends string>(
  kind: Workspace,
  pages: readonly P[],
  initial: P,
): WorkspaceController<P> {
  const slot = `${kind}.workspace`;
  let focusWanted = false;
  const recallPage = (documentId: string | null): P => recallPanel<P>(slot, documentId, initial);
  const rememberPage = (documentId: string | null, page: P): void =>
    rememberPanel(slot, documentId, page);
  return {
    kind,
    pages,
    open(documentId, page) {
      if (page !== undefined) rememberPage(documentId, page);
      analytics.trackOnce('panel', 'open', EVENT[kind]);
      editorStore.setWorkspace(kind);
    },
    close(returnFocus = false) {
      focusWanted = returnFocus;
      if (editorStore.getState().workspace === kind) editorStore.setWorkspace(null);
    },
    takeFocusRequest() {
      const wanted = focusWanted;
      focusWanted = false;
      return wanted;
    },
    recallPage,
    rememberPage,
    usePage(documentId) {
      const [page, set] = useRemembered<P>(slot, documentId, initial);
      return [page, useCallback((next: P) => set(next), [set])];
    },
  };
}
