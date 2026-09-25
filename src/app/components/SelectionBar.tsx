import { useState } from 'react';

import { type Range, type SeqDocument, fragmentFromRange, rangeLength } from '@/core';

import { analytics } from '../analytics';
import { copyFragment } from '../clipboard';
import { editorStore } from '../state/editorStore';
import { BaseStyleMenu } from './BaseStyleMenu';

interface Props {
  readonly doc: SeqDocument;
  readonly selection: Range;
  /** Where the bar goes, in the view's scrolled coordinates. */
  readonly left: number;
  readonly top: number;
  /** Which way the Style menu opens: away from the selection, into the room there is. */
  readonly menuOpens: 'up' | 'down';
}

/**
 * What can be done with the selected bases, floating beside them (#89):
 * style them, annotate them, copy them. The same actions are in the edit
 * bar and on the keyboard; this is where the eye already is. Desktop only:
 * a phone has its own long-press Copy, and no room to spare over its bases.
 */
export function SelectionBar({ doc, selection, left, top, menuOpens }: Props) {
  const [copied, setCopied] = useState<Range | null>(null);
  const isCopied = copied?.start === selection.start && copied.end === selection.end;
  const length = rangeLength(selection);
  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selected bases"
      style={{ left, top }}
      // A press on the bar is not a press on the bases under it.
      onPointerDown={(e) => {
        e.stopPropagation();
      }}
    >
      <BaseStyleMenu doc={doc} selection={selection} opens={menuOpens} shortcut={false} />
      <button
        type="button"
        className="button button--small"
        title="Annotate the selected bases as a new feature"
        onClick={() => {
          analytics.track('selection-bar', 'add-feature');
          editorStore.addFeatureFromSelection();
        }}
      >
        Add feature
      </button>
      <button
        type="button"
        className="button button--small"
        title="Copy the selected bases with their features (Ctrl+C)"
        onClick={() => {
          analytics.track('selection-bar', 'copy');
          copyFragment(fragmentFromRange(doc, selection));
          setCopied(selection);
        }}
      >
        {isCopied ? 'Copied' : 'Copy'}
      </button>
      <span className="selection-bar__length">{length.toLocaleString()} bp</span>
    </div>
  );
}
