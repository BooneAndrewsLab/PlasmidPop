import { useEffect } from 'react';

import { editorStore, isDirty } from './editorStore';
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
 * Writes the Cloning tab's assembly shelf shortly after it changes. It has
 * an effect of its own because the shelf outlives the documents: closing
 * every tab must not take the gathered fragments with it.
 */
export function useAutosaveShelf(): void {
  const { assembly } = useEditorState();
  useEffect(() => {
    // Until the last session has been read back, an empty shelf is the page
    // still loading and must not be written over the stored one.
    if (!persistence.restoreAttempted) return;
    const timer = setTimeout(() => {
      persistence.saveShelf().catch((e: unknown) => {
        editorStore.fail(
          `Could not save the assembly: ${e instanceof Error ? e.message : String(e)}`,
        );
      });
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [assembly]);
}

/** On first load, reopens the tabs that were open last time. */
export function useRestoreSession(): void {
  useEffect(() => {
    if (editorStore.getState().documents.length > 0) return;
    persistence.restoreLastSession().catch(() => {
      // Nothing to restore, or storage unavailable: start empty.
    });
  }, []);
}

/** Restores the remembered view switcher and toggles, and records changes to them. */
export function useViewPrefs(): void {
  useEffect(() => startViewPrefs(), []);
}

/** Ctrl/Cmd+S saves (Shift for Save as); Ctrl/Cmd+F opens find. */
export function useSaveShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 'f' && editorStore.document !== null) {
        e.preventDefault();
        editorStore.setFindOpen(true);
        return;
      }
      if (key !== 's') return;
      e.preventDefault();
      if (editorStore.document === null) return;
      (e.shiftKey ? persistence.saveAs() : persistence.save()).catch((err: unknown) => {
        editorStore.fail(err instanceof Error ? err.message : String(err));
      });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);
}

/** Warns before leaving with unsaved (to file) changes in any tab. */
export function useUnsavedWarning(): void {
  const { documents } = useEditorState();
  const dirty = documents.some(isDirty);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);
}
