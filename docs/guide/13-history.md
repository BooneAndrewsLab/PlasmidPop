# History

The **History** tab in the sidebar lists every change made to the open
document since it was opened, newest first, and takes the document back to
any of them. It is the same history the **Undo** and **Redo** buttons walk
through one step at a time, laid out so a whole editing session can be read
at once.

## Reading the list

Each row is one recorded change:

- the step number, counting from the state the document started in;
- what was done, in the same words the Undo tooltip uses: _Insert 3 bases_,
  _Paste 120 bases_, _Edit feature_, _Set origin_, _Make circular_;
- the time the change was made;
- what it did to the document: `+12 bp`, `−3 bp`, `+1 feature`, `circular`
  or `linear`. A change that moves none of those, such as a rename, has
  nothing to show here.

The current state is highlighted. Changes that have been undone are greyed
and sit above it; they stay until a new change replaces them.

The last row is where the history starts: **Opened document** for a file, or
**New document** for one started from scratch, with the size and feature
count it had then. Only the most recent 200 changes are kept, so in a long
session the oldest row reads **Oldest kept state** instead.

## Runs of typing are one step

Typing base after base is one thing you did, so it is recorded as one
change: a row that reads _Insert 12 bases_, and one `Ctrl+Z` that takes all
twelve back. Holding `Backspace` or `Delete` merges the same way.

A run ends, and the next keystroke starts a fresh row, when you

- pause for two seconds or more,
- move the caret or click elsewhere,
- reach 60 bases in one run,
- undo, redo or jump to another state,
- download the document, so the version you have a file of stays a row you
  can return to, or
- choose **Mark from here** in the **Edits** menu.

Switching between typing, `Backspace` and `Delete` also starts a new row,
and a paste is always a row of its own however short it is.

## Jumping to a state

Click any row to put the document in that state. Rows below the current one
are undone to, rows above are redone to; **Latest** at the top of the panel
redoes everything that was undone. Nothing is thrown away by jumping, so you
can go back and forth freely. Making a new change from a state in the middle
does drop the changes above it, exactly as Undo followed by typing does.

The selection is cleared on a jump, because positions from the old state may
not exist in the new one.

## The version you have a file of

The row whose state matches the last download — or, in a document opened from
a file and not yet edited, the file it was read from — is tagged **on disk**.
It is the same information as the dot next to the document name in the
toolbar, but it says which state your file holds, so you can see how far the
document has moved since. Downloading moves the tag to the current row. A
[working copy](02-files.md#working-copies) you have not downloaded yet has no
such row: its history starts at the contents of the file it came from.

## Elsewhere

- The **▾** next to **Undo** and **Redo** in the toolbar opens a short
  version of the same list as a menu.
- `Ctrl+Z` and `Ctrl+Shift+Z` step one change at a time. See
  [Editing the sequence](04-editing.md) and
  [Keyboard shortcuts](14-shortcuts.md).

## After a reload

The history is kept in this browser's storage beside the document, so a
reload, a crash, or closing the tab and opening the document again from
**Recent files** brings the list back as you left it: the same rows, times
and current state, with the undone rows still greyed above it and reachable
with Redo or a click. What does change:

- A run of typing that was going on when the page went is finished; the
  next keystroke starts a new row.
- **Since opened** in the **Edits** menu still measures from the state the
  history starts at, the **Opened document** row — or, for a
  [working copy](02-files.md#working-copies), from the file it came from —
  not from the moment of the reload.
- The **on disk** tag and the dot beside the document name stay on the row
  you last downloaded, so undoing to that row clears the dot as before. A
  working copy you have never downloaded has the dot after a reload too.
- **Mark from here** and **Compared with** come back as **Since opened**, as
  they always have.

The stored history is limited to the 200 most recent changes, like the
list, and to about 4 MB per document. A long session on a very large
document can go over that: the oldest rows are then left out of the stored
copy, and after the next reload the list starts at **Oldest kept state**.
A document of more than about four million bases keeps no stored history,
and reopens with an empty list.

The history lives only in this browser. It is not written to the files you
download or into share links, and **Remove** on the start screen deletes it
with the document; closing a tab does not.
