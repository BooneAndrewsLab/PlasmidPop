# 127. Select and copy in the alignment's large view (#366)

**Asked:** pick a run of nucleotides or amino acids in the Canvas-drawn
alignment and copy it. Native text selection does not exist on a canvas.

**Built:** our own selection, `src/app/alignmentSelection.ts`: one row (the
document's or a sample's) and one strip (bases or amino acids), an anchor
column and a head column, inclusive of both. Drag, or Shift-click to move the
head, sets it; `selectionTargetAt` (in `alignmentStackDraw.ts`, beside
`rowAtOffset`) says which row and strip a pointer is on. `drawStack` paints
it as a tinted, outlined block; an export does not carry it.

**Decisions** (the issue's defaults):

- Ctrl+C copies the sample's own residues, gaps and uncovered columns left
  out; Ctrl+Alt+C copies the row as drawn, gaps kept and uncovered columns
  as `-`, the form of aligned FASTA. Text is as the row is shown, so a read
  that aligned reversed copies reverse-complemented.
- Any single row, the document's included. A selection never spans rows, so
  the result is one sequence rather than a block needing a layout.
- An amino-acid strip copies the translated residues of each codon the
  columns touch (any column of it, not all three), in reading order, one
  line per CDS. A sample's residue is `residueOf`'s, the same the strip draws,
  so a partly covered or indel codon is `-`.
- The selection is dropped when the stack changes (hide, show), since columns
  move.

Not covered by tests: the pointer handling in `AlignmentStackView` (a real
browser was not driven); the pure pieces are.

## The bar and the Advanced copy panel

**Asked:** the two keys cover one row's residues or aligned row, and nothing
else: not the reference beside a sample, not every row in register, not the
amino acids with the bases, not FASTA. A menu of fixed combinations would
grow with each wish. Instead, a bar beside the selection with the one-click
copy, and a panel where the copy is composed from options.

**Built:**

- `AlignmentSelectionBar`: Copy (the residues, as Ctrl+C), Advanced copy…,
  and the column count, in the scroller's content space like the sequence
  view's `SelectionBar` (#89), whose `.selection-bar` styling and fade it
  shares. `AlignmentStackView` places it: above the row when there is room
  under the pinned header, else below; for the pinned reference always just
  below the header, so it never sits on the reference's own strips (it may
  sit on the first sample, which is not the selection). It is kept inside
  the view sideways with fixed `BAR_WIDTH`/`BAR_HEIGHT` estimates rather
  than measured, and not drawn while dragging or once the row has scrolled
  under the header. Ctrl+C is unchanged: never a popup.
- `alignmentCopy.ts`, pure: `CopyOptions` (rows: selected / with the
  reference / all; columns: selection / all; gaps: kept / dropped; tracks:
  bases / aa / both; format: text / FASTA; names; coordinates),
  `copyLimits` (what the context rules out: gaps are kept once several rows
  go out, so they stay in register; bases only without residues in view;
  "with the reference" is moot on the reference), `effectiveOptions` (the
  same fallbacks, so the copy is what the preview shows), `copyOutput`
  (text, row and column counts), `previewLines`, `largeCopyWarning` (a
  warning above a million characters, never a refusal), and the
  localStorage round trip (`plasmidpop.alignmentCopy`, try/catch, each
  field checked on the way back). It builds on `rowBases` / `rowResidues`,
  now exported from `alignmentSelection.ts`, and on `alignmentText`'s
  `fastaRecord` and `cut`, so the Export popover's FASTA and this one are
  one writer. Three formats collapsed to two plus a Names chip: text
  without names is the bare form, so a third button would have been a
  redundant state.
