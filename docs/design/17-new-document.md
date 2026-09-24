# 17. Create from scratch

Done. "New" in the toolbar and "start a
new sequence" in the empty state open an empty linear "Untitled"
document (`editorStore.newDocument`) with the caret placed and the
sequence view focused, so typing starts at once; it is not autosaved
until something is typed. Ctrl+V with nothing open (or into a
still-empty document) opens pasted GenBank/FASTA text as a record and
bare bases as a new document (`openPastedText` in
`src/app/openFile.ts`).

**Name and topology up front** (#6, 2026-09-24). New, File ▸ New, the tab
strip's + and the start screen's link all open one small dialog
(`NewDocumentDialog`, `SharedState.newDialog`): **Name**, focused and
selected with "Untitled" in it, and **Linear | Circular**, starting on the
one chosen last in this page load; Enter creates, Escape opens nothing. Not
a modal step on the way to typing so much as one keystroke more than
before, which is why the defaults are what New used to do. It holds the
view shortcuts off while up, as the other dialogs do. Ctrl+V with nothing
open still makes a document of pasted bases directly: the paste already
says what the document is.
