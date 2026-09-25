# Viewing and selecting

The toolbar's view switcher shows the **Sequence** view, the **Map**, or
**Both** side by side. The two views share one selection: whatever you select
in one is highlighted in the other and reported in the status bar as
`N bp selected, from to to` (1-based, inclusive).

The switcher, the **Complement** (`Alt+C`), **Translations** (`Alt+T`) and
**Cut sites** (`Alt+R`) toggles next to it, the **Format** menu's choices, the **Edits** baseline and the
sizes of the panes are remembered in the browser, so the views come back the
way you left them the next time you open PlasmidPop. They are settings of the
app, not of a document: they do not change with the file you open and are not
written into a saved file.

## Sizing the panes

In the **Both** view the boundary between the map and the sequence can be
dragged: take hold of the line between them and move it. The same handle sits
on the sidebar's inner edge. Each pane has a floor it will not be dragged
below, so it is never squeezed to a sliver.

- **Drag** the line to move it. **Double-click** it to put that one boundary
  back where it started.
- **Drag on past the floor** to put the pane away: more than half of it
  gone, and the map or the sequence leaves the other one showing alone (the
  view switcher's **Sequence** or **Map**), and the sidebar folds to its tab
  rail. The view switcher and the rail bring them back.
- With the handle focused, the **arrow keys** move it in small steps, **Page
  Up** and **Page Down** in larger ones, and **Home** and **End** take it to
  either floor; one more arrow toward a pane at its floor puts it away.
  `Alt+B` takes the keyboard to the next handle from wherever it is, and
  `Escape` gives it back — no need to Tab through the toolbar to get there.
- On a narrow window the map sits above the sequence instead of beside it.
  That layout keeps its own boundary: a division chosen for a wide window is
  not imposed on the other one. On a window narrower still the sidebar moves
  under the editor, and its top edge is a handle too; its height is kept
  apart from its width beside the editor.
- **Format ▸ Reset the layout** puts the map, the sequence and the sidebar
  back to the sizes they started at, and opens the sidebar if it is closed.

## Putting the sidebar away

Clicking the sidebar tab that is already open closes the panel and leaves the
tab strip on the window's edge, giving the views the whole width. Clicking any
label opens it again on that tab, and `Alt+S` does both. The panel keeps
whatever you had typed into it while it is closed.

Which panel is open belongs to the document tab, not to the window: switching
files brings back the panel that file was left on, and a file opened while you
are working in one panel opens on the same one. So setting up a digest in
Cloning and opening the insert alongside it keeps you in Cloning, and looking
at the insert's features does not move the first file.

## On a phone

On a screen narrower than about 600 px PlasmidPop is a reader rather than an
editor: it shows one pane at a time, chosen from a bar at the foot of the
screen. It is meant for the plasmid someone sent you as a link, read where the
message arrived.

- **Map**, **Sequence** and **Details** are the three panes. Details holds the
  Features and Enzymes lists; the other sidebar tabs (primers, alignment,
  cloning, ORFs, translation, history) are for making things and are not
  offered on a phone.
- The toolbar keeps the name, the size and shape of the molecule and the
  **File** menu, so a document can still be downloaded or sent on as a link.
  The view switcher, the toggles, **Format**, **Edits** and **History** are
  not there.
- **Tap a feature** on the map to select it. Its name comes back if the ring
  had no room for it and stays until you tap somewhere else, which is what
  hovering does with a mouse. **Pinch** to zoom and **drag** to pan.
- In the sequence a finger **scrolls**. A **tap** on a feature bar selects the
  feature, a tap on the bases puts the caret there. The bases are shown alone:
  the Complement and Translations toggles are not applied, since each one adds
  a line to every row.
- To copy a stretch of sequence, **press and hold** on its first base for
  half a second, until that base is selected, then **drag** to its last one
  without lifting; holding near the top or bottom edge scrolls on. When you
  lift, a **Copy** button over the selection copies its bases, ready to paste
  into a message or another app. A quick drag is still a scroll and a quick
  tap still a tap. A tablet does the same.
- Each tab remembers its pane: switch to another document and back, or
  reload the page, and it is on the pane you left it on. A document you open
  — a file, or a link someone sent — starts on the **Map**.
- Tapping a row in a list takes you back to the view you were last in, with
  that feature selected. The Features list has no **Rename**, **Edit** or
  **Remove** on a phone, so a stray tap cannot turn a plasmid someone sent
  you into a working copy.

To open a GenBank file that arrived as a mail attachment, share it to
PlasmidPop from the mail app, on Android with PlasmidPop installed: see
[Opening an attachment from another app](02-files.md#opening-an-attachment-from-another-app).

Nothing about a document is different on a phone: it is the same file, stored
in the same browser, and everything comes back on a wider window. A notice
says so the first time; **Got it** puts it away for good. A tablet is wide
enough for the normal layout, with the map above the sequence in portrait, and
the same touch gestures work there.

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
for figures — the whole sequence, the selection or a range, at a chosen
number of bases per row, on A4 pages if you like; see [Exporting](02-files.md#exporting).

## Previews

Some things are worth seeing on the sequence and the map before they are
anything in the document. A previewed span is drawn dashed, in a colour used
for nothing else: in the sequence view in a band outside the feature lanes,
on the map in a ring just inside the backbone, where a span too short to see
is widened as a short selection is.

Nothing previewed is part of the document. It is not saved, it is not in the
SVG exports, it costs no undo step, and it goes away when you edit the
sequence or close the panel that asked for it. Switching to another sidebar
tab takes it off the views too, and coming back brings it back: what the
panel was showing is kept for each document while the page is open. Two
panels can preview at once — the find bar and a sidebar tab, say — and
their spans are drawn together.

A primer's arrow is marked in the colour of a changed base wherever the
primer does not pair with the sequence under it, so a mismatch is seen
where it is rather than counted in a list.

Today these use it:

- the [Primers](10-primers.md) tab, for a designed pair and the product it
  would give, and for the binding sites of a primer you paste in;
- [Find](06-find.md), which draws every match at once while the bar is open;
- the [ORFs](08-orfs.md) tab, which draws every open reading frame it lists;
  click one on the map or in the sequence view to select it;
- the [Cloning](12-cloning.md) tab, which draws the pieces a digest would
  give, each with a tick where its cuts fall, and draws the one under the
  pointer as a solid arrow. These can be clicked, which puts that fragment
  on the shelf, for the [Bench](12-cloning.md#the-bench); and its PCR, which
  draws the products and primer sites.

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
  that matches what you see — or type any count from 10 to 1,000 under
  **Other** and press Enter. If the fixed width does not fit, the view
  scrolls sideways.
- **Number the complement** repeats each row's position number beside the
  complement strand, so a wide row can be read from either line.
- **Colour the bases** gives A, C, G and T each their own colour on both
  strands; anything else (an N or another IUPAC code) is grey. While it is
  on, the four swatches under it choose the colours, for the sequence view,
  a read's trace and the SVG export alike; **Reset** goes back to the
  theme's, which differ between light and dark.
- **Reset the layout** is not about the sequence view: it puts the panes back
  to the sizes they started at, see [Sizing the panes](#sizing-the-panes).

The SVG exports follow the bases-per-row, numbering and colour choices,
chosen colours included. They keep their own text size and font so the file
looks the same whatever the screen is set to. All of these are remembered in
this browser.

## Circular map

The map draws the backbone as a ring with tick marks, features as arcs in
lanes around it, and labels with leader lines. Features that share a name
(a gene and its CDS, for example) get one label, and a gene and CDS of the
same name on exactly the same bases are drawn as one bar, the CDS's, in
both views; the feature list still lists both. Cut sites of the ticked
enzymes are labelled on the same ring, unless **Cut sites** is off in the
toolbar. The centre shows the name and length when they fit whole; on a
narrow map the name is set smaller, and past that it is left out rather than
squeezed or cut short, since the toolbar has it.
A linear sequence is drawn as an open ring with a gap at the ends.

Nothing is too small to see. A feature of a few bases, less than a pixel of
ring on a large plasmid, is drawn as a narrow mark at least three pixels
wide, and it can be hovered and clicked at that width. A selection that
short, and the cursor itself, are drawn as a needle from outside the
backbone in through the lanes, so they are not lost under a feature.

- **Click** the backbone to place the cursor, **drag** along it to select.
  On a circular sequence the selection runs clockwise from where you started
  and may cross the origin.
- **Click** a feature arc to select the feature; if the **Features** tab is
  open, its row is highlighted on its own and scrolls into view — even where
  another feature covers exactly the same bases, as a gene and its CDS often
  do. **Double-click** the arc to zoom in on it.
- A **label** is a target too: clicking a feature's name selects the
  feature, double-clicking it zooms in on it, and clicking a cut site's
  name, or its tick mark on the backbone, puts the cursor at the cut. Hovering one highlights it and its
  leader.
- **Click** empty space — inside the circle, or outside it — to clear the
  selection.
- **Wheel** or **pinch** to zoom about the pointer; **double-click** empty
  space to zoom in one step. When zoomed in, **drag** empty space (or drag
  with the middle button) to pan.
- The buttons in the corner zoom **+** and **−**, zoom to the **Sel**ection
  and **Fit** the whole map.
- A selection too short to see as an arc — a few bases of a plasmid, say — is
  drawn a little wider than it is and marked with a line running from the
  backbone in towards the centre, so it can still be found. Zoom in to see
  its true extent.
- When **Edits** is on, your changes are marked on the ring: bands over the
  backbone where bases are new (green) or replaced (amber), a red wedge where
  bases were removed, and an outline on any feature you added or edited. See
  [Seeing what you changed](04-editing#seeing-what-you-changed).

Lane widths and fonts do not change with zoom; the tick marks get denser as
you zoom in.

### When there are more labels than room

Every label — a feature's name, a cut site, one of the ruler's position
numbers — is kept clear of every other one. A label that cannot sit beside
the thing it names slides along the ring until it finds room, so it stays on
the same side of the map and never crosses the circle. It slides a short way
only: a name a long leader line away from its own tick is harder to read
than no name at all, so past about eight lines' worth the map leaves it out
instead of towing it to the end of a crowded arc. A bunch of labels shares
out the room around it: the bunch spreads about its middle, so the labels
at its edges are not squeezed out by the ones in the middle, and one crowded
against the top or bottom of the circle moves away from it together. The
labels stay in the order their ticks are, and their leader lines do not
cross; where two features sit at nearly the same place one of them has to
give way, and it is either drawn with a leader that crosses its neighbour's
or left out. A label with no room beside the ring can go a little further
out, on a second row or column outside the first, where its leader can
reach it without running through another label. The same document is laid
out the same way every time it is opened.

Past a certain number of labels the ring is full, and the map leaves some out
rather than writing them over each other. It says how many in the bottom-left
corner: **+7 labels not shown**. What is left out is decided by the document,
not by where the crowding happens to be: features keep their labels before
cut sites do, longer features before shorter ones, and a rare cutter before
an enzyme that cuts all over the plasmid.

Nothing is lost by it. **Hover a feature arc or a cut site's tick mark** and
its name appears even if the ring had no room for it, drawn in a rounded
outline so that it reads as lying on top of the map rather than as a hole in
it. The feature list and the Enzymes tab list everything either way. Zooming in also frees up
room, since a label whose feature has gone off screen no longer takes a slot.

The SVG map export does not leave labels out — a figure has nothing to hover.
It grows its canvas around the same circle until they all fit instead, so an
exported map may be a little wider than it is tall, and it lets a label sit
further from its feature than the map on screen would, for the same reason:
on paper a name that did not fit is gone for good.

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

## The checksum

The right of the status bar shows a short checksum of the open molecule, like
`cdseguid=dUxN7Y…`. Click it to copy the whole thing.

It is a [SEGUID v2](https://www.seguid.org/) name, and it has one property
that makes it worth having: **it does not change when the molecule is written
differently.** A plasmid has no first base, and DNA has no top strand, so
rotating a circle to another origin or reverse-complementing it gives a file
that shares no text with the one you started with — and the same checksum.
Two molecules with the same checksum are the same molecule; two with
different checksums are not.

- The prefix says what kind of molecule it is: `cdseguid=` for a circular one
  and `ldseguid=` for a linear one. It is part of the checksum, not a label
  on it — the same bases as a plasmid and as a fragment are two different
  things.
- **Sticky ends count.** A fragment left by a digest is not the blunt
  fragment of the same bases, so its checksum is different. Case does not
  count: `atgc` and `ATGC` are the same molecule.
- **Names, features and everything else are not in it.** It is a name for the
  sequence, not for the annotation, so renaming a feature does not change it
  and neither does adding one.

Paste it into a lab notebook, an email or a methods section and anyone with
the same construct can check they have the same construct — without either of
you sending the other the sequence. [Compare with…](02-files.md#comparing-with-another-document)
shows both checksums, and uses them to line a rotated plasmid up with this one
before showing the differences.