- `AlignmentCopyPanel`: an `AlignmentPopover` hung from an empty absolute
  anchor placed where the bar is (`.astack-copy`, in the `.astack`'s own
  space, which is why `.astack` became `position: relative`), so the
  popover's frame, right-edge fitting and family look are reused as they
  are; the panel lifts itself when it would pass the window's foot. The
  choices are `SegmentedChoices` (real radio groups) and toggle chips (real
  checkboxes under a pill, `.astack-pop__chip`); the preview is the first
  six lines, cut, with "N more lines" and a count. Esc closes the panel
  before the window: the window's Esc listens on the document in the
  capture phase, so the panel listens on the window, which the event
  reaches first. A press outside closes it; a copy closes it, notes what was
  copied under the alignment and hands the focus back to the scroller.
  Opening it puts the keyboard on the chosen Rows choice.

**Decisions:**

- Which samples go out is "all shown": the Samples popover already hides
  rows, and a second pick list here would have fought it.
- The track opens on the strip the selection is on (as Ctrl+C decides),
  unless Both was chosen last time; the other settings are remembered as
  left.
- A row's amino acids are named `row|CDS|aa`, in text and in FASTA, so a
  FASTA id stays unique when a row has several CDSs.
- Gaps kept now writes a codon the sample does not reach as `-` (it was
  left out), the same as the bases form does for uncovered columns, so the
  residues of several rows stay in register; Ctrl+Alt+C follows, and the
  guide says so.
- Analytics: `alignment-selection / copy`, named `bar`, `text` or `fasta`;
  never what or how much.

Not covered by tests: the bar's placement arithmetic and the panel's
lifting (DOM geometry); seen in a browser once, desktop width only. The
alignment window is not offered by the phone shell, so a narrow viewport is
a narrow desktop window: the popover's `max-width` and the preview's own
horizontal scroll keep it inside one.

## The multiple alignment (#368)

**Asked:** the same selection, bar and panel in the multiple-alignment window
(`MsaDialog`), which had only whole-alignment Save and Copy FASTA.

**Built:** the same experience on a different data shape. The MSA has plain
strings (`alignment.rows`), a consensus row and no reference, strips or
tracks, so its pure side is its own and small: `msaSelection.ts` (selection,
hit test of the canvas, what Ctrl+C copies, the bar's placement, which is
pure here unlike the large view's inline arithmetic) and `msaCopy.ts`
(options, `msaCopyOutput`, remembered under `plasmidpop.msaCopy`). The
parts that do not depend on the data are shared rather than copied:
`CopyPanelFrame` is the panel's shell (popover, Esc, press outside, lifting,
preview with counts, large-copy warning, Copy) with `CopyExtras` for the
Names and Coordinates chips, and `AlignmentCopyPanel` was reduced to its
choices on top of it; `CopyOutput`, `copySummary`, `previewLines`,
`largeCopyWarning`, `fastaRecord`, `cut` and the storage helpers are the
large view's own; `AlignmentSelectionBar` is used as is (a tooltip prop).

**Decisions:**

- The consensus row is selectable: it is a row of letters, and its copy is
  a reasonable thing to want. It is pinned, so its bar sits just under the
  header. Its gap-majority `-` columns are gaps like any other.
- Rows: this row, every sequence, or the consensus and every sequence. The
  large view's "with the reference" has no counterpart.
- Removed as inapplicable: Tracks (no amino-acid strips) and any reference
  wording. Gaps follow the large view: several rows go out with gaps kept.
- Coordinates: the large view's reference positions do not exist here, so it
  is the columns plus the sequence's own residue numbers (`residues 12-40`),
  none for the consensus. Text carries the residue numbers only when a single
  sequence goes out; FASTA puts them after each name.
- Unit in the copy note is `base` or `residue` by the alignment's alphabet.
- Analytics: the same `alignment-selection / copy` event, named `bar`,
  `text` or `fasta`.

Not covered by tests: the pointer handling and the panel's placement in
`MsaDialog` (DOM geometry); the pure pieces are.

## Click, marker and selection (#370)

**Asked:** two things found testing the above. In the large view the
column marker (`marked`, set by Go to, Find, Prev and Next, and until now
by every click on the canvas, the one that ends a drag included) was drawn
as a band beside a dragged range, two "selected" ideas at once. And a click
on a cell with no letter (a column the sample does not reach) started a
one-column selection with the bar, so clicking away to clear re-selected.

