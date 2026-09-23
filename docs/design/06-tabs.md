# 6. Multiple open documents (tabs)

Done. The store keeps one
`DocumentState` per open document (history, selection, file name and
handle, saved/opened/marked versions, warnings, analysis, enzyme ticks,
reveal, find, feature editing, overwrite prompt, sidebar tab) and a
`SharedState` for the app (view prefs, cut-site toggle, ORF threshold,
error, assembly shelf, preview); `getState()` flattens the front tab into the same
`EditorState` shape the views always read, plus `documents`. Methods act
on the front tab unless they take an id (`apply`, `markDownloaded`,
`requestSaveReview`, `activateDocument`, `closeDocument`); `setAnalysis`
files results by the document they are for, so a slow worker answer lands
in the right tab. `openDocument` returns the id, reuses the tab of a file
already open (`findOpenCopy`: same file name and the document as read
from it) and takes over an untouched "New" tab. **The sidebar tab is a
document's own** (2026-09-22): it was shared, so opening a fragment from
the Cloning tab moved the file it was cut from to Features as a side
effect of the new tab wanting it. A new tab opens on the panel the last
one was on, since opening the insert is part of the same piece of work,
and the explicit switches after an assembly still apply to the product
alone. The strip
(`DocumentTabs.tsx`) has a fixed **Files** tab (the start screen,
`showFiles`), one tab per document with a dirty dot and ×, and +; the
editor area is keyed by document so views start afresh on a switch while
the sidebar keeps its panels' state. Autosave writes every changed tab
(`PersistenceService.autosaved` remembers what was written) and records
the open ids and the front one (`openDocumentIds` in the repository);
`restoreLastSession` reopens them all. `Alt+1`..`Alt+9` bring the
first to the ninth tab forward (item 32). Not yet: a binding to close a
tab (Ctrl+W belongs to the browser), dragging tabs to reorder,
remembering scroll and zoom per tab across a switch.
