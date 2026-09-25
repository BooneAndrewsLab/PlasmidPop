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
on a two-second pause, at 60 bases, and when the caret moves.
The history is kept across reloads since item 51, which also says what
**Opened document** and **on disk** mean after one.

## Naming a state, what a step changed, marking since a state (#4)

Done, 2026-09-24. Each row has a **⋯** menu (`RowMenu` in
`HistoryPanel.tsx`) with **Name…** / **Rename…**, **Clear name**, **What
changed** and **Mark changes since this**; a row is still one click to
jump, which is what the list is mostly for, so the new actions sit behind
the menu rather than as buttons on every row.

- **A name is on the step, in the core.** `HistoryEntry.name`, set by
  `History.named(position, name)`: immutable like the labels and times,
  carried through undo, redo and jumps with the entry, laid out by
  `toRecord` and rebuilt by `fromRecord`. Only steps (positions 1 to
  `size`) take a name; the starting row already has one (**Opened
  document**, **New document**), and naming it would need a field the
  History does not otherwise have for no case anyone asked for. Names are
  trimmed and cut at 100 characters (`cleanStateName`); a blank one clears.
- **Naming is not an undo step.** It is a note about the history, not a
  change to the document: nothing a download or a share link carries moves,
  the dot does not come on, and the step count does not grow. As an undo
  step it would also defeat itself — naming the present would push a step
  whose undo leaves the named state, so the state you named is one Undo
  away from the one you are in. A mistaken name is put right by renaming
  it. The store's `nameHistoryState` swaps the history without touching the
  selection, and the autosave writes it since the history object changed.
- **A named step is sealed.** Naming the last applied step drops its
  `coalesceKey`, and `mergePush` refuses a named step too, so typing on
  after naming starts a step of its own and the named state stays exactly
  what was named. Clearing the name leaves the step sealed: the run it
  ended is over.
- **Named states outlive the limit.** When `push` drops steps past the
  200, a named one takes its state into `History.kept` (name, label, time,
  state) instead of vanishing: the name is the user saying this state
  matters, and the limit is about memory, which one state that shares
  structure with its neighbours hardly costs. Kept states are listed
  below the steps. Undo cannot reach them (they are no longer on the
  stack), so a click on one pushes it as a change of its own, _Back to
  “name”_ (`bringBackKeptState`), which Undo takes back as any change;
  **Forget** drops one. Item 51 says how they are stored.
- **Named only** filters the list to named rows. Pinning named rows at the
  top was the other choice, but it breaks the list's reading as the undo
  stack in order, which is what jumping relies on.
- **What changed** opens `HistoryStepDialog`: the state before the step
  against the state after it, through `diffDocuments` and the same
  `DiffReview` the download review and Compare with… use, in a dialog
  shaped like `CompareDialog` (read-only, Close or Escape). It is rendered
  through a portal so the sidebar's boxes cannot hold it in.
- **Mark changes since this** sets the `compared` baseline of item 33
  (`markChangesSince`), the machinery **Mark in the views** uses: the
  views, the map, the Edits menu and Next/Previous change (Alt+N) all read
  that baseline already, so a history state needed nothing new. It is named
  after the state: its name, else _step N_, else what the start row is
  called (`stateTitle`). Like a comparison it comes back as **Since
  opened** after a reload (item 21).

Usage events: `history`/`name` (`set` or `clear`, never the name),
`what-changed`, `mark-since`, `bring-back`.
