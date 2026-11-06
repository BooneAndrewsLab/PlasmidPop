import { useEffect, useMemo, useState } from 'react';

import { type AlignmentMode, type SeqDocument, qualityOfError } from '@/core';

import { batchLine, formatErrorRate } from '../alignSummary';
import { type AlignPage, alignWorkspace } from '../alignWorkspace';
import { alignedRegionSpan } from '../readAlignment';
import { BATCH_LIMIT } from '../readBatch';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { AlignAction, AlignInput, AlignProgress } from './AlignInput';
import { AlignmentDialog } from './AlignmentDialog';
import { AlignmentResult, QualitySettings } from './AlignResult';
import { type LargeView, useAlignRun } from './alignRun';
import { AssemblyResult } from './AssemblyResult';
import { MsaControls } from './MsaControls';
import type { WorkspaceLayout } from '../workspaceController';
import { ReadBatchList } from './ReadBatchList';
import { WorkspaceShell } from './WorkspaceShell';

const LABELS: Readonly<Record<AlignPage, string>> = {
  align: 'Align',
  results: 'Results',
  assemble: 'Assemble',
  multiple: 'Multiple',
};

const HEADINGS: Readonly<Record<AlignPage, string>> = {
  align: 'Align to the document',
  results: 'Results',
  assemble: 'Assemble reads',
  multiple: 'Multiple alignment',
};

/** The rail's icons: a read over a reference, a stacked list, overlapping bars, three rows. */
const ICONS: Readonly<Record<AlignPage, string>> = {
  align: 'M2 10h11M4 5h7',
  results: 'M2 4h11M2 8h11M2 12h11',
  assemble: 'M2 5h6M5 8h6M8 11h5',
  multiple: 'M2 4h11M2 8h8M2 12h11',
};

interface Props {
  readonly doc: SeqDocument;
  readonly layout?: WorkspaceLayout;
}

/**
 * The Align workspace (item 129, #354): the shared shell around four pages.
 * Align is the box with every option; Results the batch's list or the one
 * alignment, with the large view; Assemble the contigs with their map,
 * warnings and consensus; Multiple the alignment of the records with each
 * other. All over the document's session, which the slim panel shares, so
 * nothing is lost between the two.
 */
