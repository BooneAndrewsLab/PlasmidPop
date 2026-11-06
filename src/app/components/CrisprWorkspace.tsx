import type { SeqDocument } from '@/core';

import { type CrisprPage, crisprWorkspace } from '../crisprWorkspace';
import { useEditorState } from '../state/useEditorStore';
import type { WorkspaceLayout } from '../workspaceController';
import { PairedNickases } from './CrisprPairedNickases';
import { CrisprGuides, CrisprScanNotices, OffTargetNote } from './CrisprGuides';
import { useNickPairs, usePegRnas } from './crisprEditing';
import { useOffTargetNote } from './crisprOffTargetNote';
import { PrimeEditing } from './CrisprPrimeEditing';
import { useCrisprScan } from './crisprScan';
import { WorkspaceShell } from './WorkspaceShell';

const LABELS: Readonly<Record<CrisprPage, string>> = {
  guides: 'Guides',
  pairs: 'Pairs',
  prime: 'Prime',
};

const HEADINGS: Readonly<Record<CrisprPage, string>> = {
  guides: 'Guides',
  pairs: 'Paired nickases',
  prime: 'Prime editing',
};

/** The rail's icons: a guide beside its PAM, two staggered nicks, a template with a flap. */
const ICONS: Readonly<Record<CrisprPage, string>> = {
  guides: 'M2 8h8M10 5v6M13 5v6',
  pairs: 'M2 5h8M5 11h8',
  prime: 'M2 10h11M4 10V4h5',
};

interface Props {
  readonly doc: SeqDocument;
  readonly layout?: WorkspaceLayout;
}

/** Why a page has nothing to list for this nuclease, with the way to another. */
function NeedsCas9({ what, onGuides }: { readonly what: string; readonly onGuides: () => void }) {
  return (
    <p className="panel__note">
      {what} a Cas9-like nuclease, with the PAM after the guide and a blunt cut. Choose one on the{' '}
      <button type="button" className="link" onClick={onGuides}>
        Guides
      </button>{' '}
      page.
    </p>
  );
}

/**
 * The CRISPR workspace (item 133): the shared shell around three pages.
 * Guides is the settings, the filters and the guide table with its detail
 * (C4); Pairs the paired nickases and Prime the pegRNAs, each a table over
 * the same scan, with the rail counting its rows (C5). All over one
 * `useCrisprScan`, the panel's own, whose state is the document's session: a
 * scan started in either place is the other's, and switching rescans nothing.
 * What the views draw follows the page in front.
 */
export function CrisprWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId } = useEditorState();
  const [page, setPage] = crisprWorkspace.usePage(documentId);
  const scan = useCrisprScan(doc, { preview: page === 'guides' });
  const { guides, nuclease, problem, scanning, sorted, filtered, clean } = scan;
  const note = useOffTargetNote();
  // Both are worked out here, not in the pages, so the rail can count them
  // from any page; each is empty unless the nuclease allows it.
  const nick = useNickPairs(doc, guides, nuclease);
  const design = usePegRnas(doc, guides, nuclease);

  const ready = problem === null && nuclease !== null && guides !== null;
  const toGuides = (): void => {
    setPage('guides');
  };

  const badge = (p: CrisprPage): number | null => {
    if (p === 'guides') return guides !== null && !scanning ? sorted.length : null;
    if (!ready) return null;
    if (p === 'pairs') return nick.allowed ? nick.pairs.length : null;
    return design.allowed && design.edit !== null ? design.pegs.length : null;
  };

  return (
    <WorkspaceShell
      doc={doc}
      name="CRISPR"
      title="CRISPR"
      layout={layout}
      pages={crisprWorkspace.pages.map((p) => ({
        id: p,
        label: LABELS[p],
        heading: HEADINGS[p],
        icon: ICONS[p],
        badge: badge(p),
      }))}
      page={page}
      onPage={setPage}
      onClose={crisprWorkspace.close}
      headingNote={
        page === 'guides' && guides !== null && guides.length > 0 && !scanning ? (
          <span className="panel__heading-note">
            {filtered
              ? `${sorted.length.toLocaleString()} of ${guides.length.toLocaleString()}`
              : `${guides.length.toLocaleString()} · ${clean.toLocaleString()} clean`}
          </span>
        ) : undefined
      }
      head={page === 'guides' && !note.seen ? <OffTargetNote onSeen={note.dismiss} /> : undefined}
    >
      <div className="panel">
        {page === 'guides' && <CrisprGuides doc={doc} scan={scan} noteSeen={note.seen} />}
        {page === 'pairs' &&
          (nuclease !== null && !nick.allowed ? (
            <NeedsCas9 what="Paired nickases need" onGuides={toGuides} />
          ) : ready ? (
            <PairedNickases doc={doc} nick={nick} guideCount={guides.length} />
          ) : (
            <CrisprScanNotices scan={scan} />
          ))}
        {page === 'prime' &&
          (nuclease !== null && !design.allowed ? (
            <NeedsCas9 what="Prime editing needs" onGuides={toGuides} />
          ) : ready ? (
            <PrimeEditing doc={doc} design={design} />
          ) : (
            <CrisprScanNotices scan={scan} />
          ))}
      </div>
    </WorkspaceShell>
  );
}
