# 5. History panel

Done. The **History** sidebar tab lists every
recorded change newest first with its number, label, time and what it did
to the document (`+12 bp`, `−3 bp`, `+1 feature`, `circular`), marks the
state the file on disk holds and the current one, greys undone steps, and
jumps to any state on a click; **Latest** redoes everything undone
(`src/app/historyView.ts`, `src/app/components/HistoryPanel.tsx`; the core
`History` now carries a timestamp per step, `steps`, `stateAt`, `size` and
`truncated`). A run of typing is one step, not one per base:
`History.push` takes an optional `Coalesce` whose two keys chain a run
(`src/core/document/coalesce.ts` defines typing, Backspace and Delete),
and `seal()` ends a run where the present must stay reachable — on
undo, redo and jump, on save, and on "Mark from here". A run also breaks
on a two-second pause, at 60 bases, and when the caret moves. Not yet:
naming or bookmarking a state, a diff of what a step changed.
