import { DIFFERENCE_WHERE, type DifferenceFilter } from '../alignmentFilter';
import { AlignmentPopover } from './AlignmentPopover';

interface Props {
  readonly filter: DifferenceFilter;
  readonly onFilter: (filter: DifferenceFilter) => void;
  /** Whether the reference is a document with features; without one only "Anywhere" means anything. */
  readonly hasDocument: boolean;
  /** The picked sample's name, or null when none is picked. */
  readonly picked: string | null;
  readonly confidentFrom: number;
  /** How many differences are marked reviewed or taken (#123). */
  readonly reviewed: number;
  /** "12 of 41 differences", as the counter has it. */
  readonly status: string;
  readonly onClose: () => void;
}

/**
 * The Filter popover beside Next/Previous (#122): which differences the walk
 * stops at and the counter counts. The overview, the alignment and the list
 * still show every difference.
 */
export function AlignmentFilter({
  filter,
  onFilter,
  hasDocument,
  picked,
  confidentFrom,
  reviewed,
  status,
  onClose,
}: Props) {
  const set = (patch: Partial<DifferenceFilter>): void => {
    onFilter({ ...filter, ...patch });
  };
  return (
    <AlignmentPopover
      title="Stop at differences"
      closeLabel="Close filter"
      onClose={onClose}
      className="astack-pop--filter"
    >
      <div className="astack-pop__form">
        <label>
          Where
          <select
            className="astack-pop__input"
            aria-label="Stop at differences where"
            value={filter.where}
            disabled={!hasDocument}
            onChange={(e) => {
              const where = DIFFERENCE_WHERE.find((w) => w.key === e.target.value);
              if (where !== undefined) set({ where: where.key });
            }}
          >
            {DIFFERENCE_WHERE.map((w) => (
              <option key={w.key} value={w.key}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="astack-pop__checks">
        <label className="astack-pop__check">
          <input
            type="checkbox"
            checked={filter.goodQuality}
            onChange={(e) => {
              set({ goodQuality: e.target.checked });
            }}
          />
          Good quality only (Q{confidentFrom} or better)
        </label>
        <label className="astack-pop__check">
          <input
            type="checkbox"
            checked={filter.pickedOnly}
            onChange={(e) => {
              set({ pickedOnly: e.target.checked });
            }}
          />
          {picked === null ? 'In the picked sample only' : `In ${picked} only`}
        </label>
        <label className="astack-pop__check">
          <input
            type="checkbox"
            checked={filter.skipReviewed}
            onChange={(e) => {
              set({ skipReviewed: e.target.checked });
            }}
          />
          Skip reviewed
          {reviewed > 0 ? ` (${reviewed.toLocaleString()})` : ''}
        </label>
      </div>
      {filter.pickedOnly && picked === null && (
        <p className="astack-pop__hint">No sample is picked, so every sample counts.</p>
      )}
      <div className="astack-pop__foot">
        <span className="astack-pop__status" aria-live="polite">
          {status}
        </span>
      </div>
    </AlignmentPopover>
  );
}
