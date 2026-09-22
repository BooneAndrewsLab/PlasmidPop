import { useEffect, useMemo, useRef } from 'react';

import { diffDocuments, isEmptyDiff } from '@/core';

import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { DiffReview } from './DiffReview';

/**
 * What the document in front differs from in another file — the same review
 * a working copy gets before it is downloaded, asked of a file on disk
 * instead of the one this document came from.
 *
 * It answers the question a plasmid map cannot: is this the same construct
 * as the one in that file, and if not, where do they part company. Nothing
 * is opened, written or stored; the other file is read, diffed and dropped.
 *
 * The diff is computed here rather than through `editDiffBetween`, whose
 * one-slot cache belongs to the sequence view's own marks: this pair would
 * evict that one on every render and be evicted straight back.
 */
export function CompareDialog() {
  const state = useEditorState();
  const { comparison } = state;
  const current = state.history?.present ?? null;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (comparison === null) return;
    closeRef.current?.focus();
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editorStore.dismissComparison();
    };
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('keydown', esc);
    };
  }, [comparison]);

  const other = comparison?.doc ?? null;
  const diff = useMemo(
    () => (other === null || current === null ? null : diffDocuments(other, current)),
    [other, current],
  );

  if (comparison === null || current === null || other === null) return null;
  const changes = diff === null || isEmptyDiff(diff) ? null : diff;
  const sameLength = other.length === current.length;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog dialog--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compare-title"
        aria-describedby="compare-body"
      >
        <h2 id="compare-title" className="dialog__title">
          “{current.name}” compared with {comparison.fileName}
        </h2>
        <p id="compare-body" className="dialog__body">
          What this document has that <strong>{comparison.fileName}</strong> does not, in this
          document’s own coordinates. Neither file is changed, and nothing was opened or stored.
        </p>

        <div className="save-review">
          {changes === null ? (
            <p className="save-review__empty">
              Nothing differs: the same {current.length.toLocaleString()} bp, the same features and
              the same name.
            </p>
          ) : (
            <DiffReview doc={current} baseline={other} diff={changes} />
          )}
          {changes?.coarse === true && sameLength && current.topology === 'circular' && (
            <p className="save-review__note">
              Both are {current.length.toLocaleString()} bp but read as different throughout, which
              is what the same plasmid looks like when the two files start it at different origins.
              Set this document’s origin to match and compare again.
            </p>
          )}
        </div>

        <div className="dialog__actions">
          <button
            ref={closeRef}
            type="button"
            className="button button--primary"
            onClick={() => {
              editorStore.dismissComparison();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
