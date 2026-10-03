import { SAMPLE_SORTS, type SampleSort } from '../alignmentOrder';
import { AlignmentPopover } from './AlignmentPopover';

interface Props {
  /** Every sample's name, shown or not, in the order they were aligned. */
  readonly names: readonly string[];
  readonly sort: SampleSort;
  readonly onSort: (sort: SampleSort) => void;
  readonly hidden: ReadonlySet<number>;
  readonly onShow: (sample: number) => void;
  readonly onShowAll: () => void;
  readonly onClose: () => void;
}

/**
 * The popover of the status row's Samples button (#127): how the samples are
 * ordered, and which are hidden, each with a way back. Hiding a sample is
 * done from the status row, on the picked one.
 */
export function AlignmentSamples({
  names,
  sort,
  onSort,
  hidden,
  onShow,
  onShowAll,
  onClose,
}: Props) {
  const hiddenList = [...hidden].filter((i) => i < names.length).sort((a, b) => a - b);
  return (
    <AlignmentPopover
      title="Sort and hide samples"
      closeLabel="Close samples"
      onClose={onClose}
      className="astack-pop--samples"
    >
      <div className="astack-pop__form">
        <label>
          Sort by
          <select
            className="astack-pop__input"
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
      </div>
      <div className="astack-pop__section">
        <span className="astack-pop__subhead" aria-live="polite">
          {hiddenList.length === 0
            ? 'No samples hidden'
            : `Hidden: ${hiddenList.length.toLocaleString()} of ${names.length.toLocaleString()}`}
        </span>
        {hiddenList.length > 0 && (
          <button type="button" className="button astack-pop__button" onClick={onShowAll}>
            Show all
          </button>
        )}
      </div>
      {hiddenList.length === 0 ? (
        <p className="astack-pop__hint">Pick a sample and choose Hide to take it out.</p>
      ) : (
        <ul className="astack-pop__list" aria-label="Hidden samples">
          {hiddenList.map((i) => (
            <li key={i}>
              <span className="astack-pop__name" title={names[i]}>
                {names[i]}
              </span>
              <button
                type="button"
                className="button button--quiet astack-pop__button"
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
    </AlignmentPopover>
  );
}
