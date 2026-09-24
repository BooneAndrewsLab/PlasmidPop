import { useEffect, useRef } from 'react';

import { type Shortcut, analytics } from '../analytics';
import { isAltKey, isTextTarget } from '../keys';
import { copyShareLink } from '../share';
import { type EditsBaseline, editorStore } from './editorStore';

/** Toggles the toolbar's three view switches go under. */
const TOGGLES: readonly {
  readonly code: string;
  readonly binding: Shortcut;
  readonly read: (s: ReturnType<typeof editorStore.getState>) => boolean;
  readonly set: (on: boolean) => void;
}[] = [
  {
    code: 'KeyC',
    binding: 'alt+c',
    read: (s) => s.showComplement,
    set: (v) => {
      editorStore.setShowComplement(v);
    },
  },
  {
    code: 'KeyT',
    binding: 'alt+t',
    read: (s) => s.showTranslations,
    set: (v) => {
      editorStore.setShowTranslations(v);
    },
  },
  {
    code: 'KeyR',
    binding: 'alt+r',
    read: (s) => s.showCutSites,
    set: (v) => {
      editorStore.setShowCutSites(v);
    },
  },
];

/**
 * The bindings for things that were only ever a click away: the view
 * toggles, the edit marks, the sidebar, the document tabs and the share
 * link; and Undo and Redo of the shelf while the Bench is in front.
 *
 * All of them are `Alt` and a key, for one reason: in the sequence view
 * every bare letter types a base, and `Ctrl` is spoken for by the browser
 * and by editing. `Alt` is the one modifier a document editor can spend.
 */
export function useViewShortcuts(): void {
  // What the Edits menu was on before the marks were turned off, so the same
  // key brings back the baseline the user chose rather than a default.
  const lastBaseline = useRef<Exclude<EditsBaseline, 'off'>>('opened');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (isTextTarget(e.target)) return;
      const state = editorStore.getState();
      // A modal has the user's attention; its own Escape is the way out.
      if (state.saveReview !== null || state.comparison !== null) return;

      // On the Bench, Undo and Redo are the shelf's (item 49). A document's
      // are the sequence view's, which is not on screen.
      if (state.front === 'bench' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' || key === 'y') {
          e.preventDefault();
          analytics.shortcut('ctrl+z');
          if (key === 'y' || e.shiftKey) editorStore.redoShelf();
          else editorStore.undoShelf();
          return;
        }
      }

      for (const toggle of TOGGLES) {
        if (!isAltKey(e, toggle.code)) continue;
        e.preventDefault();
        analytics.shortcut(toggle.binding);
        toggle.set(!toggle.read(state));
        return;
      }

      if (isAltKey(e, 'KeyE')) {
        e.preventDefault();
        analytics.shortcut('alt+e');
        if (state.editsBaseline === 'off') editorStore.setEditsBaseline(lastBaseline.current);
        else {
          lastBaseline.current = state.editsBaseline;
          editorStore.setEditsBaseline('off');
        }
        return;
      }

      if (isAltKey(e, 'KeyS')) {
        e.preventDefault();
        analytics.shortcut('alt+s');
        editorStore.setSidebarOpen(!state.sidebarOpen);
        return;
      }

      if (isAltKey(e, 'KeyL')) {
        if (state.history === null) return;
        e.preventDefault();
        analytics.shortcut('alt+l');
        copyShareLink(state.history.present).catch((err: unknown) => {
          editorStore.fail(err instanceof Error ? err.message : String(err));
        });
        return;
      }

      // Alt+1..9: the nth open document, as the tab strip has them. The
      // ninth rather than the last, because a strip of tabs is read by
      // position and counting to the end of a long one is not a shortcut.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit !== null && isAltKey(e, e.code)) {
        const target = state.documents[Number(digit[1]) - 1];
        if (target === undefined) return;
        e.preventDefault();
        analytics.shortcut('alt+digit');
        editorStore.activateDocument(target.documentId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}
