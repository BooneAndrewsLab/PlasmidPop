# Viewing and selecting

The toolbar's view switcher shows the **Sequence** view, the **Map**, or
**Both** side by side. The two views share one selection: whatever you select
in one is highlighted in the other and reported in the status bar as
`N bp selected, from to to` (1-based, inclusive).

## Sequence view

Bases are laid out in rows that fill the available width, with a ruler
above each row giving the position of its first base. Below each row:

- the **complement** strand, when **Complement** is on in the toolbar;
- one line of **amino acids** per CDS feature, when **Translations** is on
  (see [Translation](09-translate.md));
- **features** as coloured bars with their names, stacked into lanes when
  they overlap;
- **cut sites** of the enzymes ticked in the Enzymes tab, as marks with the
  enzyme name.

Clicking a feature bar or a translation line selects that feature. Lowercase
bases stay lowercase, as many people use case to mark regions.

**File ▸ Export sequence view as SVG** writes what you see as a vector file
for figures, see [Files](02-files.md).

## Circular map

The map draws the backbone as a ring with tick marks, features as arcs in
lanes around it, and labels with leader lines. Features that share a name
(a gene and its CDS, for example) get one label. Cut sites of the shown
enzymes are labelled on the same ring. The centre shows the name and length.
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

Lane widths and fonts do not change with zoom; the tick marks get denser as
you zoom in.

## Selecting

In the sequence view:

- **Click** between two bases to place the cursor there. The status bar says
  `Cursor after base N`.
- **Drag** to select a range; **Shift+click** extends the selection to the
  clicked position.
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
