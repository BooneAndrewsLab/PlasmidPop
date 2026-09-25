# 53. Base styles: colour, highlight, bold and size

Done, 2026-09-25 (#89, #91; `src/core/document/baseStyles.ts`,
`src/io/genbank/baseStylesComment.ts`, `src/view/linear/rowBreaks.ts`,
`src/app/components/BaseStyleMenu.tsx`). This came from a colleague: _allow
changing colours of selected nucleotides – user would like to highlight a
region using a colour_, and _allow changing font size of selected
nucleotides – again for highlighting purposes_.

## Not a feature

The first idea was to make a highlight a coloured `misc_feature`, which
every format already round-trips. The user turned that down: the ask is
simpler than an annotation, only a colour on some bases. So a style takes no
lane, is not in the feature list, is not on the map and is not compared by
Compare or the edit marks. It is still part of the document, since it has to
survive a reload and move with edits.

## The model

`BaseStyles` is an immutable list of sorted, non-overlapping runs over the
unrolled coordinates `[0, length)`, each carrying a `BaseStyle`: `color` and
`highlight` (`#rrggbb`), `bold`, and `size`, one of `BASE_SIZES` (1.25, 1.5,
2). A run never wraps. A style across the origin of a circle is two runs, so
there is no wrap arithmetic in the runs themselves. Neighbouring runs of one
style always merge, so any set of styles has one way to be written down and
equality is run by run.

A `styleBases` op carries a `BaseStylePatch`. A value sets that part of the
style, `null` takes it off, and a part left out stays as each base has it.
So colouring a stretch keeps whatever of it was bold, and
`CLEAR_BASE_STYLE` is all four set to null. It is an annotation op in the
store's terms (analysis results stay exact) and leaves the selection where
it was.

How edits move styles, in `SeqDocument`:

- Insert: bases inserted strictly inside a run take its style, as letters
  typed into coloured text do. At either edge of a run they are ordinary.
  That is the linear neighbours only: position 0 of a circle is an edge
  even when the runs on both sides of the origin are alike.
- Delete: runs shrink or go, and alike neighbours either side join.
- Replace: the common prefix is overwritten in place and moves nothing,
  then the rest is an insert or a delete, as for features.
- Paste (`insertFragment`): the pasted bases get the fragment's own
  styles and never inherit from the run they land in. `SeqFragment.styles`
  is optional, so old clipboard JSON still reads.
- Reverse complement mirrors the runs. Set origin rotates them, splitting
  the run the new origin falls in. Changing topology moves nothing.
- Extract (export a selection) keeps the styles of its bases, across the
  origin too.

`baseStyles.property.test.ts` checks all of this against a per-base array
edited with `splice`, and the shared edit arbitraries now include style ops,
so the store, history and GenBank property tests exercise them too.

## Where styles are kept

- GenBank, and through it IndexedDB and share links (both store GenBank):
  a `PlasmidPop-base-styles: 1` COMMENT block, with the runs 1-based and
  inclusive, as many to a line as fit in 67 columns
  (`1..20:color=#d62728,bold 41..45:size=1.5`). It works like the sticky-ends
  and made-from blocks: taken out of the comments on read and written afresh
  on save. A block that cannot be read whole stays as an ordinary comment
  (#72). Runs past the end of the record are dropped, with a warning.
- The stored undo history: the whole list of runs in a delta whenever it
  changed. It is small, and replaying it through the sequence change would
  gain little.
- FASTA has nowhere to keep styles, and they are not in SnapGene's format
  as we read it.

## Larger bases: reflowing the rows

The user asked for both kinds of emphasis: bold, which keeps the grid, and a
real larger size, knowing mixed sizes on one line are awkward. A larger base
here is drawn larger and is wider. The alternative, a larger glyph squeezed
into an ordinary cell, overlaps its neighbours as soon as two in a row are
enlarged.

So rows are filled like the lines of a paragraph (`RowBreaks`). A row holds
at most `basesPerRow` ordinary columns, a base of size _s_ uses _s_ of them,
and a row always has at least one base. A row holding larger bases therefore
holds fewer, the rows after it start where it stopped, and its strand lines
are as much taller as its largest base. Every letter sits on the line's one
baseline, the way larger words sit in a line of text. Rows with no larger
base are still exact multiples of `basesPerRow`, found by division. The rest
are found by binary search.

The consequences:

- Nothing in a row may compute x as `column × charWidth` any more.
  `LinearLayout.xOf(row, position)`, `widthOf` and `offsetAtX` (its inverse,
  for hit testing) account for the wider bases. The renderer, the trace and
  the SVG export all use them. `xOfColumn` is left for rows known to be
  plain (the diff strip) and the gutter.
- Anything counted per row (feature lanes, translation lines, preview
  lanes) takes the `RowBreaks` instead of a bases-per-row number, since the
  counts are needed before the layout that uses them can be built.
- The ruler ticks every tenth base counted from the start of the sequence,
  not every tenth column of the row, because a row after larger bases need
  not start on a ten.
- ↑ and ↓ move to the base straight above or below
  (`positionInRowBeside`), not ± a row's worth of bases.

Letters on a highlight with no colour of their own are drawn in
`contrastingText(highlight)`, so a yellow highlight reads in the dark theme
too. The swatches offered are light for the same reason.

## The selection bar

The Style button was hard to find in the edit bar, even for the person
designing the tool: in the Both view that bar starts above the map, far
from the bases being selected. The fix chosen was a small bar that floats
beside the selection (`SelectionBar`) with Style, Add feature, Copy and the
selection's length. It is the most-used actions on a selection, where the
eye already is. The edit bar keeps all of them, and `Alt+Y` stays with the
edit bar's copy of the menu, so only one menu answers it.

- It appears when a drag ends, not during one, so it does not jump about
  under the pointer.
- It goes above the selection's first row, over its ruler, when the open
  Style menu (about 380 px) fits above it, and the menu then opens upwards.
  Otherwise it goes under the last row with the menu opening down. Either
  way the menu does not cover the bases it is restyling. It is hidden when
  neither place is on screen.
- Desktop only. The phone reader (`reader`) has its long-press Copy (item 15) and no room over its bases.
- Counted as `selection-bar / add-feature` and `/ copy`. Styling counts as
  the `styleBases` edit it makes.

Moving the edit bar itself to sit over the sequence pane was discussed and
left for now. The floating bar was preferred.

## Not done

- Styles on the circular map. Asked only for the sequence view. A highlight
  arc on the backbone would be the natural form.
- Styles on phones: the phone reader shows them but has no Style menu.
