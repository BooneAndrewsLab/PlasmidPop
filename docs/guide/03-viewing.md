# Viewing and selecting

The toolbar's view switcher shows the **Sequence** view, the **Map**, or
**Both** side by side. The two views share one selection: whatever you select
in one is highlighted in the other and reported in the status bar as
`N bp selected, from to to, GC p %` (1-based, inclusive). A selection through the
origin of a circle ends at a small number (`591 to 20` on a 600 bp plasmid),
and every panel that names a range writes it the same way.

The switcher, the **Complement** (`Alt+C`), **Translations** (`Alt+T`) and
**Cut sites** (`Alt+R`) toggles next to it, the **Format** menu's choices (the
GC track and its window among them), the **Edits** baseline and the
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
- On a narrow window, and on a short one such as a phone turned on its side,
  the **Complement**, **Translations** and **Cut sites** toggles are not in
  the toolbar: they are the first three items of the **Format** menu, under
  **Show**, and `Alt+C`, `Alt+T` and `Alt+R` work as before. On the short
  window the rest of the toolbar is drawn tighter, with the size and shape
  under the name, so it keeps to one row and leaves the height to the views.
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
  Features and Enzymes lists and the [Primers](10-primers.md) tab, whose
  **Design primers…** opens the primer workspace over the whole screen; the
  other sidebar tabs (alignment, cloning, ORFs, translation, history) are
  for making things and are not offered on a phone.
- The toolbar keeps the name, the size and shape of the molecule and the
  **File** menu, so a document can still be downloaded or sent on as a link.
  The view switcher, the toggles, **Format**, **Edits** and **History** are
  not there.
