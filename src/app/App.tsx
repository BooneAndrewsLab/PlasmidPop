import { type DragEvent, useLayoutEffect, useState } from 'react';

import { hasTool } from '@/core';

import { Bench } from './components/Bench';
import { CircularMapView } from './components/CircularMapView';
import { DocumentTabs } from './components/DocumentTabs';
import { EditBar } from './components/EditBar';
import { EmptyState } from './components/EmptyState';
import { FindBar } from './components/FindBar';
import { LinearSequenceView } from './components/LinearSequenceView';
import { KeyBindingsDialog } from './components/KeyBindings';
import { NcbiDialog } from './components/NcbiDialog';
import { VerifyClonesDialog } from './components/VerifyClonesDialog';
import { NewDocumentDialog } from './components/NewDocumentDialog';
import { PhoneShell } from './components/PhoneShell';
import { PrimerWorkspace } from './components/PrimerWorkspace';
import { CopyBanner } from './components/CopyBanner';
import { CompareDialog } from './components/CompareDialog';
import { DownloadNotice } from './components/DownloadNotice';
import { ImportSummaryDialog } from './components/ImportSummaryDialog';
import { SaveReviewDialog } from './components/SaveReviewDialog';
import { ReadNotice } from './components/ReadNotice';
import { ShareNotice } from './components/ShareNotice';
import { BackupNotice } from './components/BackupNotice';
import { RemovalNotice } from './components/RemovalNotice';
import { StorageNotice } from './components/StorageNotice';
import { Sidebar } from './components/Sidebar';
import { SPLITTER_SIZE, Splitter } from './components/Splitter';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { TooltipLayer } from './components/TooltipLayer';
import { useMediaQuery } from './components/useMediaQuery';
import { openFiles } from './openFile';
import {
  DEFAULT_LAYOUT,
  MAX_PRIMER_WORKSPACE_PX,
  MIN_EDITOR_HEIGHT_PX,
  MIN_EDITOR_PX,
  MIN_MAP_PX,
  MIN_PRIMER_WORKSPACE_PX,
  MIN_SEQUENCE_HEIGHT_PX,
  MIN_SEQUENCE_PX,
  MIN_SIDEBAR_HEIGHT_PX,
  MIN_SIDEBAR_PX,
  MIN_WORKSPACE_MAP_PX,
  PHONE_QUERY,
  SIDEBAR_STACKED_QUERY,
  VIEWS_STACKED_QUERY,
  clampPrimerWorkspaceWidth,
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
  useSaveOnClose,
  useRestoreSession,
  useSaveShortcut,
  useViewPrefs,
} from './state/usePersistence';

export function App() {
  const {
    history,
    view: chosenView,
    findOpen,
    documentId,
    layout,
    sidebarOpen,
    front,
    primerWorkspace,
  } = useEditorState();
  const doc = history?.present ?? null;
  // A protein has no map (#66): its residues are the whole view, whatever DNA's switcher says.
  const chosen = doc !== null && !hasTool(doc, 'circular') ? 'sequence' : chosenView;
  // The primer workspace (item 107) takes the sidebar's column, widened, and
  // the sequence pane yields to it: the map is what a design is judged on.
  const workspace = doc !== null && primerWorkspace;
  const view = workspace && chosen === 'both' ? 'map' : chosen;
  useAnalysis();
  useAutosave();
  useAutosaveShelf();
  const opening = useRestoreSession();
  useSaveShortcut();
  useViewShortcuts();
  useFlushOnLeave();
  useSaveOnClose();
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
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void openFiles(files);
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
          {workspace ? (
            // Full screen on a phone (item 107, points 5 and 6), the rail across the top.
            <PrimerWorkspace doc={doc} layout="phone" />
          ) : (
            <div className="phone-editor" key={documentId}>
              <CopyBanner />
              <DownloadNotice />
              <ShareNotice />
              <ReadNotice />
              <StorageNotice />
              <BackupNotice />
              <PhoneShell doc={doc} />
            </div>
          )}
        </main>
      ) : workspace && stackedViews ? (
        // Narrower than the split needs (601 to 1000 px): the workspace takes
        // the whole main area, the sidebar's rail beside or under it as the
        // rail is at that width (item 107, point 5), with the document as a
        // foldable strip across the top of the workspace.
        <main
          className="app__main app__main--workspace"
          style={
            stackedSidebar
              ? { gridTemplateRows: 'minmax(0, 1fr) auto' }
              : { gridTemplateColumns: 'minmax(0, 1fr) auto' }
          }
        >
          <PrimerWorkspace doc={doc} layout="full" />
          <Sidebar doc={doc} />
        </main>
      ) : (
        <main
          className={`app__main${workspace ? ' app__main--workspace' : ''}`}
          style={
            workspace
              ? {
                  // The workspace in the sidebar's column, widened, with a
                  // splitter of its own; the sidebar is its rail alone (item 107).
                  gridTemplateColumns: `minmax(0, 1fr) ${SPLITTER_SIZE}px ${layout.primerWorkspaceWidth}px auto`,
                }
              : stackedSidebar
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
            <BackupNotice />
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
          {workspace && (
            <>
              <Splitter
                axis="x"
                label="Resize the primer workspace"
                minBefore={MIN_WORKSPACE_MAP_PX}
                minAfter={MIN_PRIMER_WORKSPACE_PX}
                value={layout.primerWorkspaceWidth}
                min={MIN_PRIMER_WORKSPACE_PX}
                max={MAX_PRIMER_WORKSPACE_PX}
                valueText={`The primer workspace is ${layout.primerWorkspaceWidth} pixels wide`}
                onMove={(before, extent, handle) => {
                  // What is after the handle is the workspace and the sidebar's rail.
                  const rail =
                    handle.parentElement?.querySelector('.sidebar')?.getBoundingClientRect()
                      .width ?? 0;
                  editorStore.setLayout({
                    primerWorkspaceWidth: clampPrimerWorkspaceWidth(extent - before - rail),
                  });
                }}
                onReset={() => {
                  editorStore.setLayout({
                    primerWorkspaceWidth: DEFAULT_LAYOUT.primerWorkspaceWidth,
                  });
                }}
              />
              <PrimerWorkspace doc={doc} layout="split" />
            </>
          )}
          {!workspace && sidebarOpen && !stackedSidebar && (
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
      <ImportSummaryDialog />
      <RemovalNotice />
      <VerifyClonesDialog />
      <CompareDialog />
      <NewDocumentDialog />
      <NcbiDialog />
      <KeyBindingsDialog />
      <TooltipLayer />
    </div>
  );
}
