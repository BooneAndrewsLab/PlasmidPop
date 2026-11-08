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
  crispr: 'crispr-workspace',
  enzymes: 'enzyme-workspace',
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
   * page without the store knowing the pages. `fromTab` false opens it with
   * no tab to go back to (a document opened just for it).
   */
  readonly open: (documentId: string | null, page?: P, fromTab?: boolean) => void;
  /**
   * Shuts the workspace. With `returnFocus` (Escape, the close button), the
   * sidebar goes back to the tab that opened it, when it was not the
   * workspace's own (#404), and otherwise the slim panel takes the keyboard.
   */
  readonly close: (returnFocus?: boolean) => void;
  /**
   * Whether the slim panel should take the keyboard now; asking clears it.
   * The panel mounts only after the shut, so it asks on its first render
   * rather than the workspace reaching for a button that does not exist yet.
   */
  readonly takeFocusRequest: () => boolean;
  readonly recallPage: (documentId: string | null) => P;
  readonly rememberPage: (documentId: string | null, page: P) => void;
  /** The page in front, as state, remembered for the document. */
  readonly usePage: (documentId: string | null) => [P, (page: P) => void];
}

export function createWorkspaceController<P extends string>(
  kind: Workspace,
  pages: readonly P[],
  initial: P,
): WorkspaceController<P> {
  const slot = `${kind}.workspace`;
  let focusWanted = false;
  const recallPage = (documentId: string | null): P => recallPanel<P>(slot, documentId, initial);
  const rememberPage = (documentId: string | null, page: P): void => {
    rememberPanel(slot, documentId, page);
  };
  return {
    kind,
    pages,
    open(documentId, page, fromTab = true) {
      if (page !== undefined) rememberPage(documentId, page);
      analytics.trackOnce('panel', 'open', EVENT[kind]);
      editorStore.setWorkspace(kind, fromTab);
    },
    close(returnFocus = false) {
      focusWanted = returnFocus;
      if (editorStore.getState().workspace !== kind) return;
      // Back on another tab, its panel keeps the keyboard where it was.
      if (editorStore.closeWorkspace(returnFocus)) focusWanted = false;
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
      return [
        page,
        useCallback(
          (next: P) => {
            set(next);
          },
          [set],
        ),
      ];
    },
  };
}
