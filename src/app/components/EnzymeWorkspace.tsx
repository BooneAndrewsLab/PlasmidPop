import type { SeqDocument } from '@/core';

import { type EnzymePage, enzymeWorkspace } from '../enzymeWorkspace';
import { rememberPanel } from '../state/panelMemory';
import { useEditorState } from '../state/useEditorStore';
import type { WorkspaceLayout } from '../workspaceController';
import { DigestPage } from './DigestPage';
import { DoubleDigests } from './DoubleDigestsPage';
import { useEnzymeList } from './enzymeList';
import { GrownIn } from './EnzymeListView';
import { EnzymeSource } from './EnzymeSource';
import { EnzymeTable } from './EnzymeTable';
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
 * Enzymes is the table of what cuts, with its filters; Digest the ticked enzymes'
 * chips, gel and table of fragments, off while nothing is ticked; Double the
 * best pairs of enzymes in a table with a gel; Table the table in use, to
 * import into or add to, with the enzymes of your own. All over one `useEnzymeList`, the
 * panel's own, so the ticks and filters are the same ones in both; **Grown
 * in** is in the head because it changes every page's answer.
 */
export function EnzymeWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, shownEnzymes, enzymeSetInfo } = useEditorState();
  const [page, setPage] = enzymeWorkspace.usePage(documentId);
  const list = useEnzymeList(doc);
  const { ready, rows, listedEnzymes, fragments, pairable, cuts } = list;

  // The Double page opens with the enzyme asked about already chosen.
  const findPartner = (name: string): void => {
    rememberPanel('enzymes.anchor', documentId, name);
    setPage('pairs');
  };

  const badge = (p: EnzymePage): number | null => {
    if (p === 'table')
      return enzymeSetInfo.custom.length === 0 ? null : enzymeSetInfo.custom.length;
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
        ) : page === 'digest' && ready && shownEnzymes.size === 0 ? (
          <span className="panel__heading-note">Nothing is ticked</span>
        ) : undefined
      }
      head={<GrownIn doc={doc} className="ws__host" />}
    >
      {page === 'enzymes' && (
        <div className="panel enzymes enzymes--page">
          <EnzymeTable doc={doc} list={list} layout={layout} onPartner={findPartner} />
        </div>
      )}
      {page === 'digest' && (
        <div className="panel enzymes enzymes--page">
          <DigestPage
            doc={doc}
            list={list}
            onEnzymes={() => {
              setPage('enzymes');
            }}
          />
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
