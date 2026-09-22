import { useState } from 'react';

import { openGuide } from '../help/openGuide';
import { editorStore } from '../state/editorStore';
import { persistence } from '../state/persistence';
import { rememberStorageChoice } from '../state/storageChoice';
import { useEditorState } from '../state/useEditorStore';

/**
 * Where the banner is: asking, waiting for the browser's answer, or
 * reporting that the browser said no.
 */
type Phase = 'ask' | 'pending' | 'declined';

/**
 * Explains the browser's "store data in persistent storage" question before
 * it is asked, and asks it from a click.
 *
 * Nothing here is a file: documents live in the browser's storage, which a
 * browser may clear when disk space runs low. Asking it to keep them is the
 * protection, and in Firefox that request is a dialog the user has to
 * answer. Made from a fresh page it reads as the site wanting something;
 * made from a button under a sentence saying why, it reads as confirmation.
 * The browser's answer is reported rather than assumed, because Chromium
 * decides for itself and says no in silence.
 */
export function StorageNotice() {
  const { storageNotice } = useEditorState();
  const [phase, setPhase] = useState<Phase>('ask');
  if (!storageNotice) return null;

  const dismiss = (): void => {
    editorStore.dismissStorageNotice();
  };

  if (phase === 'declined') {
    return (
      <div className="copy-banner copy-banner--notice" role="status">
        <span className="copy-banner__text">
          The browser did not agree to keep them for now. Your documents are still here, but
          download the ones you want to be sure of.
        </span>
        <button
          type="button"
          className="copy-banner__link"
          onClick={() => {
            openGuide('02-files#local-storage-and-recent-files');
          }}
        >
          Why, and what helps
        </button>
        <button type="button" className="copy-banner__link" onClick={dismiss}>
          Got it
        </button>
      </div>
    );
  }

  return (
    <div className="copy-banner copy-banner--notice" role="status">
      <span className="copy-banner__text">
        Your documents are kept in <strong>this browser</strong>, not in files, and nothing is
        uploaded. Ask the browser to keep them so they are not cleared when disk space runs low; it
        may ask you to confirm.
      </span>
      <button
        type="button"
        className="copy-banner__link"
        disabled={phase === 'pending'}
        onClick={() => {
          setPhase('pending');
          rememberStorageChoice('keep');
          void persistence.keepStorage().then((kept) => {
            if (kept) dismiss();
            else setPhase('declined');
          });
        }}
      >
        Keep my documents
      </button>
      <button
        type="button"
        className="copy-banner__link"
        disabled={phase === 'pending'}
        onClick={() => {
          rememberStorageChoice('no');
          dismiss();
        }}
      >
        Not now
      </button>
      <button
        type="button"
        className="copy-banner__link"
        onClick={() => {
          openGuide('02-files#local-storage-and-recent-files');
        }}
      >
        What this means
      </button>
    </div>
  );
}
