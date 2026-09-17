import { useEffect } from 'react';

import { editorStore } from './editorStore';
import { persistence } from './persistence';
import { useEditorState } from './useEditorStore';

const AUTOSAVE_MS = 500;

/** Writes the open document to IndexedDB shortly after every change. */
export function useAutosave(): void {
  const { history, documentId, fileName } = useEditorState();
  const doc = history?.present ?? null;
  useEffect(() => {
    if (doc === null || documentId === null) return;
    const timer = setTimeout(() => {
      persistence.autosave().catch((e: unknown) => {
        editorStore.fail(`Could not save locally: ${e instanceof Error ? e.message : String(e)}`);
      });
    }, AUTOSAVE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [doc, documentId, fileName]);
}

/** On first load, reopens the last document. */
export function useRestoreSession(): void {
  useEffect(() => {
    if (editorStore.document !== null) return;
    persistence.restoreLastSession().catch(() => {
      // Nothing to restore, or storage unavailable: start empty.
    });
  }, []);
}

/** Ctrl/Cmd+S saves, with Shift for Save as. */
export function useSaveShortcut(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
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

/** Warns before leaving with unsaved (to file) changes. */
export function useUnsavedWarning(): void {
  const { dirty } = useEditorState();
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
