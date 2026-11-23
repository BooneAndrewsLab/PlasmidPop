# 150. Features tab: filter the list by type (#453)

## What was asked

A quick way to narrow the Features tab's list to one kind of feature. An
NCBI gene opened with its flanks lists a source, a gene, an mRNA and a CDS;
BNI1 with its neighbours lists ten rows, three gene/mRNA/CDS triples; an
annotated plasmid or a larger region runs to hundreds. The list had no way
to find "the CDSs" short of reading every row. It has to work at phone
width, where the list is in the reader's Details panel.

## What was built

A row of toggle buttons above the list: **All**, then one for each type the
list has, each with its count.

- `src/view/featureTypeFilter.ts` is the logic, pure and tested on its own:
  `countTypes`, `typeChips` (what to offer), `foldChips` (what to show of
  it), `offersTypeFilter` (whether to offer it at all), `toggleType`,
  `filterByType`, `emptyFilterText`.
- `FeatureList.tsx` holds the chosen types and renders `TypeFilter`, the
  note for a filtered-out selection and the empty state.
- The styles are `.features__filter`, `.features__chip*` and
  `.features__note` in `src/styles.css`.

## Decisions

- **Chips, the app's own.** Each is `.button.button--small.button--toggle`
  with `aria-pressed`, the control Primers' result filters already use
  (ΔTm ≤ 1, GC clamp both), so the pressed look, the focus ring, the hover
  and the 36 px height under a finger (`pointer: coarse`) come with it and
  nothing new has to be learnt. The count is a second, quieter span.
