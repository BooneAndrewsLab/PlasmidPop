import { useEffect, useMemo, useRef } from 'react';

import { type DiffHunk, diffHunks, isEmptyDiff } from '@/core';
import { supportsFileSystemAccess } from '@/storage';

import { describeEditDiff } from '../editsView';
import { featureChangeRows } from '../featureChanges';
import { editDiffBetween } from '../state/editDiff';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { DiffStrip } from './DiffStrip';

/**
 * How many neighbourhoods are drawn. A review is meant to be read, and past
 * a dozen pieces of sequence nobody reads it; the rest are counted instead.
 */
const MAX_STRIPS = 12;

/** How each kind of change is marked in the Features list. */
const MARK_CLASS: Readonly<Record<'+' | '~' | '−', string>> = {
  '+': 'save-review__mark--add',
  '~': 'save-review__mark--change',
  '−': 'save-review__mark--remove',
};

/**
 * What one neighbourhood did, as its heading: `inserted 5 bp; deleted 3 bp`.
 * Only what happened is named, so a plain insertion does not read as a list
 * of three things two of which are zero.
 */
function describeHunk(hunk: DiffHunk): string {
  const parts: string[] = [];
  if (hunk.basesInserted > 0) parts.push(`inserted ${hunk.basesInserted.toLocaleString()} bp`);
  if (hunk.basesDeleted > 0) parts.push(`deleted ${hunk.basesDeleted.toLocaleString()} bp`);
  if (hunk.basesChanged > 0) parts.push(`changed ${hunk.basesChanged.toLocaleString()} bp`);
  return parts.join('; ');
}

/**
 * Shown when a working copy is about to be written out as a file: what this
 * copy changed about the file it came from, drawn the way the sequence view
 * draws tracked changes, before anything reaches the disk.
 *
 * The file it came from is not involved — nothing in PlasmidPop can write to
 * it — so this is a review, not a confirmation: the only decision is whether
 * to go on and write the copy.
 */
export function SaveReviewDialog() {
  const state = useEditorState();
  const { saveReview, origin } = state;
  const current = state.history?.present ?? null;
  const saveRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (saveReview === null) return;
    saveRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissSaveReview();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [saveReview]);

  // Only while the review is up: the diff cache holds one pair of versions,
  // and diffing here on every render would evict what the sequence view's own
  // marks just put in it (and diff the document twice a render for nothing).
  const diff = useMemo(
    () => (saveReview === null ? null : editDiffBetween(origin?.doc ?? null, current)),
    [saveReview, origin?.doc, current],
  );
  const hunks = useMemo(
    () => (diff === null || current === null ? [] : diffHunks(diff, current.length)),
    [diff, current],
  );
  const featureRows = useMemo(
    () => (diff === null || current === null ? [] : featureChangeRows(diff, current)),
    [diff, current],
  );

  if (saveReview === null || origin === null || current === null) return null;
  const { fileName } = saveReview;
  // Without the File System Access API there is no save dialog: the file
  // goes to the downloads folder under a name the browser decides, so say
  // that rather than promising to ask where to put it.
  const picker = supportsFileSystemAccess();
  // Null both when the versions are identical and when nothing about them is
  // worth marking, so the body below has one case to handle rather than two.
  const changes = diff === null || isEmptyDiff(diff) ? null : diff;
  const shown = hunks.slice(0, MAX_STRIPS);
  const report = (p: Promise<unknown>): void => {
    p.catch((e: unknown) => {
      editorStore.fail(e instanceof Error ? e.message : String(e));
    });
  };

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-review-title"
        aria-describedby="save-review-body"
      >
        <h2 id="save-review-title" className="dialog__title">
          Download “{current.name}”
        </h2>
        <p id="save-review-body" className="dialog__body">
          This is a working copy of <strong>{fileName}</strong>, which has not been changed and will
          not be. Here is what differs from it.{' '}
          {picker
            ? 'You choose where the copy goes next.'
            : 'The copy goes to your downloads folder, under a name the browser decides.'}
        </p>

        <div className="save-review">
          {changes === null ? (
            <p className="save-review__empty">
              Nothing differs from {fileName}: the copy holds the same sequence, features and name.
            </p>
          ) : (
            <>
              <p className="save-review__summary">
                {describeEditDiff(changes) === '' ? 'Changed' : describeEditDiff(changes)}
              </p>
              {changes.renamed && (
                <p className="save-review__note">
                  Renamed from “{origin.doc.name}” to “{current.name}”.
                </p>
              )}
              {changes.topologyChanged && (
                <p className="save-review__note">
                  Made {current.topology === 'circular' ? 'circular' : 'linear'}.
                </p>
              )}
              {shown.map((hunk) => (
                <div key={`${hunk.start}-${hunk.end}`} className="diff-strip">
                  <p className="diff-strip__label">
                    <span className="diff-strip__where">
                      around {(hunk.changeStart + 1).toLocaleString()}
                    </span>{' '}
                    {describeHunk(hunk)}
                  </p>
                  <div className="diff-strip__scroll">
                    <DiffStrip doc={current} diff={changes} hunk={hunk} />
                  </div>
                </div>
              ))}
              {hunks.length > shown.length && (
                <p className="save-review__note">
                  and {(hunks.length - shown.length).toLocaleString()} more{' '}
                  {hunks.length - shown.length === 1 ? 'place' : 'places'} not shown.
                </p>
              )}
              {featureRows.length > 0 && (
                <div className="save-review__features">
                  <h3 className="save-review__heading">Features</h3>
                  <ul>
                    {featureRows.map((row) => (
                      <li key={row.key}>
                        {row.mark !== '' && (
                          <span className={`save-review__mark ${MARK_CLASS[row.mark]}`}>
                            {row.mark}
                          </span>
                        )}{' '}
                        {row.text}
                        {row.where !== '' && (
                          <span className="save-review__where"> {row.where}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="dialog__actions">
          <button
            ref={saveRef}
            type="button"
            className="button button--primary"
            onClick={() => {
              report(persistence.confirmSaveReview());
            }}
          >
            Download
          </button>
          <button
            type="button"
            className="button button--quiet"
            onClick={() => {
              editorStore.dismissSaveReview();
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
