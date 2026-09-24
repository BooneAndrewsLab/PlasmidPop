import { type MapViewport } from '@/view/circular';

/**
 * Where each tab's views were left (#33): the sequence view's scroll and the
 * map's zoom and pan. The editor is keyed by document, so a switch of tabs
 * starts the views afresh; this is what they come back to instead.
 *
 * Outside the store on purpose. It changes on every scroll event, and
 * nothing but the view that wrote it reads it, so going through the store
 * would re-render the app to tell nobody anything. It lasts for the page
 * load, like the tabs' selections: a reload opens every view at its start.
 */
export interface ViewMemory {
  /**
   * The first base of the row at the top of the sequence view. A base, not
   * pixels: the rows reflow when the window or the sidebar changes width,
   * and coming back to the same bases is what "where I was" means.
   */
  readonly topBase?: number;
  readonly scrollLeft?: number;
  readonly mapViewport?: MapViewport;
}

const memory = new Map<string, ViewMemory>();

export function recallView(documentId: string | null): ViewMemory {
  return documentId === null ? {} : (memory.get(documentId) ?? {});
}

export function rememberView(documentId: string | null, patch: ViewMemory): void {
  if (documentId === null) return;
  memory.set(documentId, { ...memory.get(documentId), ...patch });
}

/** Forgets every view, for tests. */
export function forgetViews(): void {
  memory.clear();
}
