import { useEffect, useState } from 'react';

import { SHARE_TARGET_PARAM } from '@/pwa/shareTarget';

import { analytics } from '../analytics';
import { openSharedPayload, sharePayloadIn, takeShareFragment } from '../share';
import { openSharedFiles, takeShareTargetMarker } from '../sharedFiles';
import { editorStore } from './editorStore';
import { persistence } from './persistence';
import { useEditorState } from './useEditorStore';
import { startViewPrefs } from './viewPrefs';

const AUTOSAVE_MS = 500;

/**
 * Writes the open documents to IndexedDB, and which tabs are open, shortly
 * after every change to any of them (including which one is in front).
 */
export function useAutosave(): void {
  const { documents, documentId } = useEditorState();
  useEffect(() => {
    if (documents.length === 0) {
      // The last tab was closed (unless the page is still loading): come back to the file list.
      if (persistence.restoreAttempted) persistence.rememberSession();
      return;
    }
    const timer = setTimeout(() => {
      persistence.autosave().catch((e: unknown) => {
        editorStore.fail(`Could not save locally: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [documents, documentId]);
}

/**
 * Writes the Cloning tab's fragment shelf shortly after it changes. It has
 * an effect of its own because the shelf outlives the documents: closing
 * every tab must not take the gathered fragments with it.
 */
export function useAutosaveShelf(): void {
  const { shelf } = useEditorState();
  useEffect(() => {
    // Until the last session has been read back, an empty shelf is the page
    // still loading and must not be written over the stored one.
    if (!persistence.restoreAttempted) return;
    const timer = setTimeout(() => {
      persistence.saveShelf().catch((e: unknown) => {
        editorStore.fail(
          `Could not save the fragment shelf: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [shelf]);
}

/**
 * On first load, reopens the tabs that were open last time, and opens the
 * document a share link carries, if the page was opened from one.
 *
 * The fragment is taken off the address bar first thing, before any await:
 * it holds the sequence, and it has no business staying in the URL or in
 * this browser's history. Taking it also makes this safe to run twice, as
 * React does in development — the second run finds nothing.
 *
 * The shared document is opened last so it is the tab in front, with the
 * session's own tabs behind it rather than replaced by it. Files shared to
 * the installed app from another one (a mail attachment, through the Web
 * Share Target, #43) come after that, for the same reason; their marker is
 * taken off the address bar first thing too.
 *
 * Returns true while a document the page was opened with is still on its
 * way (the session is restored and the link decompressed first, which a
 * slow phone takes a moment over), so the app can say so rather than flash
 * the empty page before the document appears (#42).
 */
export function useRestoreSession(): boolean {
  // Read before the effect takes the fragment and the marker off the address bar.
  const [opening, setOpening] = useState(() => {
    const { location } = globalThis;
    return (
      sharePayloadIn(location.hash) !== null ||
      new URLSearchParams(location.search).has(SHARE_TARGET_PARAM)
    );
  });
  useEffect(() => {
    const shared = takeShareFragment();
    const sharedFiles = takeShareTargetMarker();
    void (async () => {
      // The enzymes first, and awaited, so a restored document's first scan
      // already uses the imported set rather than scanning twice.
      try {
        await persistence.restoreEnzymeSet();
      } catch {
        // No import, or storage unavailable: the bundled table stands.
      }
      if (editorStore.getState().documents.length === 0) {
        try {
          await persistence.restoreLastSession();
        } catch {
          // Nothing to restore, or storage unavailable: start empty.
        }
      }
      if (shared !== null) await openSharedPayload(shared);
      if (sharedFiles !== null) await openSharedFiles(sharedFiles);
    })().finally(() => {
      setOpening(false);
    });
  }, []);
  return opening;
}

/** Restores the remembered view switcher and toggles, and records changes to them. */
export function useViewPrefs(): void {
  useEffect(() => startViewPrefs(), []);
}

/** Ctrl/Cmd+S downloads the document (Shift too, out of habit); Ctrl/Cmd+F opens find. */
export function useSaveShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'f' && editorStore.document !== null) {
        e.preventDefault();
        analytics.shortcut('ctrl+f');
        editorStore.setFindOpen(true);
        return;
      }
      if (key !== 's') return;
      e.preventDefault();
      if (editorStore.document === null) return;
      analytics.shortcut('ctrl+s');
      // Both, because Ctrl+Shift+S was Save as… and there is now one way out.
      persistence.download().catch((err: unknown) => {
        editorStore.fail(err instanceof Error ? err.message : String(err));
      });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

/**
 * Writes the open documents out when the page is being left, instead of
 * warning about it.
 *
 * There is nothing to warn about any more: no document is bound to a file,
 * and every one of them comes back from this browser's storage on the next
 * visit. What a dialog would have protected is the half-second between the
 * last keystroke and the autosave, so flush that instead. `pagehide` is the
 * last event a page reliably gets (`beforeunload` does not fire on mobile);
 * the write is best effort, as everything about local storage is.
 */
export function useFlushOnLeave(): void {
  useEffect(() => {
    const flush = (): void => {
      if (!persistence.restoreAttempted) return;
      void persistence.autosave().catch(() => undefined);
      void persistence.saveShelf().catch(() => undefined);
    };
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);
}
