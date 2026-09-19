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
- save the file, so the version on disk stays a row you can return to, or
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

## The version on disk

The row whose state matches the file as it was last saved or opened is
tagged **on disk**. It is the same information as the dot next to the
document name in the toolbar, but it says which state the file holds, so you
can see how far the document has moved since. Saving moves the tag to the
current row.

## Elsewhere

- The **▾** next to **Undo** and **Redo** in the toolbar opens a short
  version of the same list as a menu.
- `Ctrl+Z` and `Ctrl+Shift+Z` step one change at a time. See
  [Editing the sequence](04-editing.md) and
  [Keyboard shortcuts](14-shortcuts.md).

History lives in memory: it is not saved to the file, and reloading the page
starts a fresh history from the restored document.
