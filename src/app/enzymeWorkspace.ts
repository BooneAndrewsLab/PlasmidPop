import { createWorkspaceController } from './workspaceController';

/**
 * The Enzyme workspace's pages (item 133): the list, the digest of what is
 * ticked with its gel, the best double digests, and the table in use with
 * the ways to add to it.
 */
export type EnzymePage = 'enzymes' | 'digest' | 'pairs' | 'table';

export const ENZYME_PAGES: readonly EnzymePage[] = ['enzymes', 'digest', 'pairs', 'table'];

export const enzymeWorkspace = createWorkspaceController<EnzymePage>(
  'enzymes',
  ENZYME_PAGES,
  'enzymes',
);

export const recallEnzymePage = enzymeWorkspace.recallPage;
export const rememberEnzymePage = enzymeWorkspace.rememberPage;
export const openEnzymeWorkspace = enzymeWorkspace.open;
export const closeEnzymeWorkspace = enzymeWorkspace.close;
export const takeEnzymeFocusRequest = enzymeWorkspace.takeFocusRequest;
