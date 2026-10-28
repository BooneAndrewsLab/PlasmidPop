import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { useEditorState } from '../state/useEditorStore';

/**
 * The toast that follows a Remove from the stored documents (item 111):
 * what went, and Undo until the hold runs out. It belongs to the app, not
 * to the Files page, so it stays when the page is left.
 */
export function RemovalNotice() {
  const { removalNotice } = useEditorState();
  if (removalNotice === null) return null;
  return (
    <div className="undo-toast" role="status">
      <span className="undo-toast__text">{removalNotice}</span>
      <button
        type="button"
        className="undo-toast__button"
        onClick={() => {
          persistence.undoRemoval();
        }}
      >
        Undo
      </button>
      <button
        type="button"
        className="undo-toast__button"
        aria-label="Dismiss"
        onClick={() => {
          editorStore.dismissRemovalNotice();
        }}
      >
        ×
      </button>
    </div>
  );
}
