import { useEffect, useRef } from 'react';

import { type Shortcut, analytics } from '../analytics';
import { isAltBlocked } from '../keys';
import { matchesBinding, resolveBindings, withShift } from '../keyBindings';
import { focusNextSplitter } from '../components/splitterFocus';
import { copyShareLink } from '../share';
import { goToChange } from './editDiff';
import { type DocumentTool, hasTool } from '@/core';
import { FONT_SIZES } from '@/view/linear';

import { type EditsBaseline, type ViewMode, editorStore, sidebarTabsFor } from './editorStore';

/** The view switcher's order, which `cycle-view` steps through. */
const VIEW_ORDER: readonly ViewMode[] = ['sequence', 'map', 'both'];

/** Toggles the toolbar's three view switches go under. */
const TOGGLES: readonly {
  /** Its action in the bindings table (#79). */
  readonly action: string;
  readonly binding: Shortcut;
  /** What the document in front needs for the toggle to mean anything (#66). */
  readonly tool: DocumentTool;
  readonly read: (s: ReturnType<typeof editorStore.getState>) => boolean;
  readonly set: (on: boolean) => void;
}[] = [
  {
    action: 'toggle-complement',
    binding: 'alt+c',
    tool: 'complement',
    read: (s) => s.showComplement,
    set: (v) => {
      editorStore.setShowComplement(v);
    },
  },
  {
    action: 'toggle-translations',
    binding: 'alt+t',
    tool: 'translations',
    read: (s) => s.showTranslations,
    set: (v) => {
      editorStore.setShowTranslations(v);
    },
  },
  {
    action: 'toggle-cut-sites',
    binding: 'alt+r',
    tool: 'enzymes',
    read: (s) => s.showCutSites,
    set: (v) => {
      editorStore.setShowCutSites(v);
    },
  },
];

/**
 * The bindings for things that were only ever a click away: the view
 * toggles, the edit marks and stepping through them, the sidebar, the document tabs and the share
 * link; closing and moving the front tab; and Undo and Redo of the shelf
 * while the Bench is in front.
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
      if (isAltBlocked(e.target)) return;
      const state = editorStore.getState();
      // What each action is on, which the user may have changed (#79).
      const bound = resolveBindings(state.keyBindings);
      const on = (action: string): boolean => {
        const binding = bound.get(action);
        return binding !== undefined && matchesBinding(e, binding);
      };
      // A modal has the user's attention; its own Escape is the way out.
      if (
        state.saveReview !== null ||
        state.comparison !== null ||
        state.newDialog ||
        state.ncbiDialog ||
        state.keysDialog
      )
        return;

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

      // What a protein in front has no use for is left to the browser (#66).
      const doc = state.history?.present ?? null;
      const has = (tool: DocumentTool): boolean => doc === null || hasTool(doc, tool);

      for (const toggle of TOGGLES) {
        if (!on(toggle.action)) continue;
        if (!has(toggle.tool)) return;
        e.preventDefault();
        analytics.shortcut(toggle.binding);
        toggle.set(!toggle.read(state));
        return;
      }

      if (on('toggle-edits')) {
        e.preventDefault();
        analytics.shortcut('alt+e');
        if (state.editsBaseline === 'off') editorStore.setEditsBaseline(lastBaseline.current);
        else {
          lastBaseline.current = state.editsBaseline;
          editorStore.setEditsBaseline('off');
        }
        return;
      }

      // The next or previous marked change (#37), the binding and the same
      // with Shift. With nothing marked the keys do nothing, and are left
      // to the browser.
      const nextChange = bound.get('next-change');
      if (
        nextChange !== undefined &&
        (matchesBinding(e, nextChange) || matchesBinding(e, withShift(nextChange)))
      ) {
        if (state.history === null) return;
        if (goToChange(e.shiftKey ? -1 : 1)) {
          e.preventDefault();
          analytics.shortcut('alt+n');
        }
        return;
      }

      if (on('toggle-sidebar')) {
        e.preventDefault();
        analytics.shortcut('alt+s');
        editorStore.setSidebarOpen(!state.sidebarOpen);
        return;
      }

      if (on('share-link')) {
        if (state.history === null) return;
        e.preventDefault();
        analytics.shortcut('alt+l');
        copyShareLink(state.history.present).catch((err: unknown) => {
          editorStore.fail(err instanceof Error ? err.message : String(err));
        });
        return;
      }

      // Alt+V: the next of Sequence, Map and Both, as the view switcher has them.
      if (on('cycle-view')) {
        if (!has('circular')) return;
        e.preventDefault();
        analytics.shortcut('alt+v');
        const at = VIEW_ORDER.indexOf(state.view);
        editorStore.setView(VIEW_ORDER[(at + 1) % VIEW_ORDER.length] ?? 'both');
        return;
      }

      // Alt+[ and Alt+]: the sidebar tab above or below, opening the sidebar
      // if it was put away, and wrapping round at either end of the rail.
      if (on('sidebar-previous') || on('sidebar-next')) {
        if (state.documentId === null) return; // no sidebar beside the file list or the Bench
        e.preventDefault();
        analytics.shortcut('alt+bracket');
        const step = on('sidebar-previous') ? -1 : 1;
        const tabs = sidebarTabsFor(doc);
        const at = tabs.indexOf(state.sidebarTab);
        const n = tabs.length;
        const next = state.sidebarOpen ? tabs[(at + step + n) % n] : state.sidebarTab;
        if (next !== undefined) editorStore.setSidebarTab(next);
        editorStore.setSidebarOpen(true);
        return;
      }

      // Alt+= and Alt+-: the sequence view's text a size larger or smaller.
      if (on('text-larger') || on('text-smaller')) {
        e.preventDefault();
        analytics.shortcut('alt+size');
        const at = FONT_SIZES.indexOf(state.seqFontSize);
        const next = FONT_SIZES[at + (on('text-larger') ? 1 : -1)];
        if (next !== undefined) editorStore.setSeqFontSize(next);
        return;
      }

      // Alt+0: the Bench, which sits before the documents Alt+1..9 count.
      if (on('bench')) {
        e.preventDefault();
        analytics.shortcut('alt+digit');
        editorStore.showBench('key');
        return;
      }

      // Alt+B: the keyboard to the next boundary between panes, where the
      // arrow keys move it; Escape gives it back (#36).
      if (on('focus-splitter')) {
        if (focusNextSplitter()) {
          e.preventDefault();
          analytics.shortcut('alt+b');
        }
        return;
      }

      // Alt+W closes the front tab: Ctrl+W is the browser's, and closes the app.
      if (on('close-tab')) {
        if (state.documentId === null) return;
        e.preventDefault();
        analytics.shortcut('alt+w');
        editorStore.closeDocument();
        return;
      }

      // Alt+Shift+PageUp/PageDown move the front tab along the strip, as
      // Ctrl+Shift+PageUp/PageDown move a tab in the browser's own.
      if (
        e.altKey &&
        e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        (e.key === 'PageUp' || e.key === 'PageDown')
      ) {
        const id = state.documentId;
        if (id === null) return;
        e.preventDefault();
        analytics.shortcut('alt+shift+page');
        const at = state.documents.findIndex((d) => d.documentId === id);
        editorStore.moveDocument(id, at + (e.key === 'PageUp' ? -1 : 1));
        return;
      }

      // Alt+1..9: the nth open document, as the tab strip has them. The
      // ninth rather than the last, because a strip of tabs is read by
      // position and counting to the end of a long one is not a shortcut.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit !== null && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
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
