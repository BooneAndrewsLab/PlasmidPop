import { useMemo, useState } from 'react';

import {
  coveredText,
  type FeatureVerdict,
  sortVerdicts,
  statusText,
  strandsText,
  type VerdictKindValue,
  type VerdictOrder,
  verdictPositionText,
  verdictsTsv,
} from '../alignmentVerdict';
import { copyText } from '../clipboard';

interface Props {
  /** Every feature's verdict, in document order. */
  readonly verdicts: readonly FeatureVerdict[];
  readonly order: VerdictOrder;
  readonly onOrder: (order: VerdictOrder) => void;
  /** Bring a feature into view. */
  readonly onPick: (verdict: FeatureVerdict) => void;
}

/** A mark beside the status word, so the status is not told by colour alone. */
const MARK: Record<VerdictKindValue, string> = {
  confirmed: '✓',
  differences: '✕',
  partial: '~',
  'not-covered': '○',
};

function segmentedClass(active: boolean): string {
  return `segmented__button${active ? ' segmented__button--active' : ''}`;
}

/**
 * Every feature's verification as a table (#120): one feature per row with
 * its status, place and the reads behind it, in document order or with the
 * ones needing a look first. Like the differences list (#121), each row's
 * name is a button (keyboard access) and clicking anywhere on the row does
 * the same; Copy writes the table as tab-separated text.
 */
export function AlignmentVerdictTable({ verdicts, order, onOrder, onPick }: Props) {
  const [copied, setCopied] = useState(false);
  const [current, setCurrent] = useState<FeatureVerdict | null>(null);
  const rows = useMemo(() => sortVerdicts(verdicts, order), [verdicts, order]);
  const pick = (v: FeatureVerdict): void => {
    setCurrent(v);
    onPick(v);
  };
  return (
    <section className="astack-diffs" aria-label="All features">
      <div className="astack-diffs__bar">
        <span className="astack-tools__note">
          {`${verdicts.length.toLocaleString()} ${verdicts.length === 1 ? 'feature' : 'features'}. Click a row to show it.`}
        </span>
        <div className="segmented" role="group" aria-label="Order of the features">
          <button
            type="button"
            className={segmentedClass(order === 'position')}
            aria-pressed={order === 'position'}
            title="In the order they sit in the document"
            onClick={() => {
              onOrder('position');
            }}
          >
            By position
          </button>
          <button
            type="button"
            className={segmentedClass(order === 'status')}
            aria-pressed={order === 'status'}
            title="Differences first, then partly covered, not covered, and confirmed last"
            onClick={() => {
              onOrder('status');
            }}
          >
            Problems first
          </button>
        </div>
        <button
          type="button"
          className="button button--small"
          title="Copy the table as tab-separated text"
          onClick={() => {
            copyText(verdictsTsv(rows));
            setCopied(true);
          }}
        >
          Copy
        </button>
        <span className="astack-tools__note" role="status">
          {copied ? 'Copied.' : ''}
        </span>
      </div>
      <div className="astack-diffs__scroll astack-verdict-table__scroll">
        <table
          className="astack-diffs__table astack-verdict-table"
          aria-label="Feature verification"
        >
          <thead>
            <tr>
              <th scope="col">Status</th>
              <th scope="col">Feature</th>
              <th scope="col">Type</th>
              <th scope="col" className="astack-verdict-table__num">
                Position
              </th>
              <th
                scope="col"
                className="astack-verdict-table__num"
                title="The fewest reads at good quality over the feature's bases"
              >
                Reads
              </th>
              <th scope="col" title="Which strands the covering reads come from">
                Strands
              </th>
              <th scope="col" className="astack-verdict-table__num">
                Bases covered
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v, i) => (
              <tr
                key={i}
                className={`astack-verdict-table__row--${v.kind}${v === current ? ' astack-diffs__row--current' : ''}`}
                aria-current={v === current ? 'true' : undefined}
                onClick={() => {
                  pick(v);
                }}
              >
                <td className="astack-verdict-table__status">
                  <span className="astack-verdict-table__mark" aria-hidden="true">
                    {MARK[v.kind]}
                  </span>{' '}
                  {statusText(v)}
                </td>
                <td>
                  <button
                    type="button"
                    className="astack-diffs__go"
                    title="Show this feature in the alignment"
                    onClick={(e) => {
                      e.stopPropagation();
                      pick(v);
                    }}
                  >
                    {v.name}
                  </button>
                </td>
                <td>{v.type}</td>
                <td className="astack-verdict-table__num">{verdictPositionText(v)}</td>
                <td className="astack-verdict-table__num">{v.reads.toLocaleString()}</td>
                <td>{strandsText(v)}</td>
                <td className="astack-verdict-table__num">{coveredText(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
