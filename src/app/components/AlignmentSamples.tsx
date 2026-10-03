import { SAMPLE_SORTS, type SampleSort } from '../alignmentOrder';

interface Props {
  /** Every sample's name, shown or not, in the order they were aligned. */
  readonly names: readonly string[];
  readonly sort: SampleSort;
  readonly onSort: (sort: SampleSort) => void;
  readonly hidden: ReadonlySet<number>;
  readonly onShow: (sample: number) => void;
  readonly onShowAll: () => void;
}

/**
 * The popover of the status row's Samples button (#127): how the samples are
 * ordered, and which are hidden, each with a way back. Hiding a sample is
 * done from the status row, on the picked one.
 */
export function AlignmentSamples({ names, sort, onSort, hidden, onShow, onShowAll }: Props) {
  const hiddenList = [...hidden].filter((i) => i < names.length).sort((a, b) => a - b);
  return (
    <div className="astack-find astack-samples" role="group" aria-label="Sort and hide samples">
      <label className="astack-find__label">
        Sort by
        <select
          className="input"
          aria-label="Sort samples by"
          value={sort}
          onChange={(e) => {
            const key = SAMPLE_SORTS.find((s) => s.key === e.target.value);
            if (key !== undefined) onSort(key.key);
          }}
        >
          {SAMPLE_SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <div className="astack-export__row">
        <span aria-live="polite">
          {hiddenList.length === 0
            ? 'No samples hidden. Pick one and choose Hide to take it out.'
            : `${hiddenList.length.toLocaleString()} hidden:`}
        </span>
        {hiddenList.length > 0 && (
          <button type="button" className="button button--small" onClick={onShowAll}>
            Show all
          </button>
        )}
      </div>
      {hiddenList.length > 0 && (
        <ul className="astack-samples__list" aria-label="Hidden samples">
          {hiddenList.map((i) => (
            <li key={i}>
              <span>{names[i]}</span>
              <button
                type="button"
                className="button button--quiet button--small"
                aria-label={`Show ${names[i] ?? ''}`}
                onClick={() => {
                  onShow(i);
                }}
              >
                Show
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
