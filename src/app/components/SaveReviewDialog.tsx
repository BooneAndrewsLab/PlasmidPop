import { useEffect, useMemo, useRef } from 'react';

import { isEmptyDiff } from '@/core';
import { supportsFileSystemAccess } from '@/storage';

import { editDiffBetween } from '../state/editDiff';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';
import { DiffReview } from './DiffReview';

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

  if (saveReview === null || origin === null || current === null) return null;
  const { fileName } = saveReview;
  // Without the File System Access API there is no save dialog: the file
  // goes to the downloads folder under a name the browser decides, so say
  // that rather than promising to ask where to put it.
  const picker = supportsFileSystemAccess();
  // Null both when the versions are identical and when nothing about them is
  // worth marking, so the body below has one case to handle rather than two.
  const changes = diff === null || isEmptyDiff(diff) ? null : diff;
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
            <DiffReview doc={current} baseline={origin.doc} diff={changes} />
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
