import { type Range, featureExtent } from '@/core';

import { analytics } from './analytics';
import { type NcbiFetched, geneFeature, openFetched } from './openFromNcbi';
import { editorStore } from './state/editorStore';
import { recallPanel, rememberPanel } from './state/panelMemory';

/**
 * The primer workspace's pages (item 107): a left rail of four, each with
 * its own heading, so where one ends and the next begins is plain.
 */
export type WorkspacePage = 'design' | 'results' | 'check' | 'mine';

export const WORKSPACE_PAGES: readonly WorkspacePage[] = ['design', 'results', 'check', 'mine'];

/**
 * Where the workspace is on screen (point 5): beside the live map (`split`,
 * 1000 px and wider), the whole main area under a foldable map strip
 * (`full`, 601 to 1000 px) or the whole screen with the rail across the top
 * (`phone`).
 */
export type WorkspaceLayout = 'split' | 'full' | 'phone';

/** What the slim Primers panel and the workspace remember between openings. */
export interface WorkspaceMemory {
  readonly page: WorkspacePage;
}

const SLOT = 'primers.workspace';
const INITIAL: WorkspaceMemory = { page: 'design' };

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

/**
 * The stretch the fetched gene itself covers in its record, flanks left
 * out: the `gene` feature NCBI annotated, which both the RefSeqGene and the
 * chromosome paths carry. Without one (a record with no annotation) the
 * whole record is the target, flanks and all.
 */
export function geneTarget(fetched: NcbiFetched): Range | null {
  const doc = fetched.documents[fetched.documents.length - 1];
  if (doc === undefined) return null;
  if (fetched.source.kind !== 'gene') return { start: 0, end: doc.length };
  const feature = geneFeature(doc, fetched.source.gene.symbol);
  const extent = feature === null ? null : featureExtent(feature);
  return extent ?? { start: 0, end: doc.length };
}

/**
 * "Gene from NCBI…" on the Design page (item 107, #299): the fetched gene
 * opens as a document of its own — a design needs a template, and the
 * flanks are where the primers may lie — and the workspace follows it
 * there with the gene selected as the target. So one tab, open on Design,
 * with the band already on the map: the least surprising reading of
 * "design primers for this gene".
 */
export function designForFetchedGene(fetched: NcbiFetched): void {
  const target = geneTarget(fetched);
  const ids = openFetched(fetched);
  const id = ids[ids.length - 1];
  if (id === undefined) return;
  rememberWorkspacePage(id, 'design');
  if (target !== null) {
    editorStore.setSelection(target);
    editorStore.revealPosition(target.start);
  }
  editorStore.setPrimerWorkspace(true);
}
