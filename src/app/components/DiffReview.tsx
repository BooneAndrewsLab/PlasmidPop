import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { type DiffHunk, type DocumentDiff, type SeqDocument, diffHunks } from '@/core';
import { type ChangeTarget, ghostFeatures } from '@/view/circular';

import { analytics } from '../analytics';
import { describeEditDiff } from '../editsView';
import { featureChangeRows } from '../featureChanges';
import { MAX_STRIPS, MORE_PLACES, hunkKey, reviewKeyFor } from '../reviewLines';
import { DiffMap } from './DiffMap';
import { DiffStrip } from './DiffStrip';

/** How long a line the map pointed at stays lit, in milliseconds. */
const FLASH_MS = 1600;

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

interface Props {
  /** The document the diff is in the coordinates of, and which is drawn. */
  readonly doc: SeqDocument;
  /** What it is being compared against; only its name and topology are read here. */
  readonly baseline: SeqDocument;
  readonly diff: DocumentDiff;
}

/**
 * A diff as something to read: the one-line summary, what happened to the
 * name and topology, the whole molecule with its changes marked, each
 * neighbourhood of changed bases drawn by the same renderer as the sequence
 * view, and what became of the features.
 *
 * Shared by the review before a download and by **Compare with…** so the two
 * cannot drift apart — the questions are the same one asked of a different
 * pair of documents.
 */
export function DiffReview({ doc, baseline, diff }: Props) {
  const hunks = useMemo(() => diffHunks(diff, doc.length), [diff, doc.length]);
  const featureRows = useMemo(() => featureChangeRows(diff, doc), [diff, doc]);
  const shown = hunks.slice(0, MAX_STRIPS);
  const ghosts = useMemo(() => new Set(ghostFeatures(diff).map((f) => f.id)), [diff]);

  // A click on the map finds its line and lights it for a moment; a
  // removed feature's line points back at its ghost on the map.
  const mapRef = useRef<HTMLDivElement>(null);
  const [flashed, setFlashed] = useState<string | null>(null);
  const [pointed, setPointed] = useState<ChangeTarget | null>(null);
  useEffect(() => {
    if (flashed === null) return;
    const timer = setTimeout(() => {
      setFlashed(null);
    }, FLASH_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [flashed]);
  const lit = (key: string): string => (flashed === key ? ' is-flashed' : '');

  const onPick = useCallback(
    (target: ChangeTarget): void => {
      const rowKeys = new Set(featureRows.map((r) => r.key));
      const key = reviewKeyFor(target, diff, hunks, rowKeys);
      if (key === null) return;
      analytics.trackOnce('edits', 'review-click', target.kind);
      // The review's lines are the map's siblings, each tagged with its key.
      const el = [
        ...(mapRef.current?.parentElement?.querySelectorAll('[data-review-line]') ?? []),
      ].find((e) => e.getAttribute('data-review-line') === key);
      // Guarded because jsdom, where the app's tests run, has no scrollIntoView.
      if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
      setFlashed(key);
    },
    [diff, hunks, featureRows],
  );

  const pointAt = (featureId: string): void => {
    analytics.trackOnce('edits', 'review-point');
    setPointed({ kind: 'removed', featureId });
    const map = mapRef.current;
    if (typeof map?.scrollIntoView === 'function') map.scrollIntoView({ block: 'nearest' });
  };

  return (
    <>
      <p className="save-review__summary">
        {describeEditDiff(diff) === '' ? 'Changed' : describeEditDiff(diff)}
      </p>
      {diff.reversed && (
        <p className="save-review__note">
          Turned over: the sequence now reads from what was the bottom strand, and the marks below
          are against the old version turned over too.
        </p>
      )}
      {diff.renamed && (
        <p className="save-review__note">
          Renamed from “{baseline.name}” to “{doc.name}”.
        </p>
      )}
      {diff.topologyChanged && (
        <p className="save-review__note">
          Made {doc.topology === 'circular' ? 'circular' : 'linear'}.
        </p>
      )}
      <div className="diff-map" ref={mapRef}>
        <DiffMap doc={doc} diff={diff} onPick={onPick} pointed={pointed} />
      </div>
      {shown.map((hunk) => (
        <div
          key={`${hunk.start}-${hunk.end}`}
          data-review-line={hunkKey(hunk)}
          className={`diff-strip${lit(hunkKey(hunk))}`}
        >
          <p className="diff-strip__label">
            <span className="diff-strip__where">
              around {(hunk.changeStart + 1).toLocaleString()}
            </span>{' '}
            {describeHunk(hunk)}
          </p>
          <div className="diff-strip__scroll">
            <DiffStrip doc={doc} diff={diff} hunk={hunk} />
          </div>
        </div>
      ))}
      {hunks.length > shown.length && (
        <p data-review-line={MORE_PLACES} className={`save-review__note${lit(MORE_PLACES)}`}>
          and {(hunks.length - shown.length).toLocaleString()} more{' '}
          {hunks.length - shown.length === 1 ? 'place' : 'places'} not shown.
        </p>
      )}
      {featureRows.length > 0 && (
        <div className="save-review__features">
          <h3 className="save-review__heading">Features</h3>
          <ul>
            {featureRows.map((row) => (
              <li key={row.key} data-review-line={row.key} className={lit(row.key).trim()}>
                {row.mark !== '' && (
                  <span className={`save-review__mark ${MARK_CLASS[row.mark]}`}>{row.mark}</span>
                )}{' '}
                {row.removedId !== undefined && ghosts.has(row.removedId) ? (
                  <button
                    type="button"
                    className="save-review__point"
                    title="Show where it was on the map"
                    aria-pressed={
                      pointed?.kind === 'removed' && pointed.featureId === row.removedId
                    }
                    onClick={() => {
                      if (row.removedId !== undefined) pointAt(row.removedId);
                    }}
                  >
                    {row.text}
                  </button>
                ) : (
                  row.text
                )}
                {row.where !== '' && <span className="save-review__where"> {row.where}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
