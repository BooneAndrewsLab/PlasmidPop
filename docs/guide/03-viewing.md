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
  toolbar (see [Editing the sequence](04-editing.md));
- a **preview**, outside everything else: dashed spans in a colour of their
  own, drawn while a panel is pointing at something that is not in the
  document — a primer pair you are weighing up, every match of a find. See
  [Previews](#previews).

The first and last rows also show the **sticky ends** of a molecule that has
been cut: single-stranded bases are washed over with a gap opposite them, and
an overhang on the other strand is drawn just outside the first or last
column (see [Simulated cloning](12-cloning.md)).

Clicking a feature bar selects that feature; clicking an amino acid on a
translation line selects that residue's three bases. The pointer turns into a
hand over those tracks and stays a text cursor over the bases, where it places
the caret. Lowercase bases stay lowercase, as many people use case to mark
regions.

**File ▸ Export sequence view as SVG** writes what you see as a vector file
for figures, see [Files](02-files.md).

## Previews

Some things are worth seeing on the sequence and the map before they are
anything in the document. A previewed span is drawn dashed, in a colour used
for nothing else: in the sequence view in a band outside the feature lanes,
on the map in a ring just inside the backbone, where a span too short to see
is widened as a short selection is.

Nothing previewed is part of the document. It is not saved, it is not in the
SVG exports, it costs no undo step, and it goes away when you edit the
sequence, switch sidebar tab or close the panel that asked for it.

Today two things use it:

- the [Primers](10-primers.md) tab, for a designed pair and the product it
  would give, and for the binding sites of a primer you paste in;
- [Find](06-find.md), which draws every match at once while the bar is open.

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

### When there are more labels than room

Every label — a feature's name, a cut site, one of the ruler's position
numbers — is kept clear of every other one. A label that cannot sit beside
the thing it names slides along the ring until it finds room, so it stays on
the same side of the map and never crosses the circle.

Past a certain number of labels the ring is full, and the map leaves some out
rather than writing them over each other. It says how many in the bottom-left
corner: **+7 labels not shown**. What is left out is decided by the document,
not by where the crowding happens to be: features keep their labels before
cut sites do, longer features before shorter ones, and a rare cutter before
an enzyme that cuts all over the plasmid.

Nothing is lost by it. **Hover a feature arc or a cut site's tick mark** and
its name appears even if the ring had no room for it, and the feature list
and the Enzymes tab list everything either way. Zooming in also frees up
room, since a label whose feature has gone off screen no longer takes a slot.

The SVG map export does not leave labels out — a figure has nothing to hover.
It grows its canvas around the same circle until they all fit instead, so an
exported map may be a little wider than it is tall.

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
