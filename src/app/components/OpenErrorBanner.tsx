import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/**
 * Why a file would not open (#457), across the top of the workspace: the
 * whole message, wrapped, staying until it is dismissed or something opens.
 * The status bar's line was small, cut off with an ellipsis and faded on a
 * countdown, and people retried the same file because they never read it.
 */
export function OpenErrorBanner() {
  const { openError } = useEditorState();
  if (openError === null) return null;

  return (
    <div className="open-error" role="alert">
      <span className="open-error__text">{openError}</span>
      <button
        type="button"
        className="open-error__link"
        onClick={() => {
          openGuide('02-files#formats');
        }}
      >
        Supported formats
      </button>
      <button
        type="button"
        className="open-error__dismiss"
        aria-label="Dismiss"
        onClick={() => {
          editorStore.dismissOpenError();
        }}
      >
        ×
      </button>
    </div>
  );
}
