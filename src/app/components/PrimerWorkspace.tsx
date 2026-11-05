import { useMemo } from 'react';

import { type SeqDocument, isEmptyRange } from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import {
  type DesignMode,
  WORKSPACE_PAGES,
  type WorkspaceLayout,
  type WorkspaceMemory,
  type WorkspacePage,
  closePrimerWorkspace,
} from '../primerWorkspace';
import { useRemembered } from '../state/panelMemory';
import { usePrimerCollection } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { useCloneCheck } from './cloneCheck';
import { CloneCheckPage } from './CloneCheckPage';
import { CloningCandidates } from './CloningCandidates';
import { designRows, useCloningDesign } from './cloningDesign';
import { PrimerCandidates } from './PrimerCandidates';
import { PrimerCheck } from './PrimerCheck';
import { PrimerCollection } from './PrimerCollection';
import { PrimerDesignPage } from './PrimerDesignPage';
import { searchWindows, usePrimerDesign, usePrimerProbe, usePrimersPreview } from './primerDesign';
import { WorkspaceShell } from './WorkspaceShell';

const LABELS: Readonly<Record<WorkspacePage, string>> = {
  design: 'Design',
  results: 'Results',
  check: 'Check',
  clone: 'Clone check',
  mine: 'My primers',
};

const HEADINGS: Readonly<Record<WorkspacePage, string>> = {
  design: 'Design primers',
  results: 'Results',
  check: 'Check a primer',
  clone: 'Check a clone',
  mine: 'My primers',
};

/** The rail's icons, the mockup's: two primers, an arrow, a list, a primer over a junction, a longer list. */
const ICONS: Readonly<Record<WorkspacePage, string>> = {
  design: 'M2 5h8l-2-2m2 2-2 2M13 10H5l2-2m-2 2 2 2',
  results: 'M2 8h11m-3-3 3 3-3 3',
  check: 'M2 4h11M2 7h7M2 10h11',
  clone: 'M2 11h11M7.5 3v8M3 6h6l-1.5-1.5M9 6 7.5 7.5',
  mine: 'M2 4h11M2 8h7M2 12h9',
};

export type { WorkspaceLayout };

interface Props {
  readonly doc: SeqDocument;
  /** Beside the live map, the whole main area, or the whole screen (point 5). */
  readonly layout?: WorkspaceLayout;
}

/**
 * The primer workspace (item 107, #300): the shared shell
 * (`WorkspaceShell`: region, rail, Escape, map strip) around five pages
 * that each have a heading of their own. The slim Primers panel takes the
 * keyboard back on "Design primers…" when it shuts.
 */
