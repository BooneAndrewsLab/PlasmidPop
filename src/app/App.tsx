import { type DragEvent, useState } from 'react';

import { CircularMapView } from './components/CircularMapView';
import { EditBar } from './components/EditBar';
import { EmptyState } from './components/EmptyState';
import { FindBar } from './components/FindBar';
import { LinearSequenceView } from './components/LinearSequenceView';
import { OverwriteDialog } from './components/OverwriteDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { openFile } from './openFile';
import { useAnalysis } from './state/useAnalysis';
import { useEditorState } from './state/useEditorStore';
import {
  useAutosave,
  useRestoreSession,
  useSaveShortcut,
  useUnsavedWarning,
  useViewPrefs,
} from './state/usePersistence';

export function App() {
  const { history, view, findOpen } = useEditorState();
  const doc = history?.present ?? null;
  useAnalysis();
  useAutosave();
  useRestoreSession();
  useSaveShortcut();
  useUnsavedWarning();
  useViewPrefs();
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file !== undefined) void openFile(file);
  };

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Toolbar doc={doc} />
      {doc === null ? (
        <main className="app__main app__main--empty">
          <EmptyState />
        </main>
      ) : (
        <main className="app__main">
          <div className="app__editor">
            <EditBar doc={doc} />
            {findOpen && <FindBar doc={doc} />}
            <div className={`app__views app__views--${view}`}>
              {view !== 'sequence' && <CircularMapView doc={doc} />}
              {view !== 'map' && <LinearSequenceView doc={doc} />}
            </div>
          </div>
          <Sidebar doc={doc} />
        </main>
      )}
      <StatusBar doc={doc} />
      <OverwriteDialog />
    </div>
  );
}
