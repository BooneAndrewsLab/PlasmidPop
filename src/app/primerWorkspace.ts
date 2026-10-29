import { analytics } from './analytics';
import { editorStore } from './state/editorStore';
import { recallPanel, rememberPanel } from './state/panelMemory';

/**
 * The primer workspace's pages (item 107): a left rail of five, each with
 * its own heading, so where one ends and the next begins is plain. `clone`
 * is the clone check (item 120): primers to screen a colony by PCR.
 */
export type WorkspacePage = 'design' | 'results' | 'check' | 'clone' | 'mine';

export const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  'design',
  'results',
  'check',
  'clone',
  'mine',
];

/**
 * Where the workspace is on screen (point 5): beside the live map (`split`,
 * 1000 px and wider), the whole main area under a foldable map strip
 * (`full`, 601 to 1000 px) or the whole screen with the rail across the top
 * (`phone`).
 */
export type WorkspaceLayout = 'split' | 'full' | 'phone';

/**
 * The Design page's mode (#303, item 108): primers on the document in
 * front, or an insert from another tab cloned into it with restriction
 * ends. Results shows whichever table the last design made.
 */
export type DesignMode = 'plain' | 'cloning';

/** What the slim Primers panel and the workspace remember between openings. */
export interface WorkspaceMemory {
  readonly page: WorkspacePage;
  readonly mode: DesignMode;
}

const SLOT = 'primers.workspace';
const INITIAL: WorkspaceMemory = { page: 'design', mode: 'plain' };

export function recallWorkspace(documentId: string | null): WorkspaceMemory {
  return recallPanel(SLOT, documentId, INITIAL);
}

/**
 * Opens the workspace on the document in front, on `page` (or the page it
 * was last on). The store puts the sidebar on Primers; the page is the
 * panels' own memory, so the slim panel's "Last design" and "My primers…"
 * can land on Results and My primers without the store knowing the pages.
 */
export function openPrimerWorkspace(documentId: string | null, page?: WorkspacePage): void {
  if (page !== undefined) rememberPanel(SLOT, documentId, { ...recallWorkspace(documentId), page });
  analytics.trackOnce('panel', 'open', 'primer-workspace');
  editorStore.setPrimerWorkspace(true);
}

export function rememberWorkspacePage(documentId: string | null, page: WorkspacePage): void {
  rememberPanel(SLOT, documentId, { ...recallWorkspace(documentId), page });
}

/**
 * Where the keyboard goes when the workspace shuts (item 107, point 1):
 * back to the slim panel's "Design primers…", which mounts only after the
 * shut, so the panel asks here on its first render rather than the
 * workspace reaching for a button that does not exist yet.
 */
let focusWanted = false;

/** Shuts the workspace; with `returnFocus`, the slim panel takes the keyboard. */
export function closePrimerWorkspace(returnFocus = false): void {
  focusWanted = returnFocus;
  editorStore.setPrimerWorkspace(false);
}

/** Whether the slim panel should take the keyboard now; asking clears it. */
export function takeFocusRequest(): boolean {
  const wanted = focusWanted;
  focusWanted = false;
  return wanted;
}
