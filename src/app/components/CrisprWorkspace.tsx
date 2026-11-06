import type { SeqDocument } from '@/core';
import { supportsNickPairs, supportsPrimeEditing } from '@/core';

import { type CrisprPage, crisprWorkspace } from '../crisprWorkspace';
import { useEditorState } from '../state/useEditorStore';
import type { WorkspaceLayout } from '../workspaceController';
import { PairedNickases } from './CrisprPairedNickases';
import { CrisprGuideList } from './CrisprGuideList';
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
 * each today's piece as it is. Guides is the options and the guide list;
 * Pairs the paired nickases; Prime the pegRNAs. All over one
 * `useCrisprScan`, the panel's own, whose state is the document's session:
 * a scan started in either place is the other's, and switching rescans
 * nothing.
 */
export function CrisprWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId } = useEditorState();
  const [page, setPage] = crisprWorkspace.usePage(documentId);
  const scan = useCrisprScan(doc);
  const { guides, nuclease, problem, scanning, sorted } = scan;

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
    >
      <div className="panel">
        {page === 'guides' && <CrisprGuideList doc={doc} scan={scan} />}
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
