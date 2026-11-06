import { createWorkspaceController } from './workspaceController';

/**
 * The CRISPR workspace's pages (item 133): the guide list, the paired
 * nickases, and prime editing.
 */
export type CrisprPage = 'guides' | 'pairs' | 'prime';

export const CRISPR_PAGES: readonly CrisprPage[] = ['guides', 'pairs', 'prime'];

export const crisprWorkspace = createWorkspaceController<CrisprPage>(
  'crispr',
  CRISPR_PAGES,
  'guides',
);

export const recallCrisprPage = crisprWorkspace.recallPage;
export const rememberCrisprPage = crisprWorkspace.rememberPage;
export const openCrisprWorkspace = crisprWorkspace.open;
export const closeCrisprWorkspace = crisprWorkspace.close;
export const takeCrisprFocusRequest = crisprWorkspace.takeFocusRequest;
