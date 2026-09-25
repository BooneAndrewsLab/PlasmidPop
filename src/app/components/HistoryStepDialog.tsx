import { useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

import { type SeqDocument, diffDocuments, isUnchanged } from '@/core';

import { DiffReview } from './DiffReview';

interface Props {
  /** The state before the step. */
  readonly before: SeqDocument;
  /** The state the step led to, whose coordinates the review is in. */
  readonly after: SeqDocument;
  /** Which step it is: its number, and its name when it has one. */
  readonly title: string;
  /** What the step was, as the History list labels it. */
  readonly label: string;
  readonly onClose: () => void;
}

/**
 * What one step of the History changed (#4): the state before it against the
 * state after it, read as the download review and Compare with… read a pair
 * of documents, through the same `DiffReview`. Nothing is changed and nothing
 * is jumped to; Close or Escape puts it away.
 */
export function HistoryStepDialog({ before, after, title, label, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);

  const diff = useMemo(() => diffDocuments(before, after), [before, after]);
  const changes = isUnchanged(diff) ? null : diff;

  // Out of the sidebar, so nothing it sets on its boxes can hold the dialog in.
  return createPortal(
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-step-title"
        aria-describedby="history-step-body"
      >
        <h2 id="history-step-title" className="dialog__title">
          What {title} changed
        </h2>
        <p id="history-step-body" className="dialog__body">
          <strong>{label}</strong>: the document just before this step compared with just after it,
          in the coordinates of after. Nothing is changed or undone by looking.
        </p>
        <div className="save-review">
          {changes === null ? (
            <p className="save-review__empty">
              Nothing that the review shows: the same {after.length.toLocaleString()} bp, the same
              features and the same name. The step changed something else about the document, such
              as its description or its ends.
            </p>
          ) : (
            <DiffReview doc={after} baseline={before} diff={changes} />
          )}
        </div>
        <div className="dialog__actions">
          <button ref={closeRef} type="button" className="button button--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
