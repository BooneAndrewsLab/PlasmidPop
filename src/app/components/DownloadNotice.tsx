import { useState } from 'react';

import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** Remembers that the user has read the notice, so it is said once, not at every save. */
const SEEN_KEY = 'plasmidpop.downloadNoticeSeen';

function wasSeen(): boolean {
  try {
    return globalThis.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false; // Storage unavailable (private mode, blocked cookies).
  }
}

function rememberSeen(): void {
  try {
    globalThis.localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Best effort, like the rest of local persistence.
  }
}

/**
 * What happened to a save that had to go out as a download: where the file
 * went, and that the next save will not replace it.
 *
 * In Firefox and Safari a page may not ask where a file goes, so a download
 * lands wherever the browser puts it, named by the browser: the second one
 * is `…(1).gb` beside the first rather than over it. Nothing in here can
 * change that — but a user who is not told finds out by accumulating files,
 * so this says it once, points at the guide for the way to keep a single
 * file, and then stays out of the way.
 */
export function DownloadNotice() {
  const { downloadNotice } = useEditorState();
  const [seen, setSeen] = useState(wasSeen);
  if (downloadNotice === null || seen) return null;

  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">
        Downloaded <strong>{downloadNotice.fileName}</strong>. This browser chooses where downloads
        go, so downloading again puts another file beside it rather than replacing it.
      </span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          openGuide('02-files#downloading-in-firefox-and-safari');
        }}
      >
        How to keep one file
      </button>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          rememberSeen();
          setSeen(true);
          editorStore.dismissDownloadNotice();
        }}
      >
        Got it
      </button>
    </div>
  );
}
