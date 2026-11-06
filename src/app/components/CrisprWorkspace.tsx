import type { SeqDocument } from '@/core';
import { supportsNickPairs, supportsPrimeEditing } from '@/core';

import { type CrisprPage, crisprWorkspace } from '../crisprWorkspace';
import { useEditorState } from '../state/useEditorStore';
import type { WorkspaceLayout } from '../workspaceController';
import { PairedNickases } from './CrisprPairedNickases';
import { CrisprGuides, OffTargetNote } from './CrisprGuides';
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

/**
 * The CRISPR workspace (item 133, C2): the shared shell around three pages,
 * Guides is the settings, the filters and the guide table with its detail
 * (C4); Pairs the paired nickases and Prime the pegRNAs, each today's piece
 * as it is. All over one `useCrisprScan`, the panel's own, whose state is the
 * document's session: a scan started in either place is the other's, and
 * switching rescans nothing.
 */
export function CrisprWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId } = useEditorState();
  const [page, setPage] = crisprWorkspace.usePage(documentId);
  const scan = useCrisprScan(doc);
  const { guides, nuclease, problem, scanning, sorted, filtered, clean } = scan;
  const note = useOffTargetNote();

  const ready = problem === null && nuclease !== null && guides !== null;
  const prime = ready && supportsPrimeEditing(nuclease);
  const pairs = ready && supportsNickPairs(nuclease);

  const badge = (p: CrisprPage): number | null =>
    p === 'guides' && guides !== null && !scanning ? sorted.length : null;

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
          (pairs ? (
            <PairedNickases doc={doc} guides={guides} />
          ) : (
            <p className="panel__note">
              Paired nickases need a Cas9-like nuclease, with the PAM after the guide and a blunt
              cut. Choose one on the{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('guides');
                }}
              >
                Guides
              </button>{' '}
              page.
            </p>
          ))}
        {page === 'prime' &&
          (prime ? (
            <PrimeEditing doc={doc} guides={guides} nuclease={nuclease} />
          ) : (
            <p className="panel__note">
              Prime editing needs a Cas9-like nuclease, with the PAM after the guide and a blunt
              cut. Choose one on the{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('guides');
                }}
              >
                Guides
              </button>{' '}
              page.
            </p>
          ))}
      </div>
    </WorkspaceShell>
  );
}
