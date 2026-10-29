import type { CSSProperties } from 'react';

import { REMOVAL_HOLD_MS } from '@/storage';

import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/**
 * The toasts that follow a Remove from the stored documents (item 111):
 * what went, and Undo until the hold runs out. One per removal, stacked
 * with the newest at the bottom (#322), each with its own Undo and time.
 * Each carries a ring that drains over the hold (decoration; a CSS
 * animation, no timer of its own, and the duration is the hold's constant).
 * They belong to the app, not to the Files page, so they stay when the
 * page is left.
 */
export function RemovalNotice() {
  const { removalNotices } = useEditorState();
  if (removalNotices.length === 0) return null;
  return (
    <div className="undo-toasts">
      {removalNotices.map(({ key, message }) => (
        <div key={key} className="undo-toast" role="status">
          <svg
            className="undo-toast__ring"
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            style={{ '--undo-hold': `${REMOVAL_HOLD_MS}ms` } as CSSProperties}
          >
            <circle className="undo-toast__ring-track" cx="10" cy="10" r="8" />
            <circle className="undo-toast__ring-drain" cx="10" cy="10" r="8" pathLength="100" />
          </svg>
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