export function PrimerWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, selection } = useEditorState();
  const [memory, setMemory] = useRemembered<WorkspaceMemory>('primers.workspace', documentId, {
    page: 'design',
    mode: 'plain',
  });
  const { page } = memory;
  // A memory written before the mode existed has none: the plain mode then.
  const mode: DesignMode = memory.mode === 'cloning' ? 'cloning' : 'plain';
  const design = usePrimerDesign(doc);
  const cloning = useCloningDesign(doc);
  // Results shows whichever table the last design made (#303).
  const [resultsKind, setResultsKind] = useRemembered<DesignMode>(
    'primers.resultsKind',
    documentId,
    'plain',
  );
  const cloningResults = resultsKind === 'cloning' && cloning.record !== null;
  const probe = usePrimerProbe(doc);
  const cloneCheck = useCloneCheck(doc);
  const { primerCriteria } = useEditorState();
  const collection = usePrimerCollection();

  // What the views draw for the page in front: the search windows around
  // the target while designing, the pair looked at on Results, the binding
  // sites on Check. My primers draws its own (`collection`).
  const preview = useMemo<readonly OverlaySpan[]>(() => {
    switch (page) {
      case 'design':
        if (mode === 'cloning') return cloning.preview;
        return selection === null || isEmptyRange(selection)
          ? []
          : searchWindows(selection, primerCriteria, doc);
      case 'results':
        // A target changed since the design takes the preview off, keeping the row (point 3).
        if (cloningResults) return cloning.designUnchanged ? cloning.preview : [];
        return design.targetUnchanged ? design.preview : [];
      case 'check':
        return probe.preview;
      case 'clone':
        return cloneCheck.preview;
      case 'mine':
        return [];
    }
  }, [
    page,
    mode,
    selection,
    primerCriteria,
    doc,
    design.preview,
    design.targetUnchanged,
    cloning.preview,
    cloning.designUnchanged,
    cloningResults,
    probe.preview,
    cloneCheck.preview,
  ]);
  usePrimersPreview(preview);

  const goTo = (next: WorkspacePage): void => {
    setMemory((m) => ({ ...m, page: next }));
  };

  const badge = (p: WorkspacePage): number | null => {
    if (p === 'results') {
      if (cloningResults) {
        return cloning.record.goldenGate === null ? designRows(cloning.record.results).length : 1;
      }
      return design.pairs?.length ?? null;
    }
    if (p === 'mine') return collection.primers.length;
    if (p === 'clone') return cloneCheck.record?.design.pairs.length ?? null;
    return null;
  };

  return (
    <WorkspaceShell
      doc={doc}
      name="Primer"
      title="Primers"
      layout={layout}
      pages={WORKSPACE_PAGES.map((p) => ({
        id: p,
        label: LABELS[p],
        heading: HEADINGS[p],
        icon: ICONS[p],
        badge: badge(p),
      }))}
      page={page}
      onPage={goTo}
      onClose={closePrimerWorkspace}
      headingNote={
        page === 'mine' && collection.status === 'ready' ? (
          <span className="panel__heading-note">{collection.primers.length}</span>
        ) : undefined
      }
      head={
        <>
          {page === 'clone' && (
            <span className="ws__sub">
              Colony PCR: a pair across each junction, and one flanking the insert
            </span>
          )}
          {page === 'design' && (
            <span className="ws__sub">
              {mode === 'cloning'
                ? cloning.goldenGate.on
                  ? 'Golden Gate ends: padding + Type IIS site + spacer + overhang + annealing part'
                  : 'Restriction-cloning ends: padding + site + annealing part on each primer'
                : 'Up to 10 pairs, best first'}
            </span>
          )}
          {page === 'results' && cloningResults && (
            <span className="ws__sub">Cloning primers · {cloning.record.designedFor}</span>
          )}
          {page === 'results' && cloningResults && !cloning.designUnchanged && (
            <span className="ws__sub ws__sub--note" role="status">
              {cloning.record.goldenGate === null
                ? 'Insert, region or pair changed — '
                : 'Insert, enzyme or overhangs changed — '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  goTo('design');
                }}
              >
                Design again
              </button>
            </span>
          )}
          {page === 'results' &&
            !cloningResults &&
            design.pairs !== null &&
            !design.targetUnchanged && (
              <span className="ws__sub ws__sub--note" role="status">
                Target changed —{' '}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    goTo('design');
                  }}
                >
                  Design again
                </button>
              </span>
            )}
        </>
      }
    >
      {page === 'design' && (
        <PrimerDesignPage
          doc={doc}
          design={design}
          cloning={cloning}
          mode={mode}
          setMode={(next) => {
            setMemory((m) => ({ ...m, mode: next }));
          }}
          layout={layout}
          onDesigned={() => {
            setResultsKind(mode);
            goTo('results');
          }}
          onResults={() => {
            setResultsKind(mode);
            goTo('results');
          }}
        />
      )}
      {page === 'results' &&
        (cloningResults ? (
          <CloningCandidates cloning={cloning} layout={layout} />
        ) : (
          <PrimerCandidates doc={doc} design={design} layout={layout} />
        ))}
      {page === 'check' && <PrimerCheck doc={doc} probe={probe} />}
      {page === 'clone' && <CloneCheckPage doc={doc} state={cloneCheck} layout={layout} />}
      {page === 'mine' && <PrimerCollection doc={doc} />}
    </WorkspaceShell>
  );
}
