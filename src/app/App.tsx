import { type DragEvent, useState } from 'react';

import { CircularMapView } from './components/CircularMapView';
import { DocumentTabs } from './components/DocumentTabs';
import { EditBar } from './components/EditBar';
import { EmptyState } from './components/EmptyState';
import { FindBar } from './components/FindBar';
import { LinearSequenceView } from './components/LinearSequenceView';
import { CopyBanner } from './components/CopyBanner';
import { DownloadNotice } from './components/DownloadNotice';
import { SaveReviewDialog } from './components/SaveReviewDialog';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { openFile } from './openFile';
import { useAnalysis } from './state/useAnalysis';
import { useEditorState } from './state/useEditorStore';
import {
  useAutosave,
  useAutosaveShelf,
  useFlushOnLeave,
  useRestoreSession,
  useSaveShortcut,
  useViewPrefs,
} from './state/usePersistence';

export function App() {
  const { history, view, findOpen, documentId } = useEditorState();
  const doc = history?.present ?? null;
  useAnalysis();
  useAutosave();
  useAutosaveShelf();
  useRestoreSession();
  useSaveShortcut();
  useFlushOnLeave();
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
      <DocumentTabs />
      {doc === null ? (
        <main className="app__main app__main--empty">
          <EmptyState />
        </main>
      ) : (
        <main className="app__main">
          {/* Keyed by document so a switch of tabs starts the views afresh (scroll, zoom)
              instead of carrying the previous document's over; the sidebar is not, so
              what was typed into its panels survives a look at another tab. */}
          <div className="app__editor" key={documentId}>
            <CopyBanner />
            <DownloadNotice />
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
      <SaveReviewDialog />
    </div>
  );
}
