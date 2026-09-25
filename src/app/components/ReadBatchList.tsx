import { useState } from 'react';

import { type BatchOrder, type BatchRow, sortRows, summarizeRow } from '../readBatch';

const NEXT_ORDER: Readonly<Record<BatchOrder, BatchOrder>> = {
  file: 'identity-low',
  'identity-low': 'identity-high',
  'identity-high': 'file',
};

/**
 * A batch of reads aligned against the document (#59): one row a read, with
 * its identity, its differences on confident bases and the stretch of the
 * document it covers. Picking a row shows its alignment below.
 */
export function ReadBatchList({
  rows,
  confidentFrom,
  selected,
  onSelect,
}: {
  rows: readonly BatchRow[];
  confidentFrom: number;
  /** The index (in the file) of the row whose alignment is shown. */
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const [order, setOrder] = useState<BatchOrder>('file');
  const sorted = sortRows(rows, order, confidentFrom);
  const withQualities = rows.some((r) => r.status === 'aligned' && r.result.qualities !== null);
  return (
    <table className="read-batch">
      <thead>
        <tr>
          <th scope="col">Read</th>
          <th
            scope="col"
            aria-sort={
              order === 'file' ? 'none' : order === 'identity-low' ? 'ascending' : 'descending'
            }
          >
            <button
              type="button"
              className="read-batch__sort"
              title="Sort by identity: lowest first, then highest first, then as in the file"
              onClick={() => {
                setOrder((o) => NEXT_ORDER[o]);
              }}
            >
              Identity{order === 'identity-low' ? ' ▲' : order === 'identity-high' ? ' ▼' : ''}
            </button>
          </th>
          <th
            scope="col"
            title={
              withQualities
                ? `Differences at bases of Q${confidentFrom} or better; a read without qualities counts all of its differences`
                : 'Mismatches and gap columns'
            }
          >
            {withQualities ? `Q${confidentFrom}+ diffs` : 'Diffs'}
          </th>
          <th scope="col">Covers</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((row) => {
          const picked = row.index === selected;
          if (row.status === 'failed') {
            return (
              <tr key={row.index} className="read-batch__row read-batch__row--failed">
                <th scope="row">
                  {row.name}
                  <span className="read-batch__sub">{row.length.toLocaleString()} bp</span>
                </th>
                <td colSpan={3}>{row.message}</td>
              </tr>
            );
          }
          const s = summarizeRow(row, confidentFrom);
          return (
            <tr
              key={row.index}
              className={`read-batch__row${picked ? ' read-batch__row--picked' : ''}`}
            >
              <th scope="row">
                <button
                  type="button"
                  className="read-batch__pick"
                  aria-pressed={picked}
                  onClick={() => {
                    onSelect(row.index);
                  }}
                >
                  {row.name}
                </button>
                <span className="read-batch__sub">
                  {row.length.toLocaleString()} bp
                  {row.result.strand === 'reverse' ? ', reversed' : ''}
                </span>
              </th>
              <td>{Math.round(s.identity * 1000) / 10}%</td>
              <td>{s.confident ?? s.differences}</td>
              <td>
                {s.span === null
                  ? '—'
                  : `${s.span.from.toLocaleString()}–${s.span.to.toLocaleString()}`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
