import { analytics } from './analytics';
import { editorStore } from './state/editorStore';
import { recallPanel, rememberPanel } from './state/panelMemory';

/**
 * The Align workspace's pages (item 129, #354): the input with its options,
 * the results of an alignment or a batch, the reads assembled with no
 * reference, and the multiple alignment.
 */
export type AlignPage = 'align' | 'results' | 'assemble' | 'multiple';

export const ALIGN_PAGES: readonly AlignPage[] = ['align', 'results', 'assemble', 'multiple'];

const SLOT = 'align.workspace';

export function recallAlignPage(documentId: string | null): AlignPage {
  return recallPanel<AlignPage>(SLOT, documentId, 'align');
}

export function rememberAlignPage(documentId: string | null, page: AlignPage): void {
  rememberPanel(SLOT, documentId, page);
}

/**
 * Opens the workspace on the document in front, on `page` (or the page it
 * was last on). The store puts the sidebar on Align; the page is the
 * panels' own memory, as the primer workspace's is (item 107).
 */
export function openAlignWorkspace(documentId: string | null, page?: AlignPage): void {
  if (page !== undefined) rememberAlignPage(documentId, page);
  analytics.trackOnce('panel', 'open', 'align-workspace');
  editorStore.setWorkspace('align');
}

/**
 * Where the keyboard goes when the workspace shuts (item 107, point 1):
 * back to the slim panel's "Options and more", which mounts only after the
 * shut, so the panel asks here on its first render.
 */
let focusWanted = false;

/** Shuts the workspace; with `returnFocus`, the slim panel takes the keyboard. */
export function closeAlignWorkspace(returnFocus = false): void {
  focusWanted = returnFocus;
  if (editorStore.getState().workspace === 'align') editorStore.setWorkspace(null);
}

/** Whether the slim panel should take the keyboard now; asking clears it. */
export function takeAlignFocusRequest(): boolean {
  const wanted = focusWanted;
  focusWanted = false;
  return wanted;
}
