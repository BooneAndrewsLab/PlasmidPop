# History

The **History** tab in the sidebar lists every change made to the open
document since it was opened, newest first, and takes the document back to
any of them. It is the same history the **Undo** and **Redo** buttons walk
through one step at a time, laid out so a whole editing session can be read
at once.

## Made from

A document that came out of a simulated reaction, such as a fragment,
a PCR product, a ligation or an assembly (see
[What a product was made from](12-cloning.md#what-a-product-was-made-from)),
has a **Made from** section at the top of the tab. Collapsed, it says how
the document was made (_Ligation of 2 parts, circular_). Expanded, it shows
the tree. The document is at the top, and under each molecule are the ones
it was made from, then the ones those were made from, and so on. Each
molecule shows:

- its name, and how it was made: _Digest with BamHI and EcoRI · 397–3,082_,
  _PCR with Forward and Reverse · proofreading_, with the primers under it;
- its length, topology and the short form of its checksum;
- **Open**, when this browser still holds that exact molecule: in an open
  tab, which it brings to the front, or among the documents kept in this
  browser, which it opens. A molecule is matched by its checksum, not its
  name, so a file edited since it was used does not count, and a renamed
  one still does. Otherwise it says **not in this browser**.

At the top, **this document** means the document is still the molecule that
was made; **edited since** means its bases have changed since. The list
below says how.

The section only appears for a document made in PlasmidPop, read from a file
that carries the `PlasmidPop-made-from:` block, or opened from a
[SnapGene `.dna` file](02-files.md#formats) that carries SnapGene's own
history. SnapGene's tree reads the same way, with two differences: it keeps
no checksums, so every molecule in it says **not in this browser**, and what
it did that PlasmidPop does not — `flip`, `newFileFromSelection`,
`changeMethylation` — is shown under SnapGene's own word for it. Everything can also be
used with the keyboard: `Tab` reaches the section and each **Open**, and
`Enter` or `Space` expands and collapses it.

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

A [named](#naming-a-state) state is kept even then. When its step goes past
the 200, it moves to **Named states from before the oldest kept** below the
list, with its name, what the step was and when. Undo cannot reach it any
more, but clicking it brings it back as a change of its own (_Back to
“name”_, which Undo takes back as usual), and its **⋯** menu can rename it,
mark changes since it, or **Forget** it.

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

## Naming a state

A state you will want to come back to — _before the Gibson_, _clean
backbone_, _sent for sequencing_ — can be given a name, so it is found by
what it is rather than by its step number.

1. Click **⋯** at the right of the row and choose **Name…**.
2. Type the name and press `Enter`. `Escape` leaves the row as it was.

The name then heads the row, in the accent colour, with what the step did
under it. **Rename…** in the same menu changes it; **Clear name**, or
emptying the field and pressing `Enter`, takes it off. The row at the
bottom — **Opened document** or **New document** — already has a name and
cannot be given another; every step above it can.

Once anything is named, **Named only** at the top of the panel lists just
the named rows; click it again for the whole list.

Naming is not an edit. It does not add a row, Undo does not take it off,
and the document is not changed or marked as changed by it: a name is a
note about the history, and an Undo step for it would leave Undo one step
short of the state you just named. The name is kept with the history
across reloads (see [After a reload](#after-a-reload)).

A named row also ends a run of typing: if you name the row you are typing
in and carry on typing, the new bases go into a row of their own, so the
state you named stays as you named it.

## What a step changed

**⋯ ▸ What changed** shows what that one step did: the document just before
it against the document just after it, in the same review a working copy's
download and **Compare with…** show — the summary, the map with the change
marked, each changed stretch of bases, and what became of the features. It
is only a look: nothing is undone, and **Close** or `Escape` puts it away.
The starting row has no step before it, so it has nothing to show.

## Marking changes since a state

**⋯ ▸ Mark changes since this** makes that state what the edit marks measure
from, as **Mark in the views** does after **Compare with…**: the sequence
view and the map mark everything that differs from it, the **Edits** menu
reads _Compared with_ and the state's name (or _step 4_, or _the opened
document_), and **Next change** / **Previous change** (`Alt+N`,
`Alt+Shift+N`) go through those changes. Choose another baseline in the
**Edits** menu to go back. Like a comparison, it is for this session: after
a reload the marks measure **Since opened** again.

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
**Recent files** — or opening a file identical to it — brings the list back
as you left it: the same rows, times
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
Named states are kept longest. One whose row is left out comes back under
**Named states from before the oldest kept**, stored whole, and it counts
towards the 4 MB; to make room for named states, **Since opened** and the
**on disk** tag give way first. Only when not even the current document
would fit beside them are named states left out, the oldest first. On a
plasmid none of this comes near the limit; on a document of a megabase or
more, each named state that has left the list costs about as much as the
document.
A document of more than about four million bases keeps no stored history,
and reopens with an empty list.

The history lives only in this browser. It is not written to the files you
download or into share links (the [Made from](#made-from) tree is: it
belongs to the molecule, not to the editing session), and **Remove** on the start screen deletes it
with the document; closing a tab does not.
