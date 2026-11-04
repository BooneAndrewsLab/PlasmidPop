import { useState } from 'react';

import { analytics } from '../analytics';

interface Props {
  /** Where the bar goes, in the scroller's content coordinates. */
  readonly left: number;
  readonly top: number;
  /** How many columns are selected. */
  readonly columns: number;
  /** Whether the Advanced copy panel this bar opens is open. */
  readonly advancedOpen: boolean;
  /** Copy the selected residues, as Ctrl+C does. */
  readonly onCopy: () => void;
  /** Open (or close) the Advanced copy panel; `bar` is this bar's element, for the panel to hang from. */
  readonly onAdvanced: (bar: HTMLElement) => void;
}

/**
 * What can be done with the selected run in the large view, floating beside
 * it as on the sequence view (#366): copy the residues, or open the panel
 * that composes a copy from options. The keys do the same from the
 * scroller; this is where the eye already is. Not drawn while the pointer
 * is still dragging, so it never sits under the hand.
 */
export function AlignmentSelectionBar({
  left,
  top,
  columns,
  advancedOpen,
  onCopy,
  onAdvanced,
}: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const place = `${left},${top},${columns}`;
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selected residues"
      style={{ left, top }}
      // A press on the bar is not a press on the alignment under it.
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <button
        type="button"
        className="button button--small"
        data-tip="Copy the selected residues, gaps left out (Ctrl+C)"
        onClick={() => {
          analytics.track('alignment-selection', 'copy', 'bar');
          onCopy();
          setCopied(place);
        }}
      >
        {copied === place ? 'Copied' : 'Copy'}
      </button>
      <button
        type="button"
        className="button button--small"
        aria-expanded={advancedOpen}
        data-tip="Choose rows, columns, gaps, amino acids and the format, with a preview"
        onClick={(e) => {
          const bar = e.currentTarget.closest('.selection-bar');
          if (bar instanceof HTMLElement) onAdvanced(bar);
        }}
      >
        Advanced copy…
      </button>
      <span className="selection-bar__length">
        {columns.toLocaleString()} {columns === 1 ? 'column' : 'columns'}
      </span>
    </div>
  );
}
