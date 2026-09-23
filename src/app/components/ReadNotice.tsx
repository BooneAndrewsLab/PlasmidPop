import { useEffect } from 'react';

import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** How long the notice stays up before it takes itself away. */
const LINGER_MS = 12_000;

/**
 * That a document's read — the base qualities and trace of the AB1 or
 * FASTQ it was opened from — was left behind, and how to get it back
 * (#49, decided in #53). An edit to the bases drops it, since it would no
 * longer describe them; a GenBank download leaves it out, since GenBank
 * has no place for it.
 */
export function ReadNotice() {
  const { readNotice } = useEditorState();
  useEffect(() => {
    if (readNotice === null) return;
    const timer = setTimeout(() => {
      editorStore.dismissReadNotice();
    }, LINGER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [readNotice]);
  if (readNotice === null) return null;

  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">
        {readNotice.kind === 'edited'
          ? 'That edit changed the bases, so the read’s qualities and trace no longer describe them and were set aside. Undo brings them back.'
          : 'GenBank holds the bases and features, not the read’s qualities or trace; those stay with the document here in the browser.'}
      </span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          openGuide('15-reads');
        }}
      >
        About reads
      </button>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          editorStore.dismissReadNotice();
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
