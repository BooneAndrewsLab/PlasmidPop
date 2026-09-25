import { type DragEvent, useLayoutEffect, useState } from 'react';

import { Bench } from './components/Bench';
import { CircularMapView } from './components/CircularMapView';
import { DocumentTabs } from './components/DocumentTabs';
import { EditBar } from './components/EditBar';
import { EmptyState } from './components/EmptyState';
import { FindBar } from './components/FindBar';
import { LinearSequenceView } from './components/LinearSequenceView';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { PhoneShell } from './components/PhoneShell';
import { CopyBanner } from './components/CopyBanner';
import { CompareDialog } from './components/CompareDialog';
import { DownloadNotice } from './components/DownloadNotice';
import { SaveReviewDialog } from './components/SaveReviewDialog';
import { ReadNotice } from './components/ReadNotice';
import { ShareNotice } from './components/ShareNotice';
import { StorageNotice } from './components/StorageNotice';
import { Sidebar } from './components/Sidebar';
import { SPLITTER_SIZE, Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { useMediaQuery } from './components/useMediaQuery';
import { openFile } from './openFile';
import {
  DEFAULT_LAYOUT,
  MIN_EDITOR_HEIGHT_PX,
  MIN_EDITOR_PX,
  MIN_MAP_PX,
  MIN_SEQUENCE_HEIGHT_PX,
  MIN_SEQUENCE_PX,
  MIN_SIDEBAR_HEIGHT_PX,
  MIN_SIDEBAR_PX,
  PHONE_QUERY,
  SIDEBAR_STACKED_QUERY,
  VIEWS_STACKED_QUERY,
  clampSidebarHeight,
  clampSidebarWidth,
} from './state/layout';
import { editorStore } from './state/editorStore';
import { useAnalysis } from './state/useAnalysis';
import { useEditorState } from './state/useEditorStore';
import { useViewShortcuts } from './state/useViewShortcuts';
import {
  useAutosave,
  useAutosaveShelf,
  useFlushOnLeave,
  useRestoreSession,
  useSaveShortcut,
  useViewPrefs,
} from './state/usePersistence';

export function App() {
  const { history, view, findOpen, documentId, layout, sidebarOpen, front } = useEditorState();
  const doc = history?.present ?? null;
  useAnalysis();
  useAutosave();
  useAutosaveShelf();
  const opening = useRestoreSession();
  useSaveShortcut();
  useViewShortcuts();
  useFlushOnLeave();
  useViewPrefs();
  const [dragging, setDragging] = useState(false);
  // The two layouts divide different axes, so each keeps its own fraction and
  // the splitter has to know which one is on screen.
  const stackedViews = useMediaQuery(VIEWS_STACKED_QUERY);
  const stackedSidebar = useMediaQuery(SIDEBAR_STACKED_QUERY);
  // On a phone the panes give way to one at a time (`PhoneShell`); the
  // toolbar and the document tabs above it cut themselves down on their own.
  const phone = useMediaQuery(PHONE_QUERY);
  // The store picks the phone's cut-site preference while this is on (#43).
  // Before paint, so the first frame on a phone is drawn without them.
  useLayoutEffect(() => {
    editorStore.setPhoneLayout(phone);
    return () => {
      editorStore.setPhoneLayout(false);
    };
  }, [phone]);
  const split = stackedViews ? layout.viewsSplitStacked : layout.viewsSplit;
  const percent = Math.round(split * 100);
  const tracks = `${split}fr ${SPLITTER_SIZE}px ${1 - split}fr`;

  // A drop target inside the app (the Align box, the REBASE import) claims
  // its drop with preventDefault; only unclaimed drops open a tab.
  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    const claimed = e.defaultPrevented;
    e.preventDefault();
    setDragging(false);
    if (claimed) return;
    const file = e.dataTransfer.files[0];
    if (file !== undefined) void openFile(file);
  };

  return (
    <div
      className={`app${dragging ? ' app--dragging' : ''}`}
      onDragOver={(e) => {
        // Only files open a tab; a document tab being dragged along the
        // strip (#33) is not one.
        const claimed = e.defaultPrevented || !e.dataTransfer.types.includes('Files');
        e.preventDefault();
        if (dragging === claimed) setDragging(!claimed);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <Toolbar doc={doc} />
      <DocumentTabs />
      {front === 'bench' && !phone ? (
        <main className="app__main app__main--bench">
          <Bench />
        </main>
      ) : doc === null ? (
        <main className="app__main app__main--empty">
          {opening ? (
            <p className="empty empty--opening" role="status">
              Opening the shared sequence…
            </p>
          ) : (
            <EmptyState />
          )}
        </main>
      ) : phone ? (
        <main className="app__main app__main--phone">
          <div className="phone-editor" key={documentId}>
            <CopyBanner />
            <DownloadNotice />
            <ShareNotice />
            <ReadNotice />
            <StorageNotice />
            <PhoneShell doc={doc} />
          </div>
        </main>
      ) : (
        <main
          className="app__main"
          style={
            stackedSidebar
              ? {
                  // Under the editor, the sidebar is a row of its own height (#36).
                  gridTemplateRows: sidebarOpen
                    ? `minmax(0, 1fr) ${SPLITTER_SIZE}px ${layout.sidebarHeightStacked}px`
                    : 'minmax(0, 1fr) auto',
                }
              : {
                  // Collapsed, the sidebar is its tab rail alone and there is
                  // nothing to drag, so the splitter's track goes with it.
                  gridTemplateColumns: sidebarOpen
                    ? `minmax(0, 1fr) ${SPLITTER_SIZE}px ${layout.sidebarWidth}px`
                    : 'minmax(0, 1fr) auto',
                }
          }
        >
          {/* Keyed by document so a switch of tabs starts the views afresh (scroll, zoom)
              instead of carrying the previous document's over; the sidebar is not, so
              what was typed into its panels survives a look at another tab. */}
          <div className="app__editor" key={documentId}>
            <CopyBanner />
            <DownloadNotice />
            <ShareNotice />
            <ReadNotice />
            <StorageNotice />
            <EditBar doc={doc} />
            {findOpen && <FindBar doc={doc} />}
            <div
              className={`app__views app__views--${view}`}
              style={
                view !== 'both'
                  ? undefined
                  : stackedViews
                    ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: tracks }
                    : { gridTemplateColumns: tracks, gridTemplateRows: 'minmax(0, 1fr)' }
              }
            >
              {view !== 'sequence' && <CircularMapView doc={doc} />}
              {view === 'both' && (
                <Splitter
                  axis={stackedViews ? 'y' : 'x'}
                  label="Resize the map and the sequence"
                  minBefore={MIN_MAP_PX}
                  minAfter={stackedViews ? MIN_SEQUENCE_HEIGHT_PX : MIN_SEQUENCE_PX}
                  value={percent}
                  min={5}
                  max={95}
                  valueText={`The map takes ${percent}% of the views`}
                  onMove={(before, extent) => {
                    if (extent <= 0) return;
                    const fraction = before / extent;
                    editorStore.setLayout(
                      stackedViews ? { viewsSplitStacked: fraction } : { viewsSplit: fraction },
                    );
                  }}
                  onReset={() => {
                    editorStore.setLayout(
                      stackedViews
                        ? { viewsSplitStacked: DEFAULT_LAYOUT.viewsSplitStacked }
                        : { viewsSplit: DEFAULT_LAYOUT.viewsSplit },
                    );
                  }}
                  // Pushed past a pane's floor, the other view is shown alone.
                  onCollapse={(pane) => {
                    editorStore.setView(pane === 'before' ? 'sequence' : 'map');
                  }}
                />
              )}
              {view !== 'map' && <LinearSequenceView doc={doc} />}
            </div>
          </div>
          {sidebarOpen && !stackedSidebar && (
            <Splitter
              axis="x"
              label="Resize the sidebar"
              minBefore={MIN_EDITOR_PX}
              minAfter={MIN_SIDEBAR_PX}
              value={layout.sidebarWidth}
              min={MIN_SIDEBAR_PX}
              max={900}
              valueText={`The sidebar is ${layout.sidebarWidth} pixels wide`}
              onMove={(before, extent) => {
                editorStore.setLayout({ sidebarWidth: clampSidebarWidth(extent - before) });
              }}
              onReset={() => {
                editorStore.setLayout({ sidebarWidth: DEFAULT_LAYOUT.sidebarWidth });
              }}
              onCollapse={(pane) => {
                if (pane === 'after') editorStore.setSidebarOpen(false);
              }}
            />
          )}
          {sidebarOpen && stackedSidebar && (
            <Splitter
              axis="y"
              label="Resize the sidebar"
              minBefore={MIN_EDITOR_HEIGHT_PX}
              minAfter={MIN_SIDEBAR_HEIGHT_PX}
              value={layout.sidebarHeightStacked}
              min={MIN_SIDEBAR_HEIGHT_PX}
              max={900}
              valueText={`The sidebar is ${layout.sidebarHeightStacked} pixels tall`}
              onMove={(before, extent) => {
                editorStore.setLayout({
                  sidebarHeightStacked: clampSidebarHeight(extent - before),
                });
              }}
              onReset={() => {
                editorStore.setLayout({
                  sidebarHeightStacked: DEFAULT_LAYOUT.sidebarHeightStacked,
                });
              }}
              onCollapse={(pane) => {
                if (pane === 'after') editorStore.setSidebarOpen(false);
              }}
            />
          )}
          <Sidebar doc={doc} />
        </main>
      )}
      <StatusBar doc={doc} />
      <SaveReviewDialog />
      <CompareDialog />
      <NewDocumentDialog />
    </div>
  );
}