export function AlignWorkspace({ doc, layout = 'split' }: Props) {
  const { documentId, readConfidentQuality, readTrimCutoff } = useEditorState();
  const [page, setPage] = alignWorkspace.usePage(documentId);
  const align = useAlignRun(doc);
  const { session, records, stale, showBatch, docIsRead, docRead, hasSelection, record } = align;
  const { result, batch, assembly, useSelection, trim, docAsRead, busy } = session;
  const [large, setLarge] = useState<LargeView | null>(null);
  const against = useSelection && hasSelection && !docIsRead ? 'the selection' : doc.name;

  // The batch row under the pointer or focus: its region is pointed at in the views (#108).
  const [pointedRow, setPointedRow] = useState<number | null>(null);
  const pointedSpan = useMemo(() => {
    if (batch === null || pointedRow === null) return null;
    const row = batch.rows.find((r) => r.index === pointedRow);
    return row?.status === 'aligned' ? alignedRegionSpan(row.result, false, doc.length) : null;
  }, [batch, pointedRow, doc.length]);
  useEffect(() => {
    if (pointedSpan === null) return;
    editorStore.setPreview('align', [pointedSpan]);
    return () => {
      editorStore.clearPreview('align');
    };
  }, [pointedSpan]);

  const badge = (p: AlignPage): number | null => {
    if (p === 'results') {
      if (batch !== null) return batch.rows.filter((r) => r.status === 'aligned').length;
      return result === null ? null : 1;
    }
    if (p === 'assemble') return assembly?.assembly.contigs.length ?? null;
    return null;
  };

  const hasResults = result !== null || showBatch;
  const canAssemble = records.length >= 2 && records.length <= BATCH_LIMIT;

  return (
    <WorkspaceShell
      doc={doc}
      name="Align"
      title="Align"
      layout={layout}
      pages={alignWorkspace.pages.map((p) => ({
        id: p,
        label: LABELS[p],
        heading: HEADINGS[p],
        icon: ICONS[p],
        badge: badge(p),
      }))}
      page={page}
      onPage={setPage}
      onClose={alignWorkspace.close}
      head={
        <>
          {page === 'align' && (
            <span className="ws__sub">
              {docIsRead
                ? `${doc.name} is the read; the box holds the reference`
                : `Reads, or a sequence, against ${against}`}
            </span>
          )}
          {page === 'results' && hasResults && stale && (
            <span className="ws__sub ws__sub--note" role="status">
              Input changed —{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('align');
                }}
              >
                Align again
              </button>
            </span>
          )}
        </>
      }
    >
      {page === 'align' && (
        <div className="panel align align--page">
          <p className="panel__note">
            {docIsRead && docRead !== null
              ? `${doc.name} is a read: it is aligned to the sequence in the box, as the reference, with its own qualities${docRead.trace === null ? '' : ' and trace'}. Whichever orientation of it aligns better is shown.`
              : `Align sequences to ${against}. Paste one below, or choose or drop files. Pick several at once to align them all together; a new pick replaces the ones loaded. Whichever orientation of each aligns better is shown.`}
          </p>
          <AlignInput doc={doc} align={align} />
          <AlignAction
            align={align}
            primary
            onRun={() => {
              setPage('results');
            }}
          />
          <fieldset className="panel__group">
            <legend>Options</legend>
            {docRead !== null && record?.read === undefined && (
              <label
                className="toggle"
                data-tip="Untick to align the box's sequence to this document instead, as to any other; the read's qualities are then not used"
              >
                <input
                  type="checkbox"
                  checked={docAsRead}
                  onChange={(e) => {
                    align.setDocAsRead(e.target.checked);
                  }}
                />
                This document is the read
              </label>
            )}
            <div className="panel__controls">
              <label className="panel__field panel__field--row">
                <span>Mode</span>
                <select
                  className="panel__select"
                  aria-label="Alignment mode"
                  value={align.mode}
                  onChange={(e) => {
                    align.setPickedMode(e.target.value as AlignmentMode);
                  }}
                >
                  <option value="global">Global (end to end)</option>
                  <option value="local">Local (best region)</option>
                </select>
              </label>
              <label
                className="toggle"
                data-tip={
                  docIsRead
                    ? 'Not used: the whole read is aligned'
                    : hasSelection
                      ? undefined
                      : 'Select part of the document first'
                }
              >
                <input
                  type="checkbox"
                  checked={useSelection && hasSelection && !docIsRead}
                  disabled={!hasSelection || docIsRead}
                  onChange={(e) => {
                    align.setUseSelection(e.target.checked);
                  }}
                />
                Against selection only
              </label>
            </div>
            {align.suggestedReason !== null && (
              <p className="panel__note">
                {`Local, since ${docIsRead ? 'this document' : 'the sequence in the box'} is ${align.suggestedReason}: Global would score it across the whole of the other. Choose Global to align end to end anyway.`}
                {records.length > 1 ? ' Aligning all chooses for each record the same way.' : ''}
              </p>
            )}
          </fieldset>
          {align.anyReads && (
            <fieldset className="panel__group">
              <legend>Reads</legend>
              <div className="panel__controls">
                <label
                  className="toggle"
                  data-tip={`Mott's algorithm: keep the stretch whose bases are mostly better than Q${qualityOfError(readTrimCutoff)} (${formatErrorRate(readTrimCutoff)} error)`}
                >
                  <input
                    type="checkbox"
                    checked={trim}
                    onChange={(e) => {
                      align.setTrim(e.target.checked);
                    }}
                  />
                  Trim poor ends
                </label>
              </div>
              <QualitySettings trim={trim} />
            </fieldset>
          )}
        </div>
      )}
      {page === 'results' && (
        <div className="panel align align--page">
          {!hasResults && busy && <p className="panel__note">Aligning…</p>}
          {!hasResults && !busy && (
            <p className="panel__note">
              Nothing aligned yet.{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('align');
                }}
              >
                Align
              </button>{' '}
              a sequence, or a batch of reads, first.
            </p>
          )}
          <AlignProgress align={align} />
          {hasResults && (
            <fieldset
              className={`align-results${stale ? ' align-results--stale' : ''}`}
              disabled={stale}
              aria-label="Alignment results"
            >
              {showBatch && batch !== null && (
                <div className="panel__section">
                  <h3 className="panel__heading">
                    {batch.total} reads
                    <span className="panel__heading-note">{batchLine(batch, against)}</span>
                  </h3>
                  {batch.rows.some((r) => r.status === 'aligned') && (
                    <button
                      type="button"
                      className="button button--primary button--small"
                      data-tip="Show every aligned read at once, stacked under the document, in a window of its own; the read picked in the list is the one selected there"
                      onClick={() => {
                        const picked = align.batchPickedRow;
                        setLarge(
                          align.batchLarge(picked?.status === 'aligned' ? picked.index : undefined),
                        );
                      }}
                    >
                      Large view of all
                    </button>
                  )}
                  <ReadBatchList
                    rows={batch.rows}
                    confidentFrom={readConfidentQuality}
                    selected={session.batchPicked}
                    onSelect={(index) => {
                      setPointedRow(null);
                      align.pickBatchRow(index);
                    }}
                    onPoint={setPointedRow}
                  />
                </div>
              )}
              {result !== null && (
                <AlignmentResult
                  key={session.resultKey}
                  result={result}
                  docName={doc.name}
                  docLength={doc.length}
                  onOpenLarge={() => {
                    setLarge(align.resultLarge());
                  }}
                />
              )}
            </fieldset>
          )}
          {large !== null && (
            <AlignmentDialog
              {...large}
              onClose={() => {
                setLarge(null);
              }}
            />
          )}
        </div>
      )}
      {page === 'assemble' && (
        <div className="panel align align--page">
          <p className="panel__note">
            Join the records of the box into contigs by their overlaps, with no reference, and call
            a consensus from their base qualities. Two to {BATCH_LIMIT} records; the reads are
            trimmed as the Align page's Reads settings say.
          </p>
          <div className="panel__controls align-run">
            <button
              type="button"
              className="button button--primary button--small"
              disabled={busy || !canAssemble}
              data-tip={
                canAssemble
                  ? 'Join the records into contigs by their overlaps, with no reference, and call a consensus from their base qualities'
                  : 'Put two or more records in the box on the Align page first'
              }
              onClick={align.runAssemble}
            >
              {busy && assembly === null && batch === null ? 'Assembling…' : 'Assemble reads'}
            </button>
            {busy && session.progress !== null && batch === null && (
              <>
                <progress
                  className="align-progress__bar"
                  value={session.progress}
                  max={1}
                  aria-label="Assembly progress"
                />
                <button
                  type="button"
                  className="button button--quiet button--small"
                  onClick={align.cancel}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
          {align.readPairs.pairs.length > 0 && (
            <div className="panel__controls">
              <label
                className="panel__field panel__field--row"
                data-tip="Bases from the outer end of one mate to the outer end of the other, as the template is. Blank: the pairs are checked only for facing each other"
              >
                <span>Insert size</span>
                <input
                  className="panel__input panel__input--number"
                  aria-label="Insert size in bases"
                  inputMode="numeric"
                  placeholder="unknown"
                  value={align.insertSize}
                  onChange={(e) => {
                    align.setInsertSize(e.target.value);
                  }}
                />
                <span>bp</span>
              </label>
            </div>
          )}
          {align.readPairs.pairs.length > 0 && (
            <p className="panel__note">
              {`${align.readPairs.pairs.length} read ${align.readPairs.pairs.length === 1 ? 'pair' : 'pairs'} found by name (${align.readPairs.pairs
                .slice(0, 3)
                .map((p) => p.stem)
                .join(
                  ', ',
                )}${align.readPairs.pairs.length > 3 ? ', …' : ''}). Mates face each other about an insert size apart, which places a read that fits a repeat in more than one place and shows a contig that lost the stretch between two mates.`}
              {align.insertSize.trim() !== '' && align.insertBases === null
                ? ' The insert size is not used: enter a number of bases, 50 or more.'
                : ''}
            </p>
          )}
          {align.readPairs.ambiguous.length > 0 && (
            <p className="panel__note">
              {`Not paired, as the names do not say which two are mates: ${align.readPairs.ambiguous
                .map((a) => a.names.join(', '))
                .join('; ')}.`}
            </p>
          )}
          {!canAssemble && records.length < 2 && (
            <p className="panel__note">
              Nothing to assemble yet:{' '}
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('align');
                }}
              >
                load two or more reads
              </button>{' '}
              first.
            </p>
          )}
          {session.error !== null && <p className="panel__error">{session.error}</p>}
          {assembly !== null && (
            <AssemblyResult
              assembly={assembly.assembly}
              readNames={assembly.names}
              reference={
                doc.length === 0
                  ? null
                  : {
                      name: doc.name,
                      busy,
                      onAlign: () => {
                        if (align.runAll()) setPage('results');
                      },
                    }
              }
            />
          )}
        </div>
      )}
      {page === 'multiple' && (
        <div className="panel align align--page">
          <MsaControls doc={doc} records={records} />
          {records.length < 2 && (
            <p className="panel__note">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setPage('align');
                }}
              >
                Put the records in the box
              </button>{' '}
              on the Align page: a multi-record FASTA or GenBank, several files, or several open
              tabs.
            </p>
          )}
        </div>
      )}
    </WorkspaceShell>
  );
}