- **Tap a feature** on the map to select it. Its name comes back if the ring
  had no room for it and stays until you tap somewhere else, which is what
  hovering does with a mouse. Tapping a feature's name does the same, with
  the name and its leader drawn out. **Pinch** to zoom and **drag** to pan.
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
- **Cut sites are hidden** on a phone to begin with, so the map and the bases
  show the features and a tap lands on what you meant. To see them, open
  **Details ▸ Enzymes** and tap **Show cut sites**; the phone remembers that.
  The choice is the phone's own: the **Cut sites** toggle on a wider window
  keeps whatever it was set to there.
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
the same touch gestures work there. So is a phone turned on its side: wider
than 600 px, it has the normal layout with a one-row toolbar (see
[Sizing the panes](#sizing-the-panes) above), and turning it back
upright brings the reader back.

## Sequence view

Bases are laid out in rows that fill the available width — or a width you
fix in the **Format** menu, below — with a ruler above each row giving the
position of its first base. Below each row:

- the **complement** strand, when **Complement** is on in the toolbar;
- for a document whose molecule type is RNA (a `.rna` file, or a GenBank record
  with RNA on its LOCUS line), both strands are drawn with **U** where the
  stored sequence has T, and the complement of A is U. This is only how the
  letters are drawn, in the view and in its SVG and PNG exports: the sequence
  itself, copying, downloads, enzymes, primers, translation and search all
  keep working on T, and a DNA/RNA hybrid is drawn as DNA;
- one line of **amino acids** per CDS feature, when **Translations** is on
  and **Format ▸ Translations** is **Every CDS**; by default **One per gene** draws
  only the longest CDS of each gene, plus the selected one (see
  [Translation](09-translate.md#which-cds-features-get-a-line)). A codon
  split across an exon junction shows a faint letter and a dotted open edge
  on each piece, and one a CDS leaves unfinished at an open end is hatched
  (see [Split and unfinished codons](09-translate.md#split-and-unfinished-codons));
- **features** as coloured bars with their names, stacked into lanes when
  they overlap. Features of one type on exactly the same bases are drawn
  as one bar with a count (`sig_peptide ×4`), and a gene's mRNA variants
  as one row (`INS · 4 transcripts`, with an arrow once selected); see
  [Grouped features](05-features.md#grouped-features). A feature in
  several pieces (`join(...)`) has a dashed mark at each end of each gap
  and a chip naming the gap; see [Features in pieces](#features-in-pieces);
- **cut sites** of the enzymes ticked in the Enzymes tab, as marks with the
  enzyme name, unless **Cut sites** is off in the toolbar (see
  [Restriction enzymes](07-enzymes.md));
- the **GC content** track, when **Format ▸ GC content track** (`Alt+G`) is
  on: a line of the GC fraction under the strands, one point per base, with
  a hairline at 50 %; see [GC content](#gc-content);
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

Clicking a feature bar selects that feature — for a grouped bar, the first
of its features, and hovering the bar lists them all. Clicking a selected
transcripts row opens it, a row per transcript above it; clicking an open
row closes it. Clicking an amino acid on a
translation line selects that residue's three bases; hovering a split or
unfinished codon, or tapping it on a touch screen, says what it is. The pointer turns into a
hand over those tracks and stays a text cursor over the bases, where it places
the caret. Lowercase bases stay lowercase, as many people use case to mark
regions.

### Features in pieces

A feature whose location is a `join(...)` — a CDS or an mRNA with introns, or
anything else annotated in several pieces — is drawn as one bar per piece,
and where the pieces leave a gap the view says so:

- a **dashed mark** in the colour of the cut-site marks stands at each end of
  the gap, right after the last base of one piece and right before the first
  base of the next, running from the bases down through the feature's lane.
  It is why a codon on the translation line is split there (see
  [Split and unfinished codons](09-translate.md#split-and-unfinished-codons));
- a **chip** in the feature's lane, just after the first mark, names the gap
  and its size: `intron 436-1222 · 787 bp` for a CDS, mRNA or RNA feature,
  `gap 436-1222 · 787 bp` for any other. Positions are the sequence's own,
  1-based, and the size is the number of bases between the pieces. The chip
  moves along to the first row with room for it, and is left out of a gap
  too short to hold it;
- **hover the empty lane** between the pieces (or tap it on a touch screen)
  for the whole story: `INS: intron 436-1222, 787 bp. The exons are joined;
the feature continues at 1223.` On the reverse strand the feature continues
  at the end of the lower piece, since it reads right to left.

Pieces that touch (`join(1..100,101..200)`) share one mark and have no chip;
pieces that overlap, as a ribosomal frameshift is annotated, get a mark each
and the tooltip says by how much. An `order(...)` location gets no marks,
since its pieces are listed together but not joined. The bases between the
pieces are drawn as always — they are sequence, and other features, cut
sites and the ruler go on over them — so a long intron is scrolled past, not
folded. Exported figures carry the marks and the chips.

**File ▸ Export figure…**, with **Sequence view** chosen, writes what you
see as an SVG vector file, a PNG picture or a PDF for figures — the whole
sequence, the selection or a range, at a chosen number of bases per row, on
A4 or US Letter pages if you like; see [Exporting](02-files.md#exporting).

## GC content

**Format ▸ GC content track** (`Alt+G`) adds a track of GC content. In the
sequence view it is a band under the strands of each row, with a line for the
fraction of G and C in a window centred on each base and a hairline at 50 %.
On the map it is a ring just inside the feature lanes, with hairlines at 0
and 50 %; the name in the centre makes room for it. Hover the track for the
exact value, the window and the base. It is for DNA and RNA; a protein has
none, and the phone's reader leaves it out.

The window is **Automatic** until you choose one under the toggle (10 to 1,000
bases): 50 bases in the sequence view, and about 1 % of the sequence (at
least 10 bases) on the map, where a window as short as the sequence's
resolution would be noise. On a circular sequence the window wraps the origin,
so the line is continuous across it; at the ends of a linear sequence it is
the half window that exists. Ambiguity codes count for what they could be: S
is GC, W is not, R, Y, K and M are half, and N says nothing and is left out.
Both the track and the window are remembered in this browser. A long sequence
(over 200 kb) is worked out in the background, and the track appears when it
is ready.

The status bar also gives the **GC** of whatever is selected, whether or not
the track is on: `1,200 bp selected, 101 to 1,300, GC 52.3 %`. On a
circular sequence a selection across the origin is counted across it.

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

The toolbar's **Format** menu (`Alt+O`) sets how the sequence view draws.
It is laid out as a list of settings: each setting is one row, with its
choices side by side on the right, so every choice is in view and one click
away. Choices take effect at once and the menu stays open, so you can try one
and look. Tab walks the rows and the arrow keys move along a row's choices;
Escape closes.

**Sequence view** — the strands themselves:

- **Text size** — Small, Medium (the default) or Large. The rows, lanes and
  labels scale with the text, so a larger size gives a roomier view with
  fewer bases in a row.
- **Bases per row** — **Fit** (the default) puts as many bases in a row as
  the width holds, in tens, and re-flows when the window changes. Pick 30,
  60, 90 or 120 instead to keep the same rows whatever the window size —
  useful for comparing two windows side by side, or for an export that
  matches what you see — or type any count from 10 to 1,000 in the
  **Other** box under it and press Enter. If the fixed width does not fit,
  the view scrolls sideways.
- **Number the complement** repeats each row's position number beside the
  complement strand, so a wide row can be read from either line.
- **Colour the bases** gives A, C, G and T each their own colour on both
  strands; anything else (an N or another IUPAC code) is grey. While it is
  on, the four swatches under it choose the colours, for the sequence view,
  a read's trace and the SVG export alike; **Reset** goes back to the
  theme's, which differ between light and dark.

**Tracks** — what is drawn around the strands:

- **GC content track** (`Alt+G`) draws the GC content under the strands in
  the sequence view and as a ring inside the map; **Window** under it sets
  how many bases it is averaged over. See [GC content](#gc-content). Greyed
  out for a protein.
- **Translations** — which CDS features get an amino-acid line:
  **One per gene** (the default), **Selected CDS** or **Every CDS**. See
  [Which CDS features get a line](09-translate.md#which-cds-features-get-a-line).
  Greyed out for a protein.
- **Residue numbers** — **Every 10th** (the default) numbers the first
  residue and every tenth one above the amino acids under each CDS; **All**
  numbers every residue; **Off** leaves the numbers out and gives the rows
  back the room they took. See
  [Numbered residues](09-translate.md#numbered-residues). Greyed out for a
  protein, whose ruler already counts its residues.
- **Trace** — **Hidden**, **Short** or **Tall**, for the chromatogram of a
  sequencing read; see [Reads](15-reads.md). Greyed out unless a read with
  a trace is in front.
- **Feature types** — a tick for each type of feature the document has
  (`CDS`, `mRNA`, `exon`, `misc_feature`…; `source` is never drawn, so it is
  not offered). Untick a type to leave it out of the map, the sequence view
  and the map strip, so a record with several mRNA variants and exons can be
  read as just its genes. A hidden feature cannot be clicked on the map or
  the sequence, and a hidden CDS gets no translation line, whatever the
  Translations choice; it is still in the **Features** list and in a
  share link, a download or a GenBank file, which are unchanged. **Format**
  says "N hidden" while any type the document has is hidden, and **Show all
  feature types** brings them back. Each document keeps its own ticks, and
  the last ones you chose are where the next document you open starts (a type
  it lacks is ignored); they are remembered in this browser. See
  [Features](05-features.md#hiding-a-type-of-feature).
- **Transcripts** — for each gene with two or more mRNA variants, a select
  of **All** and each transcript's accession. Pick one to draw that
  transcript alone, with the CDSs and peptides it can carry; the gene's
  other variants leave the views and the Features list, and nothing is
  removed. **Format** says "N picked" while any gene is narrowed, and
  **Show all transcripts** brings every variant back. Absent when no gene
  in the document has two transcripts. See
  [Features](05-features.md#showing-one-transcript).

Under a separator, two items that are not about the sequence view:

- **Reset the layout** puts the panes back to the sizes they started at,
  see [Sizing the panes](#sizing-the-panes).
- **Keyboard shortcuts…** opens the table of every key, where a binding can
  be changed; see [Keyboard shortcuts](14-shortcuts.md).

The SVG exports follow the bases-per-row, translation scope, hidden feature types, transcript picks, numbering
(residue numbers included) and colour choices,
chosen colours included. They keep their own text size and font so the file
looks the same whatever the screen is set to. All of these are remembered in
this browser.

## Circular map

The map draws the backbone as a ring with tick marks, features as arcs in
lanes around it, and labels with leader lines. Features that share a name
(a gene and its CDS, for example) get one label, and a gene and CDS of the
same name on exactly the same bases are drawn as one bar, the CDS's, in
both views; the feature list still lists both. Features of one type on
exactly the same bases are one arc with a count, and a gene's mRNA
variants one row, in the same way (see
[Grouped features](05-features.md#grouped-features)). When a record has
more lanes than the map has room for, the lanes are drawn narrower, down
to 6 px, before the circle is allowed to grow past the pane. Cut sites of the ticked
enzymes are labelled on the same ring, unless **Cut sites** is off in the
toolbar. The centre shows the name and length when they fit whole; on a
narrow map the name is set smaller, and past that it is left out rather than
squeezed or cut short, since the toolbar has it. Under the name the length
reads "5,432 bp circular" or "5,432 bp linear", dropping the topology on a map
too narrow for it.

A linear sequence is drawn as an open ring with a wide gap (24 degrees, at any
map size) at the top. The sequence is laid out over the rest of the ring, so
the features, ruler, selection and clicks all stop at its two ends and nothing
is drawn or can be clicked in the gap. Each end has a cap across the backbone
and a number: 1 at the left end and the length at the right.

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
  do. A grouped arc selects the first of its features, and hovering it
  lists them; a second click on a selected transcripts row opens it, and a
  click on an open row closes it. **Double-click** the arc to zoom in on it.
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
  [Seeing what you changed](04-editing.md#seeing-what-you-changed).

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
an enzyme that cuts all over the plasmid. **Hover the count** (or tap it) to
list the labels that were left out.

A cut site's label that has less room than its full text (a map near the
edge of a narrow pane) loses its position first and reads just `AlwNI`, rather
than being cut in the middle of a number. Hover the tick mark for the whole
label with its position.

Nothing is lost by it. **Hover a feature arc or a cut site's tick mark** and
its name appears even if the ring had no room for it, drawn in a rounded
outline so that it reads as lying on top of the map rather than as a hole in
it. The feature list and the Enzymes tab list everything either way. Zooming in also frees up
room, since a label whose feature has gone off screen no longer takes a slot.

The SVG map export does not leave labels out — a figure has nothing to hover.
It grows its canvas around the same circle until they all fit instead, so an
exported map may be a little wider than it is tall, and it lets a label sit
further from its feature than the map on screen would, for the same reason:
on paper a name that did not fit is gone for good. A map with hundreds of
feature lanes gets a canvas big enough for the whole circle, so it is never
exported blank.

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

When you let go of a selection in the sequence view, a small bar appears
beside it with the commonest of these: **Style ▾** (see
[Colouring and enlarging bases](04-editing.md#colouring-and-enlarging-bases)),
**Case ▾** (see [Typing, deleting, replacing](04-editing.md#typing-deleting-replacing)),
**Add feature** and **Copy**, and how many bases are selected. It sits above
the selection, or under its last row, below that row's translations and feature
lanes, where there is no room above for the Style menu,
so the selected bases stay in view while you work on them. A selection
whose first and last rows are both out of view (`Ctrl+A` on a long sequence,
say) keeps the bar at the top of the view as you scroll. While the mouse
is elsewhere (a selection made on the map or from a panel) the bar is faded;
it comes back in full as soon as the mouse is over the sequence. Clicking a single
position, or selecting nothing, puts it away. The phone reader has its own
**Copy** after a long press instead.

## The checksum

The right of the status bar shows a short checksum of the open molecule, like
`cdseguid=dUxN7Y…`. Click it to copy the whole thing. A large document's
(50 kb and up) is worked out in the background once the document is on
screen; the status bar shows a dimmed `cdseguid=…` for the moment that
takes, and the checksum takes its place.

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
