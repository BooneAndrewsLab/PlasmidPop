import { type CSSProperties, useState } from 'react';

import { REMOVAL_HOLD_MS } from '@/storage';

import { editorStore, foldRemovalNotices } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/**
 * The ring that drains over a removal's hold (decoration; a CSS animation,
 * no timer of its own, and the duration is the hold's constant). The time
 * already gone is a negative animation delay, read once when the ring is
 * drawn, so a ring drawn again (a removal moving out of the fold, or the
 * fold's ring following another removal) shows the time that removal has
 * left rather than starting over.
 */
function HoldRing({ at }: { at: number }) {
  const [gone] = useState(() => Math.max(0, Date.now() - at));
  return (
    <svg
      className="undo-toast__ring"
      viewBox="0 0 20 20"
      aria-hidden="true"
      focusable="false"
      style={
        { '--undo-hold': `${REMOVAL_HOLD_MS}ms`, '--undo-gone': `${-gone}ms` } as CSSProperties
      }
    >
      <circle className="undo-toast__ring-track" cx="10" cy="10" r="8" />
      <circle className="undo-toast__ring-drain" cx="10" cy="10" r="8" pathLength="100" />
    </svg>
  );
}

/**
 * The toasts that follow a Remove from the stored documents (item 111):
 * what went, and Undo until the hold runs out. One per removal, stacked
 * with the newest at the bottom (#322), each with its own Undo and time.
 * Past `REMOVAL_NOTICE_LIMIT` the older removals fold into one row above
 * them, with one button that undoes each of them (#322): a removal the user
 * did not dismiss keeps an Undo for as long as it is held. Toasts are keyed
 * by removal, so a toast's ring is not restarted when others come and go.
 * They belong to the app, not to the Files page, so they stay when the
 * page is left.
 */
export function RemovalNotice() {
  const { removalNotices } = useEditorState();
  if (removalNotices.length === 0) return null;
  const { shown, folded } = foldRemovalNotices(removalNotices);
  const soonest = folded.reduce<(typeof folded)[number] | undefined>(
    (first, r) => (first === undefined || r.at < first.at ? r : first),
    undefined,
  );
  return (
    <div className="undo-toasts">
      {soonest !== undefined && (
        <div className="undo-toast undo-toast--fold" role="status">
          <HoldRing key={soonest.key} at={soonest.at} />
          <span className="undo-toast__text">
            +{folded.length} earlier {folded.length === 1 ? 'removal' : 'removals'}
          </span>
          <button
            type="button"
            className="undo-toast__button"
            onClick={() => {
              for (const { key } of folded) persistence.undoRemoval(key);
            }}
          >
            {folded.length === 1 ? 'Undo' : 'Undo all'}
          </button>
        </div>
      )}
      {shown.map(({ key, message, at }) => (
        <div key={key} className="undo-toast" role="status">
          <HoldRing at={at} />
          <span className="undo-toast__text">{message}</span>
          <button
            type="button"
            className="undo-toast__button"
            onClick={() => {
              persistence.undoRemoval(key);
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="undo-toast__button"
            aria-label="Dismiss"
            onClick={() => {
              editorStore.dismissRemovalNotice(key);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
