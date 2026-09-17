import { useSyncExternalStore } from 'react';

import { type EditorState, editorStore } from './editorStore';

export function useEditorState(): EditorState {
  return useSyncExternalStore(editorStore.subscribe, editorStore.getState, editorStore.getState);
}
