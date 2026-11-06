import type { SeqDocument } from '@/core';

import { type EnzymePage, enzymeWorkspace } from '../enzymeWorkspace';
import { useEditorState } from '../state/useEditorStore';
import type { WorkspaceLayout } from '../workspaceController';
import { DoubleDigests } from './DoubleDigestsPage';
import { useEnzymeList } from './enzymeList';
import {
  EnzymeControls,
  EnzymeFragments,
  EnzymeRows,
  EnzymeSource,
  GrownIn,
} from './EnzymeListView';
import { WorkspaceShell } from './WorkspaceShell';

const LABELS: Readonly<Record<EnzymePage, string>> = {
  enzymes: 'Enzymes',
  digest: 'Digest',
  pairs: 'Double',
  table: 'Table',
};

const HEADINGS: Readonly<Record<EnzymePage, string>> = {
  enzymes: 'Enzymes',
  digest: 'Digest',
  pairs: 'Double digests',
  table: 'Enzyme table',
};

/** The rail's icons: a list, three lanes, two lanes joined, a grid. */
const ICONS: Readonly<Record<EnzymePage, string>> = {
  enzymes: 'M2 4h2M6 4h7M2 8h2M6 8h7M2 12h2M6 12h7',
  digest: 'M4 2v11M8 2v11M12 2v11',
  pairs: 'M4 2v11M11 2v11M4 7h7',
  table: 'M2 3h11v9H2zM2 7h11M7 3v9',
};

interface Props {
  readonly doc: SeqDocument;
  readonly layout?: WorkspaceLayout;
}

/**
 * The Enzyme workspace (item 133, E2): the shared shell around four pages.
 * Enzymes is the list with its filters; Digest the ticked enzymes'
 * fragments on the gel; Double the best pairs of enzymes; Table the table
 * in use, to import into or add to. All over one `useEnzymeList`, the
 * panel's own, so the ticks and filters are the same ones in both; **Grown
 * in** is in the head because it changes every page's answer.
 */
export function EnzymeWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, shownEnzymes, enzymeSetInfo } = useEditorState();
  const [page, setPage] = enzymeWorkspace.usePage(documentId);
  const list = useEnzymeList(doc);
  const { ready, rows, listedEnzymes, fragments, pairable, cuts } = list;

  const badge = (p: EnzymePage): number | null => {
    if (!ready) return null;
    if (p === 'enzymes') return rows.length;
    if (p === 'digest') return fragments.length === 0 ? null : fragments.length;
    return null;
  };

  return (
    <WorkspaceShell
      doc={doc}
      name="Enzyme"
      title="Enzymes"
      layout={layout}
      pages={enzymeWorkspace.pages.map((p) => ({
        id: p,
        label: LABELS[p],
        heading: HEADINGS[p],
        icon: ICONS[p],
        badge: badge(p),
      }))}
      page={page}
      onPage={setPage}
      onClose={enzymeWorkspace.close}
      headingNote={
        page === 'enzymes' && ready && listedEnzymes < enzymeSetInfo.count ? (
          <span className="panel__heading-note">
            {listedEnzymes.toLocaleString()} of {enzymeSetInfo.count.toLocaleString()}
          </span>
        ) : undefined
      }
      head={<GrownIn doc={doc} className="ws__host" />}
    >
      {page === 'enzymes' && (
        <div className="panel enzymes enzymes--page">
          <EnzymeControls doc={doc} list={list} host={false} />
          <EnzymeRows doc={doc} list={list} />
        </div>
      )}
      {page === 'digest' && (
        <div className="panel enzymes enzymes--page">
          {!ready && <p className="panel__note">Scanning for restriction sites…</p>}
          {ready && fragments.length === 0 && (
            <p className="panel__note">
              Nothing is ticked, so there is no digest.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('enzymes');
                }}
              >
                Tick enzymes
              </button>{' '}
              in the list first.
            </p>
          )}
          <EnzymeFragments list={list} />
        </div>
      )}
      {page === 'pairs' && (
        <div className="panel enzymes enzymes--page">
          {!ready && <p className="panel__note">Scanning for restriction sites…</p>}
          {ready && (
            <DoubleDigests
              listed={rows}
              pairable={pairable}
              cuts={cuts}
              doc={doc}
              shownEnzymes={shownEnzymes}
            />
          )}
        </div>
      )}
      {page === 'table' && (
        <div className="panel enzymes enzymes--page">
          <EnzymeSource />
        </div>
      )}
    </WorkspaceShell>
  );
}
