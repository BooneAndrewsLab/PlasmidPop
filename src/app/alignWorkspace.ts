import { createWorkspaceController } from './workspaceController';

/**
 * The Align workspace's pages (item 129, #354): the input with its options,
 * the results of an alignment or a batch, the reads assembled with no
 * reference, and the multiple alignment.
 */
export type AlignPage = 'align' | 'results' | 'assemble' | 'multiple';

export const ALIGN_PAGES: readonly AlignPage[] = ['align', 'results', 'assemble', 'multiple'];

export const alignWorkspace = createWorkspaceController<AlignPage>('align', ALIGN_PAGES, 'align');

export const recallAlignPage = alignWorkspace.recallPage;
export const rememberAlignPage = alignWorkspace.rememberPage;
export const openAlignWorkspace = alignWorkspace.open;
export const closeAlignWorkspace = alignWorkspace.close;
export const takeAlignFocusRequest = alignWorkspace.takeFocusRequest;
