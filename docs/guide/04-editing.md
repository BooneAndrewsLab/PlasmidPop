# Editing the sequence

The sequence view is a text editor for DNA. Click to place the cursor, then
type. Every change is one step in the undo history, and features keep their
places: a feature after an insertion moves along, a feature around it grows,
a feature whose bases are deleted shrinks or disappears.

## Typing, deleting, replacing

- **Type** bases at the cursor. All IUPAC letters are accepted
  (`ACGTU` and the ambiguity codes `RYSWKMBDHVN`), in either case, and
  the case is kept. Anything else is refused with a message in the status
  bar.
- **Type with a selection** to replace it.
- `Backspace` deletes the base before the cursor, `Delete` the base after
  it, either one deletes the selection when there is one. **Delete
  selection** in the edit bar does the same with the mouse.
- On a circular sequence the cursor wraps: `Backspace` after base 1 deletes
  the last base.

## Copy, cut and paste

`Ctrl+C` copies the selected bases and `Ctrl+X` cuts them. The features that
fall inside the selection travel with the bases, trimmed to it (the `source`
feature is left behind). `Ctrl+V` pastes at the cursor or over the selection,
and the features arrive shifted to the new position. A paste is a single undo
step.

- Pasting into another program gives plain bases.
- Pasting bases from another program inserts them as text, which is
  checked against the IUPAC alphabet.
- Between browser tabs, some browsers keep only the plain text, so the
  features may not come along.
- Pasting a whole GenBank or FASTA record into an **empty** document opens
  the record instead of inserting its text.

## Whole-sequence operations

In the edit bar:

- **Reverse complement** flips the entire molecule. Features move to the
  opposite strand at the mirrored position.
- **Set origin here** (circular sequences only) renumbers the sequence so
  the base after the cursor, or the first selected base, becomes base 1.
  Features that end up spanning the new origin are kept as wrapping
  features.
- **Make circular** / **Make linear** switches the topology. Making a
  molecule linear breaks it at the origin, so set the origin first if a
  feature crosses it.

To rename the document, click its name in the toolbar, type, and press
`Enter` (`Escape` cancels).

## Seeing what you changed

The **Edits** button in the toolbar marks your changes in the sequence view,
like tracked changes in a word processor. Bases that are new are tinted and
underlined in green, bases standing where other bases used to be in amber,
and a red wedge with a line through the strands marks every place where
bases were removed. A feature you added or edited gets an outline in the
same colours. The dot on the button says something is marked; its tooltip,
and the foot of its menu, count it up (`+12 bp · 4 bp changed · −3 bp`).

The menu chooses what the marks are measured from:

- **Since opened** (the default) compares against the document as it was
  when you opened it, so the marks survive a save and show the whole
  session's work until you open the file again.
- **Since last save** compares against the version on disk, so the marks
  clear every time you save — the same thing the dot beside the document
  name means. A document that has never been saved has nothing to compare
  to, and nothing is marked.
- **Mark from here** makes the document as it is now the point everything
  is measured from, for when you want to see only what you do next.
- **Off** leaves the view unmarked.

The choice is remembered between sessions (except **Mark from here**, which
belongs to one session's work and comes back as **Since opened**). The marks
also appear in **File ▸ Export sequence view as SVG**.

The marks describe the difference between two versions, not the steps that
got you there: if you type a base and delete it again, nothing is marked.
Something that renumbers the whole sequence — **Set origin here** or
**Reverse complement** — makes every base differ from the old version, so
the whole sequence is marked and the tally says _too different to follow in
detail_. Undo it, or use **Mark from here**, to get back to useful marks.

## Undo, redo and the history list

- `Ctrl+Z` undoes, `Ctrl+Shift+Z` or `Ctrl+Y` redoes. The **Undo** and
  **Redo** buttons show what they will undo or redo in their tooltip.
- The **▾** next to them lists every change since the document was opened,
  newest first, with labels such as _Insert 3 bases_, _Paste 120 bases_,
  _Edit feature_ or _Set origin_. Click any entry to jump to that state;
  entries above the current one are shown greyed and can be reached again
  with Redo until you make a new change.
- The **History** tab in the sidebar shows the same list as a panel, with
  the time of each change, how much it added or removed, and which state the
  file on disk holds. See [History](13-history.md).

Undo works on the document in memory. It does not un-save a file on disk, and
the browser's autosave always keeps the current state.
