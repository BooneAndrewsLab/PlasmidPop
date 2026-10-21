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

**The caret on a circle** (#265, 2026-10-20). A new document is circular
whenever Circular was chosen last, and typing into one came out backwards
("act" became "cta"), Arrow Right never reached the end and a copied
fragment pasted at the end did nothing. The cause was older than the
dialog: since editing came in, a caret at `length` on a circular sequence
was folded onto 0 (`normalizePosition`) wherever text went in, in the
document model and in `editing.ts`, and `clampPosition` wrapped the arrow
keys modulo the length. On a circle the two are one point, but not one
edit: bases typed at `length` are appended, at 0 prepended, and the
origin, base numbers and the caret's place on screen all differ. So a
caret is now a boundary in `[0, length]` on both topologies
(`isValidRange` accepts the empty range at `length`); `insert`,
`insertFragment`, `replace` and `mapPositionThrough` put text where the
caret is and fold nothing; only a point that names a place on the circle
(a feature's site, a new origin) is still canonicalised to 0. Bases and the
ranges over them wrap as before, and whether an insertion grows a range
over the origin is still judged on the circle, at 0 and `length` alike. A
caret stepped past either end comes round to the other end, passing no
base (one past `length` is 0, one before 0 is `length`; at first it went on
to 1 and `length - 1`, which skipped a base on screen), and a Shift+arrow
stops at the ends rather than stretch the selection round the circle; Delete at the end takes the first
base. The empty document's fallback caret now covers a pasted fragment as
well as text, so a paste after Escape or a click on the empty map lands.
