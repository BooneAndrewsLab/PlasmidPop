# Viewing and selecting

The toolbar's view switcher shows the **Sequence** view, the **Map**, or
**Both** side by side. The two views share one selection: whatever you select
in one is highlighted in the other and reported in the status bar as
`N bp selected, from to to` (1-based, inclusive).

The switcher, the **Complement**, **Translations** and **Cut sites** toggles
next to it, the **Format** menu's choices and the **Edits** baseline are
remembered in the browser, so the views come back the way you left them the
next time you open PlasmidPop. They are settings of the app, not of a
document: they do not change with the file you open and are not written into
a saved file.

## Sequence view

Bases are laid out in rows that fill the available width — or a width you
fix in the **Format** menu, below — with a ruler above each row giving the
position of its first base. Below each row:

- the **complement** strand, when **Complement** is on in the toolbar;
- one line of **amino acids** per CDS feature, when **Translations** is on
  (see [Translation](09-translate.md));
- **features** as coloured bars with their names, stacked into lanes when
  they overlap;
- **cut sites** of the enzymes ticked in the Enzymes tab, as marks with the
  enzyme name, unless **Cut sites** is off in the toolbar (see
  [Restriction enzymes](07-enzymes.md));
- **edit marks** over the bases you have changed, when **Edits** is on in the
  toolbar (see [Editing the sequence](04-editing.md)).

Clicking a feature bar selects that feature; clicking an amino acid on a
translation line selects that residue's three bases. The pointer turns into a
hand over those tracks and stays a text cursor over the bases, where it places
the caret. Lowercase bases stay lowercase, as many people use case to mark
regions.

**File ▸ Export sequence view as SVG** writes what you see as a vector file
for figures, see [Files](02-files.md).

### Format

The toolbar's **Format** menu sets how the sequence view draws. Choices take
effect at once and the menu stays open, so you can try one and look.

- **Text size** — Small, Medium (the default) or Large. The rows, lanes and
  labels scale with the text, so a larger size gives a roomier view with
  fewer bases in a row.
- **Bases per row** — **Fit the window** (the default) puts as many bases in
  a row as the width holds, in tens, and re-flows when the window changes.
  Pick 30, 60, 90 or 120 instead to keep the same rows whatever the window
  size — useful for comparing two windows side by side, or for an export
  that matches what you see. If the fixed width does not fit, the view
  scrolls sideways.
- **Number the complement** repeats each row's position number beside the
  complement strand, so a wide row can be read from either line.
- **Colour the bases** gives A, C, G and T each their own colour on both
  strands; anything else (an N or another IUPAC code) is grey.

The SVG exports follow the bases-per-row, numbering and colour choices. They
keep their own text size so the file looks the same whatever the screen is
set to.

## Circular map

The map draws the backbone as a ring with tick marks, features as arcs in
lanes around it, and labels with leader lines. Features that share a name
(a gene and its CDS, for example) get one label. Cut sites of the ticked
enzymes are labelled on the same ring, unless **Cut sites** is off in the
toolbar. The centre shows the name and length.
A linear sequence is drawn as an open ring with a gap at the ends.

- **Click** the backbone to place the cursor, **drag** along it to select.
  On a circular sequence the selection runs clockwise from where you started
  and may cross the origin.
- **Click** a feature arc to select the feature. **Double-click** it to zoom
  in on it.
- **Wheel** or **pinch** to zoom about the pointer; **double-click** empty
  space to zoom in one step. When zoomed in, **drag** empty space (or drag
  with the middle button) to pan.
- The buttons in the corner zoom **+** and **−**, zoom to the **Sel**ection
  and **Fit** the whole map.
- A selection too short to see as an arc — a few bases of a plasmid, say — is
  drawn a little wider than it is and marked with a line running from the
  backbone in towards the centre, so it can still be found. Zoom in to see
  its true extent.

Lane widths and fonts do not change with zoom; the tick marks get denser as
you zoom in.

## Selecting

In the sequence view:

- **Click** between two bases to place the cursor there. The status bar says
  `Cursor after base N`.
- **Drag** to select a range; **Shift+click** extends the selection to the
  clicked position.
- On a **translation line**, click an amino acid to select its codon and drag
  along the line to extend the selection codon by codon, so the selection
  always starts and ends on a codon boundary. On a reverse-strand CDS the
  codons are read right to left, and the selection follows. Dragging off the
  coding bases — into an intron or past either end — leaves the selection as
  it was.
- `Shift+Arrow` keys extend the selection one base (left/right) or one row
  (up/down) at a time. `Home` and `End` go to the ends of the row,
  `Ctrl+Home` and `Ctrl+End` to the ends of the sequence; add `Shift` to
  select on the way.
- `Ctrl+A` selects everything. `Escape` clears the selection.

Elsewhere:

- Clicking an entry in the **Features**, **Enzymes**, **ORFs**, **Primers**
  or **Cloning** tabs selects the corresponding range and scrolls both views
  to it.
- [Find](06-find.md) selects each match in turn.

Many actions work on the selection: Add feature, Delete selection, Copy and
Cut, Export selection, Translate, Design primers, Align against selection.
