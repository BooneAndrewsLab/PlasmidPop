import { useEffect } from 'react';

import { openGuide } from '../help/openGuide';
import { longLinkWarning, shareNoticeText } from '../share';
import { editorStore } from '../state/editorStore';
import { useEditorState } from '../state/useEditorStore';

/** How long the notice stays up before it takes itself away. */
const LINGER_MS = 12_000;
/** Longer when it warns about the link's length: that is worth reading before pasting. */
const LINGER_WARNING_MS = 30_000;

/**
 * What a copied share link is, said once at the moment it matters.
 *
 * The link carries the whole document in its own text — nothing was
 * uploaded, so nothing can be withdrawn later. Someone about to paste it
 * into a channel should know both halves of that before they do.
 */
export function ShareNotice() {
  const { shareNotice } = useEditorState();
  useEffect(() => {
    if (shareNotice === null) return;
    const linger = longLinkWarning(shareNotice) === null ? LINGER_MS : LINGER_WARNING_MS;
    const timer = setTimeout(() => {
      editorStore.dismissShareNotice();
    }, linger);
    return () => {
      clearTimeout(timer);
    };
  }, [shareNotice]);
  if (shareNotice === null) return null;
  const warning = longLinkWarning(shareNotice);

  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">
        {shareNoticeText(shareNotice)}
        {warning !== null && <strong className="copy-banner__warning"> {warning}</strong>}
      </span>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          openGuide('02-files#sharing-a-link');
        }}
      >
        About share links
      </button>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          editorStore.dismissShareNotice();
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
