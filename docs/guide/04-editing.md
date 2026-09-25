# Editing the sequence

The sequence view is a text editor for DNA. Click to place the cursor, then
type. Features keep their places: a feature after an insertion moves along,
a feature around it grows, a feature whose bases are deleted shrinks or
disappears.

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
- Between browser tabs and windows the features come along too, including
  in browsers that drop PlasmidPop's own clipboard format: the copy also
  carries them in its formatted (HTML) version. A program that accepts
  formatted text shows it as the plain bases.
- Pasting a whole GenBank or FASTA record into an **empty** document opens
  the record instead of inserting its text.

## Whole-sequence operations

In the edit bar:

- **Reverse complement** flips the entire molecule. Features move to the
  opposite strand at the mirrored position. A linear molecule with sticky
  ends comes out a different length, because its other strand starts and
  ends elsewhere; the History step then says so, e.g. _Reverse complement:
  4,361 → 4,365 bp_.
- **Set origin here** (circular sequences only) renumbers the sequence so
  the base after the cursor, or the first selected base, becomes base 1.
  Features that end up spanning the new origin are kept as wrapping
  features.
- **Make circular** / **Make linear** switches the topology. Making a
  molecule linear breaks it at the origin, so set the origin first if a
  feature crosses it.
- **Blunt (fill in)** and **Blunt (trim)** (sticky-ended linear molecules
  only) make both ends blunt, as an enzyme would on the bench; see
  [Blunting the ends](12-cloning.md#blunting-the-ends).

On a molecule with sticky ends (a fragment from a digest, see
[Simulated cloning](12-cloning.md)), an edit that reaches the very first or
last bases leaves that end plain and blunt again, since it is no longer the
end the enzyme made; an edit in the middle leaves both ends as they were.
Making the molecule circular drops the ends, and reverse-complementing swaps
them — and moves the sequence with them. The sequence shown is the top strand
alone, and the two strands of a sticky-ended molecule do not cover the same
bases, so turning it over writes out the other strand, which starts and ends
elsewhere: the bases of an overhang the bottom strand carried come into the
sequence and the ones only the top strand had leave it. The molecule is the
same one; its length changes by an overhang at each end, and a feature
annotated on an overhang that has gone goes with it. A blunt molecule is
simply reversed.

To rename the document, click its name in the toolbar, type, and press
`Enter` (`Escape` cancels).

## Seeing what you changed

The **Edits** button in the toolbar marks your changes in both views, like
tracked changes in a word processor. Bases that are new are tinted and
underlined in green, bases standing where other bases used to be in amber,
and a red wedge with a line through the strands marks every place where
bases were removed. A feature you added or edited gets an outline in the
same colours, and the line says which kind of edit it was: a solid outline
means the feature covers different bases than it did, a broken one means the
same bases described differently — retyped, renamed, a qualifier edited. The
first can break a construct and the second cannot, which is the one
distinction a line can carry. The dot on the button says something is marked; its tooltip,
and the foot of its menu, count it up (`+12 bp · 4 bp changed · −3 bp`).

A new **name** or a change between **linear and circular** touches no base,
so there is nothing in the views to mark; the toolbar marks it instead, where
the name and the shape are written. The name or the word _circular_ gets a
broken amber underline, the line of a feature relabelled over the same bases,
and its tooltip says what it was (`Renamed from “pBR322”`, `Was linear`); the
Edits tally adds `renamed` or `made circular`. It follows the menu like the
other marks: nothing while they are off, and against the file you compared
with it says what that one is called or is (`Named “pBR322” in theirs.gb`).
The name a working copy takes by itself (`pBR322 copy`) is not counted as a
rename — the banner above the views already says it is a copy.

The **circular map** marks the same changes on the ring, in the same
colours: a green or amber band drawn over the backbone where the bases are
new or replaced, and a red wedge pointing at every place where bases closed
up. A stretch too short to see as a band — a single base of a plasmid — is
drawn a little wider than it is, the way a short selection is. Features keep
their outlines there too, broken or solid as in the sequence view. This is the view that answers _where_ a change
landed: in the marker, in the origin, in nothing that matters.

A feature you **removed** is drawn as a ghost: a broken red outline in the
feature lanes where it was, with no fill and no arrow. A ghost never takes a
live feature's place — it goes in a lane with room there, or in a lane of its
own further in — and it has no name in the label ring, so turning the marks on
never moves the other labels; point at it and its name comes up (`tet removed`).
Features that went because their bases were deleted get no ghost: the red wedge
stands for them, and pointing at the wedge says how many it took
(`300 bp deleted, with 2 features`).

The marks on the map are **clickable**. Click a green or amber band and its
stretch is selected, a wedge puts the cursor where the bases closed up, and a
ghost selects the bases the removed feature covered — the same selection
**Next change** would make, so a change across the origin is selected whole.
The pointer turns into a hand over a mark, and the mark says what it is (`40 bp
inserted`). A feature, a label or a cut site under the pointer still comes
first, and pressing on a band and dragging still selects a range as it does
anywhere on the backbone. The sequence view's marks are not click targets: a
changed base there is a base you may want to put the cursor in.

The menu chooses what the marks are measured from:

- **Since opened** (the default) compares against the document as it was
  when you opened it, so the marks survive a download and show the whole
  session's work until you open the file again.
- **Since last download** compares against the version you last got a file
  of, so the marks clear every time you download — the same thing the dot
  beside the document name means. A working copy you have not downloaded yet
  is measured against the file it came from; a document that came from
  nowhere and has never been downloaded has nothing to compare to, and
  nothing is marked.
- **Mark from here** makes the document as it is now the point everything
  is measured from, for when you want to see only what you do next.
- **Compared with _name_** is there once **Mark in the views** has been
  used in [Compare with…](02-files.md#comparing-with-another-document): it
  marks what this document has that the other file or tab does not. It
  belongs to the document it was compared from; on a document not compared
  with anything it means **Since opened**.
- **Off** leaves the view unmarked.

The choice is remembered between sessions (except **Mark from here** and
**Compared with**, which belong to one session's work and come back as
**Since opened**). The marks also appear in **File ▸ Export sequence view as
SVG** and **Export map as SVG**, and in the review before a download and in
**Compare with…**.

**Next change** (`Alt+N`) and **Previous change** (`Alt+Shift+N`) in the
same menu go from the cursor to the next or previous marked change, whatever
the marks are measured from: a stretch of new or replaced bases is selected,
a place where bases were removed gets the cursor, and both views scroll to
it. At the last change Next goes round to the first. On a plasmid, a change
that runs across the origin is one stop, selected across it. With nothing
marked both are greyed out and the keys do nothing.

The marks describe the difference between two versions, not the steps that
got you there: if you type a base and delete it again, nothing is marked.
**Set origin here** renumbers the whole sequence, which makes every base
differ from the old version, so the whole sequence is marked and the tally
says _too different to follow in detail_. Undo it, or use **Mark from
here**, to get back to useful marks.

**Reverse complement** is recognised instead: the marks are worked out
against the old version turned over too, so a turn on its own marks no
bases, the tally says _turned over_, and edits made before or after it are
marked as usual. That holds for a sticky-ended molecule as well, whose
length changes but whose molecule does not.

## Undo, redo and the history list

- `Ctrl+Z` undoes, `Ctrl+Shift+Z` or `Ctrl+Y` redoes. The **Undo** and
  **Redo** buttons show what they will undo or redo in their tooltip.
- A run of typing is one step, not one step per base, and so is a run of
  `Backspace` or `Delete`. A pause, a click elsewhere, a download or
  60 bases ends the run and the next keystroke starts a new step. See
  [History](13-history.md).
- The **▾** next to them lists every change since the document was opened,
  newest first, with labels such as _Insert 3 bases_, _Paste 120 bases_,
  _Edit feature_ or _Set origin_. Click any entry to jump to that state;
  entries above the current one are shown greyed and can be reached again
  with Redo until you make a new change.
- The **History** tab in the sidebar shows the same list as a panel, with
  the time of each change, how much it added or removed, and which state you
  last downloaded. See [History](13-history.md).

Undo works on the document in this browser. It does not reach back into a
file you have already downloaded, and the browser's autosave always keeps the
current state.
