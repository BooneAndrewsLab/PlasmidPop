import { useEffect, useMemo, useRef } from 'react';

import {
  alignToDocument,
  applyAlignment,
  diffDocuments,
  documentChecksum,
  isEmptyDiff,
  isIdentityAlignment,
} from '@/core';

import { analytics } from '../analytics';
import { describeAlignment } from '../compare';
import { openFile } from '../openFile';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';
import { DiffReview } from './DiffReview';

/**
 * What the document in front differs from in another file or another tab —
 * the same review a working copy gets before it is downloaded, asked of
 * something other than the one this document came from.
 *
 * It answers the question a plasmid map cannot: is this the same construct
 * as the one in that file, and if not, where do they part company. Nothing
 * is opened, written or stored; the other file is read, diffed and dropped,
 * unless it is opened from here as File ▸ Open would open it, or the other
 * side is kept as the edit marks' baseline ("Mark in the views", #37).
 *
 * The file is lined up with this document before it is diffed. Two files can
 * hold the same plasmid and share no text at all, because a circle has no
 * first base: `alignToDocument` works out the rotation (and the strand) and
 * the dialog says what it did, since the diff shown is then against the file
 * turned rather than against the file as written.
 *
 * The diff is computed here rather than through `editDiffBetween`, whose
 * one-slot cache belongs to the sequence view's own marks: this pair would
 * evict that one on every render and be evicted straight back.
 */
export function CompareDialog() {
  const state = useEditorState();
  const comparison = state.comparison?.stage === 'review' ? state.comparison : null;
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

  const file = comparison?.doc ?? null;
  const alignment = useMemo(
    () => (file === null || current === null ? null : alignToDocument(current, file)),
    [file, current],
  );
  const turned = alignment !== null && !isIdentityAlignment(alignment);
  const other = useMemo(
    () => (file === null || alignment === null || !turned ? file : applyAlignment(file, alignment)),
    [file, alignment, turned],
  );
  const diff = useMemo(
    () => (other === null || current === null ? null : diffDocuments(other, current)),
    [other, current],
  );
  const checksums = useMemo(
    () =>
      file === null || current === null
        ? null
        : { mine: documentChecksum(current), theirs: documentChecksum(file) },
    [file, current],
  );

  if (comparison === null || current === null || other === null || file === null) return null;
  const { name, source } = comparison;
  const changes = diff === null || isEmptyDiff(diff) ? null : diff;
  const sameLength = other.length === current.length;
  const sameMolecule =
    checksums !== null && checksums.mine !== null && checksums.mine.text === checksums.theirs?.text;

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
          “{current.name}” compared with {name}
        </h2>
        <p id="compare-body" className="dialog__body">
          What this document has that <strong>{name}</strong> does not, in this document’s own
          coordinates.{' '}
          {source.kind === 'file'
            ? 'Neither file is changed, and nothing was opened or stored.'
            : 'Neither document is changed.'}
        </p>

        {checksums?.mine != null && checksums.theirs != null && (
          <dl className="compare-checksums">
            <div>
              <dt>{current.name === '' ? 'This document' : current.name}</dt>
              <dd>
                <code>{checksums.mine.text}</code>
              </dd>
            </div>
            <div>
              <dt>{name}</dt>
              <dd>
                <code className={sameMolecule ? 'compare-checksums__same' : undefined}>
                  {checksums.theirs.text}
                </code>
              </dd>
            </div>
          </dl>
        )}

        {checksums?.theirs != null &&
          current.metadata.derivedFrom?.checksum === checksums.theirs.text && (
            <p className="save-review__note">
              This is the molecule this document was derived from, so what follows is everything
              that has happened to it since.
            </p>
          )}

        {alignment !== null && turned && (
          <p className="save-review__note">{describeAlignment(alignment, name)}</p>
        )}

        <div className="save-review">
          {changes === null ? (
            <p className="save-review__empty">
              Nothing {turned ? 'else ' : ''}differs: the same {current.length.toLocaleString()} bp,
              the same features and the same name.
            </p>
          ) : (
            <DiffReview doc={current} baseline={other} diff={changes} />
          )}
          {changes?.coarse === true && !turned && sameLength && current.topology === 'circular' && (
            <p className="save-review__note">
              Both are {current.length.toLocaleString()} bp but read as different throughout, and
              nothing long enough to go on is shared, so they could not be lined up. That is what
              the same plasmid looks like when the two files start it at different origins and it
              has been heavily edited since — set this document’s origin to match and compare again.
            </p>
          )}
        </div>

        <div className="dialog__actions">
          <button
            type="button"
            className="button"
            title="Open the other side in its own tab"
            onClick={() => {
              analytics.track('compare', 'open-other', source.kind);
              editorStore.dismissComparison();
              if (source.kind === 'tab') editorStore.activateDocument(source.documentId);
              else void openFile(source.file);
            }}
          >
            {source.kind === 'file' ? `Open ${name}` : `Go to ${name}`}
          </button>
          <button
            type="button"
            className="button"
            title={`Mark what this document has that ${name} does not in the sequence view and the map, as the Edits menu marks changes`}
            onClick={() => {
              analytics.track('compare', 'mark-in-views');
              editorStore.markComparedInViews(name, other);
            }}
          >
            Mark in the views
          </button>
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
