import { useEffect, useRef } from 'react';

import { type SeqDocument, formatSpan, readDifferences } from '@/core';

import {
  alignmentKind,
  alignmentNumbers,
  assemblyLine,
  batchLine,
  differencesLine,
} from '../alignSummary';
import { type AlignPage, openAlignWorkspace, takeAlignFocusRequest } from '../alignWorkspace';
import { BATCH_LIMIT } from '../readBatch';
import { useEditorState } from '../state/useEditorStore';
import { AlignAction, AlignInput } from './AlignInput';
import { useAlignRun } from './alignRun';

interface Props {
  readonly doc: SeqDocument;
}

/** The id the workspace's Escape hands the keyboard back to (item 107, point 1). */
export const MORE_BUTTON_ID = 'align-workspace-open';

/**
 * The slim Align tab (item 129, #354): the common case and nothing else.
 * The box for reads or a sequence, the reference it is aligned to, one
 * Align, and a line on what came of it. Mode, the selection, trimming and
 * quality, the results in full, the assembly and the multiple alignment
 * are the workspace's, a link away; the two share the document's session,
 * so what was dropped here is there, and a result made there is summed
 * up here.
 */
export function AlignPanel({ doc }: Props) {
  const align = useAlignRun(doc);
  const { documentId, readConfidentQuality, selection } = useEditorState();
  const more = useRef<HTMLButtonElement>(null);
  // The workspace shut with Escape: the keyboard comes back here.
  useEffect(() => {
    if (takeAlignFocusRequest()) more.current?.focus();
  }, []);

  const { session, records, docIsRead, docRead, hasSelection, stale, showBatch } = align;
  const { result, batch, assembly, useSelection } = session;
  const selectionOnly = useSelection && hasSelection && !docIsRead && selection !== null;
  const against = selectionOnly ? 'the selection' : doc.name;
  const unit = doc.alphabet === 'protein' ? 'aa' : 'bp';
  const open = (page: AlignPage): void => {
    openAlignWorkspace(documentId, page);
  };
  const referenceName = result?.docIsRead?.referenceName ?? doc.name;

  return (
    <div className="panel align align--slim">
      <p className="panel__note">
        {docIsRead && docRead !== null
          ? `${doc.name} is a read: it is aligned to the sequence in the box, as the reference, with its own qualities${docRead.trace === null ? '' : ' and trace'}.`
          : `Reads, or a sequence, to align to ${doc.name}: paste one, or choose or drop files. Several files at once are aligned together.`}
      </p>
      <AlignInput doc={doc} align={align} />
      {!docIsRead && (
        <p className="panel__note align__reference">
          Reference: {doc.name}, {doc.length.toLocaleString()} {unit}
          {doc.isCircular ? ', circular' : ''}
          {selectionOnly ? `, the selection ${formatSpan(selection, doc.length)} only` : ''}.
        </p>
      )}
      <AlignAction align={align} primary />
      {(result !== null || showBatch || assembly !== null) && (
        <div className="align__summary" role="status">
          {stale && <p className="panel__note align-stale-note">Input changed, align again.</p>}
          {result !== null && (
            <>
              <p className="panel__note">
                <strong>{alignmentKind(result)}</strong>: {alignmentNumbers(result)}.
              </p>
              {result.qualities !== null && (
                <p className="panel__note">
                  {differencesLine(
                    readDifferences(result.alignment, result.qualities, readConfidentQuality),
                    readConfidentQuality,
                    referenceName,
                  )}
                </p>
              )}
            </>
          )}
          {showBatch && batch !== null && (
            <p className="panel__note">{batchLine(batch, against)}.</p>
          )}
          {assembly !== null && <p className="panel__note">{assemblyLine(assembly.assembly)}.</p>}
          <button
            type="button"
            className="link panel__door"
            data-tip={
              assembly !== null && result === null && batch === null
                ? 'The contigs, their layout and warnings, and the consensus to save'
                : 'Every read, the differences, and the large view'
            }
            onClick={() => {
              open(assembly !== null && result === null && batch === null ? 'assemble' : 'results');
            }}
          >
            {assembly !== null && result === null && batch === null ? 'Assembly ›' : 'Results ›'}
          </button>
        </div>
      )}
      <div className="panel__links">
        <button
          type="button"
          id={MORE_BUTTON_ID}
          ref={more}
          className="link panel__door"
          data-tip="Mode, the selection, trimming and quality, and the results in full: the Align workspace"
          onClick={() => {
            open('align');
          }}
        >
          Open Align workspace ›
        </button>
        {records.length > 1 && records.length <= BATCH_LIMIT && (
          <button
            type="button"
            className="link panel__door"
            data-tip="Join the records into contigs by their overlaps, with no reference"
            onClick={() => {
              open('assemble');
            }}
          >
            Assemble reads ›
          </button>
        )}
        {records.length > 1 && (
          <button
            type="button"
            className="link panel__door"
            data-tip="Align the records with each other, and with this document, in one view"
            onClick={() => {
              open('multiple');
            }}
          >
            Multiple alignment ›
          </button>
        )}
      </div>
    </div>
  );
}
