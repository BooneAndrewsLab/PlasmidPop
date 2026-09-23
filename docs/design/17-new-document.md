# 17. Create from scratch

Done. "New" in the toolbar and "start a
new sequence" in the empty state open an empty linear "Untitled"
document (`editorStore.newDocument`) with the caret placed and the
sequence view focused, so typing starts at once; it is not autosaved
until something is typed. Ctrl+V with nothing open (or into a
still-empty document) opens pasted GenBank/FASTA text as a record and
bare bases as a new document (`openPastedText` in
`src/app/openFile.ts`). Not yet: choosing circular/name up front (use
"Make circular" and rename after).