**Decided**, after comparing a text editor's caret and selection, a
spreadsheet's cell and range, and SnapGene's, Geneious's, Jalview's and
IGV's clicks:

- **The marker is navigation's alone.** It stays a concept apart from the
  selection, because it answers a different question ("where did Go to,
  Find, Prev or Next bring me?"), spans every row and the overview where a
  selection is one row's, and is the stop the Reviewed and Take buttons act
  on, so selecting must not drop it and it must not drop a selection. A
  click no longer sets it; that was its only overlap with selecting. Folding
  it into the selection was rejected: Next would then raise a copy bar on
  every stop, and a difference has no single row to select on. The band
  through all rows that a click used to give is gone; nothing else used it.
- **A plain click on a letter is a one-column selection**, drawn like any
  other, the anchor a Shift-click extends from (the spreadsheet's cell, not
  the editor's caret: the grid's unit is a cell, so there is no "between"
  position to put a caret at, and one base is a real thing to copy).
  Ctrl+C copies it.
- **The bar floats from two columns** (`BAR_FROM_COLUMNS`), once the button
  is up. A click is an anchor or a click-away, not a request for a toolbar;
  "1 column" said nothing; a floating bar on every click read as a popup.
- **A cell with no letter is blank space.** A press on one clears the
  selection and selects nothing, like a press on the ruler: the blank before
  and after a sample's stretch, a codon outside every CDS or that the sample
  does not reach, and past the alignment's end (the column used to be clamped
  to the last one, so a click right of the reference selected its last
  base). A gap's `-` is a letter, on both windows, and so is an indel's `-`
  on an amino-acid strip: they are drawn. In the MSA only a column past the
  end is blank. A drag may still begin or end on blank cells (the press
  becomes a `pending` anchor and the selection starts when the pointer
  reaches another column, as an editor's drag from past a line's end), since
  a range over the columns a sample does not reach is meaningful: the
  aligned copy writes them as `-`, and Advanced copy's other rows have
  letters there.
- **Esc**: the Advanced copy panel first (it takes Esc on the window before
  either dialog's listener), then the large view's Find or Go to form, then
  the selection, then the window: the same ladder the forms already had,
  one rung longer. The large view's order lives in `AlignmentDialog`, which
  owns the forms, through `StackHandle.clearSelection()`.
- **One reducer for both windows**, `selectionGesture.ts` (press, move,
  release, `barWanted`), generic over the selection type, so the large view
  and the MSA cannot drift apart; each window only hit-tests
  (`selectionTargetAt` + `cellHasLetter`, `msaRowAt` + `msaCellHasLetter`).
- Touch is as it was: no selection; a tap names what is under it.

Tests now drive the canvases in jsdom (`AlignmentStackView.test.tsx`,
`MsaDialog.test.tsx`, with the stack's and the MSA's drawing mocked and
the scroller's size stubbed) and the dialog's Esc ladder
(`AlignmentDialog.escape.test.tsx`, with a real alignment).

## The range guide (#371)

While a selection exists, both windows shade its columns at alpha 0.12
(`SELECTION_GUIDE_ALPHA`, the accent colour as the selection's fill, so it
follows the theme) on every row from the reference (large view) or consensus
(MSA) down: one rectangle, clipped to the columns beside the names and to the
rows below the ruler (and, in the large view, the feature track). The ruler,
the feature track and the conservation bar are left alone: the guide is
about the rows being compared, and a band across the bar would read as
conservation. It is under the navigation marker's 0.16, so the two do
not read as one thing. The selected row keeps its 0.3 fill and outline. An
amino-acid selection uses the same column range as its fill. It is drawn only
inside the selection's block, which exports never reach, so it is not in a
saved picture. The large view's overview canvas gets no matching range: it is
a separate drawing, and a second faint mark beside the marker's would crowd
it.
