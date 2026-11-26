import { useEffect } from 'react';

import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** How long the notice stays up: it names features, so it is given time to be read. */
const LINGER_MS = 20_000;

/**
 * After a GenBank save: which features were not written as they were read
 * (trans-spliced locations kept on the forward strand, remote locations left
 * out at open), so the file is not mistaken for a copy of the original (#464).
 */
export function InexactNotice() {
  const { inexactNotice } = useEditorState();
  useEffect(() => {
    if (inexactNotice === null) return;
    const timer = setTimeout(() => {
      editorStore.dismissInexactNotice();
    }, LINGER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [inexactNotice]);
  if (inexactNotice === null) return null;

  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">{inexactNotice.message}</span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          openGuide('02-files');
        }}
      >
        About saving
      </button>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          editorStore.dismissInexactNotice();
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
