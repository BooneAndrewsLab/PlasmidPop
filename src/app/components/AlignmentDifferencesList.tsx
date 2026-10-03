import { useState } from 'react';

import {
  changeText,
  differencesTsv,
  effectText,
  featureText,
  positionText,
  qualityText,
  samplesText,
  type DifferenceRow,
} from '../alignmentDifferences';
import { copyText } from '../clipboard';

interface Props {
  readonly rows: readonly DifferenceRow[];
  /** The region index last jumped to, marked in the table. */
  readonly current: number | null;
  /** Go to a region and pick one of the samples that carries it. */
  readonly onPick: (row: DifferenceRow) => void;
}

/**
 * The differences as a table (#121). Each row's position is a button, so the
 * list is reachable and usable from the keyboard; clicking anywhere on the
 * row does the same. Copy writes the whole table as tab-separated text.
 */
export function AlignmentDifferencesList({ rows, current, onPick }: Props) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="astack-diffs" aria-label="List of differences">
      <div className="astack-diffs__bar">
        <span className="astack-tools__note">
          {rows.length === 0
            ? 'No differences.'
            : `${rows.length.toLocaleString()} ${rows.length === 1 ? 'difference' : 'differences'}. Click a row to go to it.`}
        </span>
        <button
          type="button"
          className="button button--small"
          disabled={rows.length === 0}
          title="Copy the table as tab-separated text"
          onClick={() => {
            copyText(differencesTsv(rows));
            setCopied(true);
          }}
        >
          Copy
        </button>
        <span className="astack-tools__note" role="status">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
      {rows.length > 0 && (
        <div className="astack-diffs__scroll">
          <table className="astack-diffs__table" aria-label="Differences">
            <thead>
              <tr>
                <th scope="col">Position</th>
                <th scope="col">Change</th>
                <th scope="col">Samples</th>
                <th scope="col">Feature</th>
                <th scope="col">Quality</th>
                <th scope="col">Protein effect</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.index}
                  className={row.index === current ? 'astack-diffs__row--current' : undefined}
                  aria-current={row.index === current ? 'true' : undefined}
                  onClick={() => {
                    onPick(row);
                  }}
                >
                  <td>
                    <button
                      type="button"
                      className="astack-diffs__go"
                      title="Show this difference in the alignment"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPick(row);
                      }}
                    >
                      {positionText(row) === '' ? 'insertion' : positionText(row)}
                    </button>
                  </td>
                  <td className="astack-diffs__bases">{changeText(row)}</td>
                  <td>{samplesText(row)}</td>
                  <td>{featureText(row)}</td>
                  <td>{qualityText(row)}</td>
                  <td>{effectText(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
