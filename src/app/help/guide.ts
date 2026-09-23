import align from '../../../docs/guide/11-align.md?raw';
import cloning from '../../../docs/guide/12-cloning.md?raw';
import editing from '../../../docs/guide/04-editing.md?raw';
import enzymes from '../../../docs/guide/07-enzymes.md?raw';
import features from '../../../docs/guide/05-features.md?raw';
import files from '../../../docs/guide/02-files.md?raw';
import find from '../../../docs/guide/06-find.md?raw';
import gettingStarted from '../../../docs/guide/01-getting-started.md?raw';
import history from '../../../docs/guide/13-history.md?raw';
import orfs from '../../../docs/guide/08-orfs.md?raw';
import primers from '../../../docs/guide/10-primers.md?raw';
import reads from '../../../docs/guide/15-reads.md?raw';
import shortcuts from '../../../docs/guide/14-shortcuts.md?raw';
import translate from '../../../docs/guide/09-translate.md?raw';
import viewing from '../../../docs/guide/03-viewing.md?raw';

import { markdownTitle } from './markdown';

export interface GuidePage {
  /** File stem, which is also what links between pages use. */
  readonly id: string;
  readonly title: string;
  readonly markdown: string;
}

function page(id: string, markdown: string): GuidePage {
  return { id, title: markdownTitle(markdown) ?? id, markdown };
}

/**
 * The user guide, in reading order. The pages live in `docs/guide` so they
 * read on GitHub as well; this module is the app's view of them.
 */
export const GUIDE: readonly GuidePage[] = [
  page('01-getting-started', gettingStarted),
  page('02-files', files),
  page('03-viewing', viewing),
  page('04-editing', editing),
  page('05-features', features),
  page('06-find', find),
  page('07-enzymes', enzymes),
  page('08-orfs', orfs),
  page('09-translate', translate),
  page('10-primers', primers),
  page('11-align', align),
  page('12-cloning', cloning),
  page('13-history', history),
  page('14-shortcuts', shortcuts),
  page('15-reads', reads),
];

export function guidePage(id: string): GuidePage | undefined {
  return GUIDE.find((p) => p.id === id);
}