- **Built from what the list has.** A chip exists for a type only while the
  list has a feature of it, so there is never a dead choice. The counts are
  of the list as it is shown, so with a transcript picked (item 119) what
  the pick leaves out is not counted, the same rule as Remove all (#316).
- **Many at once.** Any number of types can be on: "the genes and their
  CDSs" is as common a question as "the CDSs". A click toggles one type and
  leaves the others, so one click still gives the single-type case.
- **All is a chip, not a link.** It is pressed when nothing is chosen, which
  makes the unfiltered state visible as a state, and it is first, where a
  reset is looked for. Switching the last type off comes to the same thing:
  an empty choice means every feature, never none.
- **Order: as Format ▸ Feature types.** The same plain sort `drawableTypes`
  uses for the ticks of #305, so a type sits in the same place in both
  lists and does not move when a count changes.
- **When it is offered: two types or more, eight features or more**
  (`TYPE_FILTER_MIN_FEATURES`). A row is about 44 px; under eight rows the
  whole list is in sight on a desktop panel and on a phone's, and a row of
  buttons above four features (the ACT1 case) costs more reading than it
  saves. Ten rows (BNI1) get it. One type gives nothing to choose. A filter
  that is set is always shown, whatever the list has shrunk to, so it can
  always be cleared.
- **Folding past eight types** (`TYPE_FILTER_FOLD`). The chips wrap, so
  every choice is visible without a sideways scroll, but seventeen types
  measured 257 px of chips on the desktop panel and 338 px at 36 px touch
  height on a 341 px phone. Past nine types the eight with the most
  features are shown, in the usual order, and the rest are behind **+N
  more** (`aria-expanded`), which **Fewer types** folds again. A chip that
  is on is never folded, and nothing folds for a single extra chip. Whether
  it is open is not remembered; it is a way to reach a chip, not a setting.
- **The selection is never dropped.** Filtering is not selecting: the
  selection is the store's, the views still show it, and the status bar
  still reads it. When the selected feature's row is filtered out, a
  `role="status"` note above the list names it and its type and offers
  **Show _type_ too**, which adds that type to the filter; the row is then
  scrolled into view. A selection made on the map while a filter is on gets
  the same note. The filter is not widened by itself: it was set on
  purpose, and a list that changes its own filter on a map click cannot be
  relied on.
- **A row being renamed or edited is exempt.** Add feature opens the new
  feature in the list's editor as a `misc_feature`; under a CDS filter its
  form would not be there. `filterByType` takes the ids to keep. Once the
  editor closes the row follows the filter, and the note above says where
  the selection went.
- **Empty state.** A chosen type can lose its last feature (removed, or
  left out by a transcript pick). Its chip then stays, on, at 0, and the
  list reads "No CDS features in this list." with **Show all**. Dropping
  the chip silently would leave an empty list with nothing pressed.
- **The header counts.** `Features 3 of 10` while filtered, where it read
  `Features 10`. The count does not break inside itself, and the title's
  right padding inside the header went so that `166 of 1,241` fits beside
  Detect features in the 300 px panel.
- **View only.** Nothing in `editorStore` knows about the filter: no edit,
  no history entry, no unsaved mark, and the map, the sequence view, the
  figure, files and share links never read it. Remove all N _type_ still
  removes every feature of the type. It is independent of the hidden types
  of #305, which decide what the views draw and leave this list whole.
- **Kept per document, for the page load** (`useRemembered`, slot
  `features.typeFilter`). The list is unmounted whenever another sidebar tab
  is shown, so plain component state would lose the filter on a glance at
  Enzymes. Keyed by document it comes back with the tab, each document has
  its own, and a document just opened starts unfiltered, because its types
  are not the last one's. It is not saved with the view settings: a filter
  found still on a week later, hiding most of the list, is a puzzle, and
  setting it again is one click.
- **Keyboard.** Plain buttons in a `role="group"` labelled "Filter by
  type", before the list in the tab order; Space and Enter toggle. Each
  chip's accessible name is spelled out ("CDS, 3 features") because "CDS 3"
  read aloud is not a count. No key binding was added: there is no single
  action to bind.
- **Phone.** The reader's list gets the same filter (it changes nothing in
  the document, which is the reader's rule). Chips wrap inside the panel;
  a type name too long for a row is cut with an ellipsis.
- **Analytics.** `features / filter`, once per visit, sent when a type chip
  is switched, with no name: not the type, not a count (item 38).

## Rejected

- **A text search box.** Find already searches feature names and types
  across the document and steps through the matches; what it cannot do is
  shorten this list. A typed "cds" is also slower than a click on a chip
  that shows the count before it is clicked.
- **A `<select>` or a single-choice segmented control.** One type at a time
  cannot ask for genes with their CDSs, and a select hides the counts and
  the choices behind a click.
- **A sideways-scrolling row of chips on a phone.** It keeps the height
  down but hides choices past the edge with no sign that they are there.
  Wrapping with a fold keeps every shown chip in sight.
- **A sticky filter row.** It would stay reachable from deep in a long
  list, but a wrapped row of chips pinned over a phone's panel leaves too
  little list. Once a filter is on the list is short, and the
  top is one flick away.
- **Reusing Format ▸ Feature types.** Hiding a type in the views and
  listing it here are different wishes (the note on #305 says hidden types
  stay listed); tying them would make the list lie about the document or
  the map lose features the user only wanted to find.
- **Widening the filter when a filtered-out feature is selected.** See
  above: the note keeps both the filter and the selection.
- **Ordering the chips by count.** It puts the big types first but moves
  chips when an edit changes a count, and disagrees with the Format menu.
  Counts decide only which chips fold.
- **A swatch of the type's colour on each chip.** A feature's colour can be
  its own (ApE, SnapGene), so a chip could show a colour none of its rows
  has.

## Checked by

`src/view/featureTypeFilter.test.ts` (the functions) and
`src/app/components/FeatureTypeFilter.test.tsx` (the list: when the filter
is offered, labels, counts and `aria-pressed`, tab order, toggling, All,
that the store is untouched, the filtered-out selection and its way back,
the edited row, the empty state, counts after an edit and Undo, memory per
document, the fold, the reader, the event). The layout was looked at in
Chrome in the dark theme: the 300 px desktop panel, and the phone reader in
390 px and 341 px frames, with 5 and with 17 types (the touch height by
lending the frame the `pointer: coarse` rules, which a desktop Chrome does
not apply).
