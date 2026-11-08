import { recallPanel, rememberPanel } from './state/panelMemory';
import { createWorkspaceController } from './workspaceController';

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

export const primerWorkspace = createWorkspaceController<WorkspacePage>(
  'primers',
  WORKSPACE_PAGES,
  'design',
);

/** The Design page's mode has a slot of its own; the page is the controller's. */
const MODE_SLOT = 'primers.mode';

export function recallDesignMode(documentId: string | null): DesignMode {
  return recallPanel<DesignMode>(MODE_SLOT, documentId, 'plain');
}

/** Page and mode together, as the slim panel and the tests ask for them. */
export function recallWorkspace(documentId: string | null): WorkspaceMemory {
  return { page: primerWorkspace.recallPage(documentId), mode: recallDesignMode(documentId) };
}

/**
 * Opens the workspace, on `page` and, when given, the Design page's `mode`
 * (the Cloning tab's "Clone an insert into this plasmid ›" lands on Design
 * in cloning mode). Escape goes back to the tab that opened it (#404)
 * unless `fromTab` is false.
 */
export function openPrimerWorkspace(
  documentId: string | null,
  page?: WorkspacePage,
  mode?: DesignMode,
  fromTab = true,
): void {
  if (mode !== undefined) rememberPanel(MODE_SLOT, documentId, mode);
  primerWorkspace.open(documentId, page, fromTab);
}

export const rememberWorkspacePage = primerWorkspace.rememberPage;
export const closePrimerWorkspace = primerWorkspace.close;
export const takeFocusRequest = primerWorkspace.takeFocusRequest;
