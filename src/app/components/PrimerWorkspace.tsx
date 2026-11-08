import { useMemo } from 'react';

import { type SeqDocument, isEmptyRange } from '@/core';
import { type OverlaySpan } from '@/view/overlay';

import { batchSession } from '../batchSession';
import { rowPreview } from '../batchResults';
import { type DesignMode, type WorkspacePage, primerWorkspace } from '../primerWorkspace';
import { type WorkspaceLayout } from '../workspaceController';
import { useRemembered } from '../state/panelMemory';
import { usePrimerCollection } from '../state/primerCollection';
import { useEditorState } from '../state/useEditorStore';
import { useCloneCheck } from './cloneCheck';
import { BatchPage } from './BatchPage';
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
  batch: 'Batch',
  check: 'Check',
  clone: 'Clone check',
  mine: 'My primers',
};

const HEADINGS: Readonly<Record<WorkspacePage, string>> = {
  design: 'Design primers',
  results: 'Results',
  batch: 'Batch design',
  check: 'Check a primer',
  clone: 'Check a clone',
  mine: 'My primers',
};

/** The rail's icons, the mockup's: two primers, an arrow, a ruled grid, a list, a primer over a junction, a longer list. */
const ICONS: Readonly<Record<WorkspacePage, string>> = {
  design: 'M2 5h8l-2-2m2 2-2 2M13 10H5l2-2m-2 2 2 2',
  results: 'M2 8h11m-3-3 3 3-3 3',
  batch: 'M2 3h11M2 7.5h11M2 12h11M5.5 2v11',
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
 * (`WorkspaceShell`: region, rail, Escape, map strip) around six pages
 * that each have a heading of their own. The slim Primers panel takes the
 * keyboard back on "Design primers…" when it shuts.
 */
export function PrimerWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, selection } = useEditorState();
  const [page, setPage] = primerWorkspace.usePage(documentId);
  const [mode, setMode] = useRemembered<DesignMode>('primers.mode', documentId, 'plain');
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
  const batch = batchSession.use(documentId);

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
      case 'batch':
        return rowPreview(
          batch.run?.rows.find((r) => r.index === batch.selected),
          batch.selected === null ? undefined : batch.run?.source[batch.selected],
          doc,
          batch.run?.ranOn ?? null,
          batch.run?.templates ?? [],
        );
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
    batch.run,
    batch.selected,
    probe.preview,
    cloneCheck.preview,
  ]);
  usePrimersPreview(preview);

  const goTo = (next: WorkspacePage): void => {
    setPage(next);
  };

  const badge = (p: WorkspacePage): number | null => {
    if (p === 'results') {
      if (cloningResults) {
        return cloning.record.results === null ? 1 : designRows(cloning.record.results).length;
      }
      return design.pairs?.length ?? null;
    }
    if (p === 'batch')
      return batch.run === null || batch.run.rows.length === 0 ? null : batch.run.rows.length;
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
      pages={primerWorkspace.pages.map((p) => ({
        id: p,
        label: LABELS[p],
        heading: HEADINGS[p],
        icon: ICONS[p],
        badge: badge(p),
      }))}
      page={page}
      onPage={goTo}
      onClose={primerWorkspace.close}
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
                ? cloning.homology.on
                  ? 'Homology ends: the vector’s end sequence + annealing part on each primer'
                  : cloning.goldenGate.on
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
              {cloning.record.homology !== null
                ? 'Insert, vector or kit changed — '
                : cloning.record.goldenGate === null
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
            setMode(next);
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
      {page === 'batch' && <BatchPage doc={doc} />}
      {page === 'check' && <PrimerCheck doc={doc} probe={probe} />}
      {page === 'clone' && <CloneCheckPage doc={doc} state={cloneCheck} layout={layout} />}
      {page === 'mine' && <PrimerCollection doc={doc} />}
    </WorkspaceShell>
  );
}
