import { useMemo } from 'react';

import { type DiffHunk, type DocumentDiff, type SeqDocument, diffHunks } from '@/core';

import { describeEditDiff } from '../editsView';
import { featureChangeRows } from '../featureChanges';
import { DiffMap } from './DiffMap';
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
      <div className="diff-map">
        <DiffMap doc={doc} diff={diff} />
      </div>
      {shown.map((hunk) => (
        <div key={`${hunk.start}-${hunk.end}`} className="diff-strip">
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
                  <span className={`save-review__mark ${MARK_CLASS[row.mark]}`}>{row.mark}</span>
                )}{' '}
                {row.text}
                {row.where !== '' && <span className="save-review__where"> {row.where}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
