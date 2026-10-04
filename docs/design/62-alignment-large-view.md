# 62. Alignment in a large view (#103)

**Asked:** results of the Align tab in a surface big enough for a plasmid
against a plasmid, with Benchling-style stacked tracks, one scroll, and an
overview of differences.

**Built:**

- `src/app/alignmentStack.ts` lays several pairwise alignments (each to the
  same reference) in one column space. Boundary `p` (before reference base
  `p`) gets as many columns as the longest insertion any sample has there;
  shorter ones are padded. The reference row is the whole reference, so
  samples over different stretches sit where they belong; it runs past the
  end only for a read through a circle's origin. Not a true MSA.
- `AlignmentStackView` draws on Canvas 2D, only the columns and rows in
  view: one scroller with a sticky viewport-sized canvas, names pinned left,
  ruler and reference pinned top. The overview canvas marks each difference
  and the viewport rectangle; click/drag jumps.
- `AlignmentDialog` (portal, Esc closes, focus returns, Alt+N / Alt+Shift+N
  for differences). Opened from a single result or, for Align all, with
  every aligned read.

**Not yet:** a phone-specific layout
beyond the full-window dialog; #102 feature track and #104 difference
colours by feature class build on the stack (`Stack.refIndex` maps a
column to a reference position).

**Feature track (#102):** `src/app/alignmentTrack.ts` maps the document's
features and the ORFs the app already found onto stack columns through
`Stack.refIndex` (a document range becomes the columns of its first and
last base, so insertion columns inside it are covered; a circular document
also tries the range shifted by its length, which is how a feature over the
origin appears at both ends of a read that runs through it). Annotations are
packed into lanes by first fit, features above ORFs, capped at eight.
`AlignmentStackView` pins the track between the ruler and the reference row.
A sample's own features on its row came with #128 (below).

**Difference colours (#104):** `classifyColumns` in `alignmentTrack.ts`
gives every stack column a class, the highest of the annotations covering
it: a `CDS` feature or a found ORF is `Cds`, any other feature (not
`source`) `Feature`, else `None`. It reuses the track's `spansOf` mapping,
so insertion columns inside a feature take its class, a selection offset
applies and a feature over a circle's origin is found on both sides. It
takes all the document's features and ORFs, so the colours do not change with
the Features/ORFs boxes (an unfinished ORF search just means fewer CDS
columns until it lands). Classes depend on the reference only, so the
overview's "worst class in a column" is simply that column's class.
`countByClass` counts `stack.differences` (per differing column, not per
cell) for the heading. Colours are `--diff-cds/-feature/-none` in
`styles.css` (red, blue and grey, lighter in the dark scheme; chosen for CIEDE2000 distance also under protanopia and deuteranopia, issue #111). Kinds are told
apart without colour by a bar: foot for a deletion, head for an insertion;
mismatch is a plain block, and an ambiguity-only match a paler one (it is
not in `stack.differences` nor counted). Without a document every difference
uses the `None` colour and there is no legend. The canvas drawing was not
checked by eye.

## The panel's text alignment removed (#109)

The Align tab no longer prints the alignment (blocks of 60 with `|`
markers): the large view is the one place it is read. The result keeps its
heading and numbers, the confident-difference list (a click still selects
the base in the document, but no longer scrolls a block, there being none),
the heading, which finds the aligned region (#108, below), and **Large view**, now the primary
button. It is not opened automatically for a single result: an alignment is
often re-run while settings are tuned, and a window opening each time would
be in the way. The block renderer, `AlignmentTrace`, the `.alignment*` CSS
and their tests went. That took the AB1 trace under the read and the dotted
marks on poor read bases with them; #110 brought both back into the large
view (below). Batch rows and phone layout are unchanged
(the row list and the result above still stack in the panel). Not checked
by eye.

## Pointing at a result finds its region (#108)

The panel's **Select aligned region in this document** button is gone (the
large view keeps its own). The result's heading is a button instead, and so
is each batch row (the whole row, so it is easy to hit; the name button keeps keyboard focus). Hovering or focusing it draws the aligned
region in both views without changing the selection; clicking or Enter
selects and reveals it (a batch row also shows its alignment, as before).

The transient highlight reuses the existing preview channel (the dashed
purple spans the Primers, Find and ORF panels use) with a new owner,
`'align'`, rather than a new store field: it is already outside history,
per document, cleared by any edit, and drawn by both the Canvas linear view
and the circular map. `alignedRegionSpan` (readAlignment.ts) makes the span
from `alignedRegionInDocument`: a range through the origin stays unrolled
(start inside the sequence, end past it) which both views already draw at
both ends; a start past the end is brought back in and the length capped at
one turn. It cannot stick: the effect holding it cleans up on pointer leave,
blur, click (the selection shows the region then), the result being
replaced or removed, unmount and leaving the tab. A touch pointer does not
hover, so a tap only selects. Not checked by eye.

## The form's layout (#107)

The form had grown by accretion. Inventory before the change, in DOM order:
this document is the read (toggle, only when the document is a read); the
sequence box; Choose file…; Open tab… (select, only with other tabs); the
record picker (only with several records); a note; then one wrapped row of
Alignment mode (select), Trim poor ends (toggle, only with reads), Against
selection only (toggle, disabled without a selection or for a read) and the
Align / Align all button; the "Local, since…" note; Confident from and Trim
at (selects, only with reads); progress with Cancel; the error.

After, in DOM (and tab) order:

- The note, the box, then Choose file… / Open tab… / the record picker and
  their note: getting a sequence in.
- Align / Align all on a row of its own, straight after, then progress with
  Cancel and any error: the common path ends here.
- A fieldset **Options**: This document is the read, Mode (now with a
  visible label), Against selection only (with a title saying why it is
  disabled), and the "Local, since…" note, which sits with the mode it is
  about.
- A fieldset **Reads** (only with reads in play): Trim poor ends,
  Confident from, Trim at.

Decisions: fieldsets with legends, as the feature editor's qualifiers use,
rather than a collapsible `<details>`: Mode is used often and its auto-choice
note must not be hidden, and the app has no pattern for remembering a
`<details>` state. Everything stays reachable and visible, and nothing
changed but layout, labels and grouping. The form stays in AlignPanel.tsx;
moving it out would have meant threading some twenty pieces of state. The
fieldsets use the panel's flex rows, so they wrap in the narrow sidebar and
at 390 px. Not checked by eye.

## Trace and poor bases in the large view (#110)

A `StackRow` carries `readIndex`, per column the index of the read base there
in the trace's own numbering (`alignment.startB + offsetB`, counting up
through the read's bases only, so a gap column has -1); null without a
trace. A read that aligned reversed has its trace reverse-complemented by
`finishReadAlignment`, so the same numbering holds for both strands.

With the toolbar's **Trace** ticked, a row whose read has a trace is taller
by `TRACE_HEIGHT` and `drawTrace` (`src/view/trace.ts`, unchanged) draws the
columns in view, each base centred on its column. Rows therefore have
different heights: `AlignmentStackView` keeps a `tops` table, and picking a
row and the visible range use a binary search on it instead of dividing by
`ROW_HEIGHT`. The overview still spaces rows evenly. Poor bases (below the
confident quality) get a grey block behind the letter as well as the fade,
which had been the only mark. Not checked by eye.

## Amino acids (1.10)

The toolbar's **Amino acids** draws, under the reference row and under each
sample's, the residues of the document's CDS features (`alignmentResidues.ts`).
Codons come from `translateCds`, so `/codon_start`, `/transl_table`,
`/transl_except` and the strand are honoured, and each is placed on the three
columns its bases sit in (also through a circle's origin, as `buildTrack`
does). A sample's residue is its three aligned bases translated in the
reference's frame, so a deletion or insertion inside a codon is a `-`
(`Change.Indel`) and a frameshift is not re-read downstream: that would need
the sample's own ORF, which is a different question. The strips add
`AA_HEIGHT` to the pinned header and to every row, taken into the `tops`
table like the trace. Not checked by eye.

## Controls regrouped (#119)

The toolbar had Next/Previous at the far right after a centred block, long
labels that wrapped it to three rows, its own toggle style, no position
count, and no way for a keyboard user to pick a sample (only a click on the
canvas). It is now three zones in one row: Navigate (the `.segmented` pair
and a "3 of 41" counter from `differenceRegions`), Sample (a labelled select
kept in step with canvas clicks, and a shorter "Select in document") and Show
(the main toolbar's `.segmented` group, remembered between openings in a
module-level object, not the store, since it is a per-session convenience).
The summary and the colour key moved to a status row beneath, so no control
shares a row with reading text. "N not shown" moved into that row and the
Features title. Alt+N now goes through the `next-change` binding and Alt+T
through `toggle-translations` (stopping the event so the editor underneath
does not also toggle). Not done: the proposed "Show ▾" menu on a phone; the
group simply wraps below 720px. Not checked by eye.

The Sample select was taken out again after a try: it repeated the canvas,
and put a choice about the view in the toolbar among the actions. Up and
Down on the focused alignment pick a row instead (the keyboard gap the
select was for), scrolling it clear of the pinned header, and **Select in
document** sits at the end of the picked sample's score line in the status
row, beside what it acts on, shown only once a sample is picked.

## Verification verdict and coverage (#120)

`alignmentVerdict.ts` turns a stack into an answer to "is the construct
right?". `coverageOf` counts, per column and per strand, the rows that stand
behind the column: a base (or a deletion the read spans) at or above
`readConfidentQuality`; a read with no qualities counts wherever it reaches,
and a gap's NaN quality counts as the read spanning it. `coverageBand` folds
that to 0, 1 or 2+ for a band of `COVERAGE_HEIGHT` under the overview's
marks. `verdictsOf` gives each non-ORF annotation (reusing `spansOf`, now
exported) one of Confirmed, Differences, Partial or NotCovered. Partial is
not in the issue's three: a feature half-read with no difference is neither
confirmed nor missed, and saying "not covered" would hide the half that is.

Decisions. Only reference columns count towards coverage, since an insertion
in one sample is padding in the others and would otherwise read as a gap. A
difference counts only where the differing row's base is itself good, so a
poor stretch neither confirms nor condemns (`confidentDifferences`); the
view still shows it faded. The read count is the fewest over the feature's
bases, the number a reader can rely on end to end. "One strand only" is
said when every covering read is forward or every one reversed. Bases are
keyed by `refIndex mod length` on a circle so a feature across the origin,
seen at both ends of the reference row, counts each base once, taking the
better copy. The verdicts are a list of buttons between the status row and
the stack (click to scroll to the feature); they follow the document's
features even when the Features box is off. Not checked by eye.

## List of differences (#121)

`alignmentDifferences.ts` turns the difference regions into rows: columns
`[start, end)` (0-based), the position of the first and last reference base
the region touches (1-based through `columnPosition`, so a circle's wrap is
taken modulo its length; an insertion-only region sits after the base before
it), the reference's bases and each carrying sample's, the lowest quality
over that sample's differing columns, and the feature class. A sample
"carries" a region when any of its cells there is a difference
(`isDifference`), so a poor-quality base is listed (with its Q) rather than
hidden. The feature is the highest class the region overlaps by `spansOf`,
a CDS before the ORFs on it, as the shading classes it.

The protein effect reuses `buildFrames` and `residueOf` and does not
translate again, so the reverse strand (reverse complement before
translating) and `/transl_except` come for free. `CodonColumns` gained
`index`, the codon's number in reading order, because frames drop codons that
fall outside the alignment and an array position is not the residue number.
Decisions: an indel anywhere in a region that overlaps a frame is a
frameshift unless the region's net inserted minus deleted bases is a multiple
of three ("in-frame indel"); it takes precedence over a mismatch beside it.
Otherwise each touched codon is read: synonymous is `silent`, and the worst
of the others is named (`p.K42R`, `p.K42*`, `p.*42K`), several joined by a
comma. Where carriers differ the effect and change are listed per sample.
Not done: HGVS three-letter codes or nucleotide notation (c.), and
effects per sample at positions a sample does not cover.

The **List** toggle sits beside the counter and is remembered with the Show
buttons. The table is `AlignmentDifferencesList`, capped at a third of the
window and scrolling, each row's position a button (keyboard access) and the
row clickable; both go through the same path as Next (`pick` in the dialog),
which also selects a carrying sample, keeping the current one if it carries
the region. Copy writes `differencesTsv` through `copyText`. Not checked by
eye.

## Samples that disagree (#124)

`alignmentDisagreement.ts` finds the columns where samples differ from each
other, which a difference from the document cannot tell (a base-calling
error in one read shows as a difference from the document just as a real
change does). A row takes part in a column with a call: A, C, G or T (U read
as T), or `-` for a deletion; Blank and Padding cells (outside the sample's
stretch, or another sample's insertion) take none, a base below
`readConfidentQuality` takes none, and an ambiguity code takes none since it
is compatible with more than one base. A column disagrees when at least two
rows call and the calls are not all the same. That includes one sample
matching the document and another not, and a deletion against a base.
`agreementColumns` is the converse (two or more samples differ from the
document and all in the same way, none disagreeing); it is not drawn, only
noted in the list as "samples agree".

Drawn three ways: a solid foot under the overview's differences (2 px wide
at least), a small triangle under the ruler, and a faint ink tint down the
column in the body, all in the ink colour so they do not collide with the
class colours of the differences. The status row counts the columns. The
differences list gets a **Note** column (and in the TSV): "samples
disagree" when any column of the region disagrees, "samples agree" when two
or more carriers share the same bases and none disagrees. Not done: a
consensus row under the reference (it would add a row type to the stack,
the pinned header, the AA strip and the picking code for something the foot
and the list already say; left for a request); disagreement among samples
at columns the document has no base for beyond the plain insertion case;
nothing for a column only one sample covers. Not checked by eye.

## Go to and Find (#125)

`alignmentSearch.ts` answers both in columns. `columnOfPosition` is the
inverse of `columnPosition`: a 1-based position goes to a reference index
(less the stack's `offset`, modulo `wrap` on a circle) and from there to the
column, through the gap columns other samples opened. A circle's position that
a read through the origin reaches twice goes to the first copy. Failures are
named: invalid, past the end (the document's length on a circle, else the last
reference base), outside the stretch the alignment covers. When the document
is the read the numbering is the pasted reference's, the one the ruler shows.

`findMotif` reuses the editor's `findSequenceMatches` (IUPAC, both strands,
and `looksLikeSequence`, three bases at least as in the find bar) on one row's
bases with its gap and blank columns taken out, then maps a match back to
columns `[first, last + 1)`, so the highlight includes the gaps the match spans.
A sample is searched on its own bases. The reference is searched ungapped, on
its extended length when a read runs through a circle's origin (so a motif
across the origin is found then, once: the repeated start is deduplicated by
`index mod wrap`). Not done: a wraparound match in a circle's reference
that no read crosses, since its columns would be two separate runs and the
highlight is one span.

UI: **Go to** and **Find** are one small segmented group in the toolbar and
their form (`AlignmentFind`) a popover under it, so the toolbar gains no zone
and does not wrap. Find's target is the picked sample or, with none, the
reference: the select writes the pick, so there is one state. A new query
lands on the first match from the view's last position; stepping goes through
`stepMatch` (as `nextDifference` does, a match starting at the column is not
stepped to). Matches mark and scroll through the same `focus` as the
differences, with no difference stop. Ctrl+F is the editor's fixed Find key
and is taken in the window's capturing handler, as Alt+N and Alt+T are. The
editor has no Go to key, so Ctrl+G is local to the window and not in the
binding table (and not reported in the usage statistics). Esc closes the
popover before the window. Not checked by eye.

## Export and copy (#126)

Three ways out of the window, behind one **Export** button and its popover
(`AlignmentExport`, the same kind of popover as Go to and Find; the dialog's
`popover` state holds one of goto, find or export, so only one is open and Esc
closes it before the window).

**One drawing path.** The canvas drawing that lived in an effect of
`AlignmentStackView` is now `drawStack(ctx, drawing, view)` in
`components/alignmentStackDraw.ts`, together with the colours, the layout
(`stackLayout`: header, per-row tops) and the helpers it used. It takes a
`StackContext`: the shared `DrawingContext` plus `globalAlpha`, `rect()` and
`clip()`, which the canvas has and `SvgContext` now has too (alpha becomes
`fill-opacity` / `stroke-opacity`; `clip()` emits a `<clipPath>` and opens a
`<g>` that the matching `restore()` closes, and `toSvg()` closes any left
open). The window passes its scroll offset and size as the `view`; an export
passes a view scrolled to the range's first column and as wide as the range,
so it is the same code and the same pixels, whatever is switched on (features,
ORFs, amino acids, traces, disagreement tints). The export draws with nothing
picked or marked. `drawStack` now computes the last column from the width less
the names; before it drew the 21 columns hidden under the names and clipped
them, which would have put them in the SVG. The view hands the dialog a
`StackHandle` (`visibleColumns()`, `drawing()`) through a ref, so the dialog
owns the form and the view owns what it draws from.

**Pictures** (`alignmentExport.ts`). SVG is `drawStack` into an `SvgContext`,
PNG the same into a canvas at 2x (1x if 2x is too large), encoded by
`toBlob`; no SVG-to-image round trip, so fonts are the page's own. Both are
saved with the new `downloadBlob` (the download helper, now also under
`downloadText`; item 24). Each base is an SVG text element, so the SVG is
capped at 100,000 cells (columns times rows, the reference row counted; about
15 MB), a PNG at 400,000 cells and 16,000 px a side and 100 M pixels; the
refusal names the numbers and points at the text forms, which have no cap. The
export takes the current theme's colours, so a dark theme gives a dark picture;
not offered a light override.

**Text** (`alignmentText.ts`, pure). `alignmentText` writes blocks of N
columns (60, at least 10 in the form): the reference, a match line, then each
sample, each led by its name (cut at 24) and the 1-based number of the first
and last base in the block. The reference is numbered as the ruler is
(`columnPosition`, blank in an inserted column); a sample along its own
aligned bases from `startB + offsetB`, so a read's numbers start at 1 at its
first aligned base and ignore any trimmed or reverse-strand orientation of the
original. The match line has `|` where every row that has a character agrees
(gap with gap, case-insensitive) and at least two do. `alignedFasta` writes
the reference then each sample at full width, `-` for a gap and for columns
outside the stretch, wrapped at 60. Both take a column range; copying goes
through `copyText`. Not done: writing the file as a download (FASTA is a
paste away), positions on the sample in the reference's numbering, a PNG
with a light palette on a dark theme, and a consensus line. Checked by eye: an
`SvgContext` render of a three-row alignment rasterised with rsvg (names,
ruler, differences, deletion, disagreement mark all drawn as in the window);
the popover itself was not looked at in a browser.

## Sort and hide samples (#127)

**One place for the shown order.** `alignmentOrder.ts` (pure, tested) turns
each sample's name, identity and start on the reference into the indices to
show: `sortedIndices` (original, identity descending, name with a natural
collator, position; ties keep the aligned order, so the sort is stable and
total) and `shownSamples`, which drops the hidden set. The dialog never
reorders `samples`; it stacks `shownIndices.map(i => samples[i])`. Because
`stackAlignments` is run over the shown samples only, every consumer of
`stack.rows` (drawing, row picking, Up/Down, overview, differences and their
Next/Previous stops, the list, coverage, disagreement, Find, export) follows
without a mapping of its own. The picked sample is held as an index into
`samples` (`pickedSample`, which is also what Align all's `initialRow` is),
and `selected`, the row in the shown stack, is derived from it; `setSelected`
maps a row back, so Find's picker and the list's carriers, which speak in
rows, still work. Hiding the picked sample leaves nothing picked.

**Decision: hidden samples do not count.** A hidden sample is out of the
verdicts and coverage, not only the picture, since the point of hiding a bad
read is to see what the rest show. The cost is that the stack is rebuilt (the
alignment's columns are recomputed, so an insertion only a hidden sample made
is gone). The verdict lines carry a note, "Verification from 3 of 4
samples", whenever any are hidden. The last shown sample cannot be hidden.

**Controls.** A **Samples** button opens a popover (the same
kind as Go to, Find and Export; one at a time) with the sort select and the
hidden list with Show and Show all; **Hide** sits beside Select in document
and acts on the picked sample. (It first sat at the start of the status row, which read as clutter next to the score line; it is now the toolbar's group after Export.) State is per
opening, not remembered. Not checked by eye; covered by a component test
(sort orders, hide, show by name, show all, Up/Down following the order, the
last sample kept).

### Verdicts collapsed to a summary

On a real vector (27 features, five reads) the one line per feature was a
wall of identical "confirmed by 5 reads, forward strand only" that buried the
one feature with 8 differences. The verdict is now one sentence
(`summariseVerdicts`, `verdictSummaryText`) followed by only the features that
are not confirmed; the full per-feature list is behind an **All features**
disclosure, capped in height. The strand note moved into the sentence and
shows only when every confirmed feature is on one strand. Not checked by eye.

### All features as a table

The disclosure's list was the same wall in a smaller box: 27 flowing lines of
"X confirmed by 5 reads, forward strand only" with nothing aligned, so a
reader could neither scan a column nor find the odd one out. It is now
`AlignmentVerdictTable`, built on the differences list's table (#121) and its
classes: one feature per row, columns **Status** (a mark and a word, ✓ ✕ ~ ○,
so colour is not the only cue; differences and partly covered in bold red
and amber, confirmed in the muted ink), **Feature** (a button, as the
differences table's Position, so Tab and Enter reach it; the row is
clickable too and marked `aria-current` once picked), **Type**, **Position**,
**Reads**, **Strands** and **Bases covered**. Numbers are right-aligned in
tabular figures and the table is only as wide as its columns, so a name and
its numbers stay close on a wide window. **By position / Problems first**
orders it (`sortVerdicts`: differences, partly covered, not covered,
confirmed; document order within each), and **Copy** writes `verdictsTsv`.

Data. `verdictsOf` now returns document order (first base, then last, ties
keep the given order; `source.features.all()` is not positional) and each
verdict carries `position`/`endPosition`, the 1-based inclusive document
positions of the feature's first and last base as the ruler and the
differences list number them: the first segment's start + 1 and the last
segment's end, taken modulo the length on a circle, so a feature through
the origin reads `6801–120` (segments are in forward order as GenBank's
`join` lists them). `reads` is now the fewest over the bases for every
kind, 0 when some base has none, and `oneStrand` became `strands`
(`both`, `forward`, `reverse`, `mixed` when every base is read but neither
strand reads them all, null when not fully covered), so a feature with
differences shows its reads too. The summary sentence is unchanged.

Arrangement. The table sits where the differences list does, between the
verification line and the overview, capped at a third of the window and
scrolling inside itself. Decision: **one table at a time** — opening All
features closes List and List closes All features, since two capped tables
left the alignment a sliver. A popover was rejected: seven columns do not fit
the toolbar popovers' 36 rem, and a table that covers the alignment cannot be
used to walk it. The toggle stayed on the verification line (at its end), not
beside List: the toolbar's Features already means the track, and the table
belongs with the sentence that summarises it. Its open state and order are per
opening. The sentence and the exceptions stay, as the at-a-glance answer, but
the exceptions are now differences first and, past five, the first four plus
**and N more**, which opens the table with Problems first: pBR322 against
reads covering two thirds of it had 14 exceptions, the same wall again.

Checked by eye in Chrome (dark theme, 1489 px wide) on pBR322 (J01749, 48
features) with six reads made from its sequence: the line, the table in both
orders and "and 10 more". Not checked: a phone-width layout, the light
theme, and a real vector with AB1 reads like the one that prompted it.

### Feature table and Samples placement, after a trial

The feature table's box now wraps its columns (the header row stopped partway
across a wider box when only the table was shrunk), and the Samples button
moved from the status row into the toolbar after Export. Not checked by eye.

A pointerdown outside closes the open popover (Go to, Find, Export, Samples):
one document listener while one is open, ignoring anything inside
`.astack-tools__search`, which holds a popover's button and its form. The two
tables (List, All features) deliberately stay open until their own button, so
Next/Previous and clicks on the alignment can be used with a table showing.

### The toolbar's popovers redrawn

Go to, Find, Export and Samples looked unfinished: their inputs and selects
carried a class, `input`, that the stylesheet never defined, so they were the
browser's own controls (a light grey select in the dark theme, each a
different height); labels sat inline wherever the wrapping put them; Find's
‹ › were 20 px targets; Export's × was left alone on a last line under an
empty message line, and Export ran past the window's right edge at 640 px;
Samples had no close button at all and its "No samples hidden" in the body
size beside 12 px labels.

They now share one frame, `AlignmentPopover`: a heading (the text that was
already the group's accessible name, now its `aria-labelledby`) with × at
its end, a two-column form whose labels line up as the sidebar's
`.panel__form` does, then a status line (Find's count with ‹ › as a
segmented pair at its right; a line with nothing in it and no buttons takes
no room but stays in the page, so its live region still speaks). Every
control is 28 px high and drawn like `.panel__select`; Go is the primary
button; Find's motif is in the monospace face, shown upper case. Export's
On screen / All is a segmented pair beside the range, and its Picture and
Copy rows start under Columns. Samples gets a Close (the same
`setPopover(null)` as the others), a "Hidden: 2 of 5" heading with Show all
at its right, and the hidden names in a bordered list, cut with an ellipsis.
Each popover has a fixed width (21, 24, 30 and 22 rem, never past the window
less 32 px) and is moved left after layout by as much as it would pass the
window's right edge. Behaviour (one at a time, click outside, Esc) and every
control's accessible name are unchanged.

Checked by eye in a headless Chromium (Playwright) on pBR322 with five reads
made from it, two hidden: all four popovers in the dark theme at 1,400 px and
the light theme at 1,400 and 640 px (the narrowest the window is shown at;
below 600 px the phone layout has no large view).

The **All features** button left the end of the summary line (it was smaller
than the toolbar's buttons and read as stray) for the toolbar, joined to
**List** in one segmented "Tables" group: the two tables are mutually
exclusive and both are lists of rows to click. It is disabled when there are no
features. "and N more" still opens it.

## Filtered Next/Previous (#122)

`alignmentFilter.ts` (pure, tested) picks the difference regions the walk
stops at: `filterRegions` returns indices into `differenceRegions`, and the
dialog runs `nextDifference` over just those. A region passes when its
highest column class (`classifyColumns`, so a found ORF counts as a CDS, as
the shading has it) is at least the one asked for, and when one of the rows
considered has a differing cell in it that is, if asked, good by the same
`isGood` the verdict uses (now exported): a deletion and a read with no
qualities count as good. "Picked sample only" narrows the rows considered to
the picked one, so with both it is the picked sample's own base that must
be good, not any sample's. With no sample picked that switch does nothing
rather than stopping nowhere, and the popover says so; without a document
"Where" is disabled and treated as Anywhere, so a remembered "In a CDS"
cannot leave a pasted reference with no stops.

Decisions. The filter narrows the **stops and the counter only**: the
overview, the body and the List keep every difference, since the List is
also the record that gets copied into a notebook and a filtered copy would
silently drop rows. The stop stays a region index, so a row picked in the
List that the filter leaves out is still marked; the counter then shows the
count ("12 of 41 differences") instead of a position. The control is a
**Filter** popover in the toolbar's family (one at a time, click outside,
Esc) rather than switches in the toolbar, which would wrap it again (#119);
the button reads **Filter (on)** while it removes anything. The filter is
remembered between openings with the Show buttons.

## Reviewed differences and taking a sample's bases (#123)

`alignmentReview.ts` (pure apart from a per-result store, tested). **What is
marked.** A mark belongs to a difference region (one Next stop, one List
row), not to one sample's cell: "this difference is a known poor call" is
said of the stop. It is keyed by `regionKey`, the region's first and last
column anchored on the reference (`p`, or `p+k` for the k-th inserted column
after reference index p), because hiding a sample rebuilds the stack (#127)
and renumbers both columns and regions; an index or a column would point
at another difference afterwards. A region that hiding splits or merges
loses its mark while it is hidden and finds it again when shown. Two marks:
`reviewed` (toggled from the status row or the List's box) and `taken`.

**What a mark does.** Faded to 35 % in the body and the overview
(`REVIEWED_DIM`; an export draws without marks, as it draws nothing
picked); skipped by Next/Previous through the filter's **Skip reviewed**,
on by default, which is the issue's "optionally"; noted in the List's Note
and its TSV; and in the verdict `verdictsOf` takes the marked columns and
counts them in `reviewed` rather than `differences`, so a feature whose
only difference is reviewed is Confirmed, "(1 reviewed)". The verdict TSV
carries that in its Status column rather than a new column.

**How long it lasts.** For the life of the alignment result, as the issue
asks: a module `WeakMap` keyed by the result's `ReferenceInput` (each Align
run makes a new one, a batch shares one), so closing and reopening the
window keeps the marks and aligning again drops them with the old result.
Decision: **not persisted with the document.** A mark is about one set of
reads against one state of the document, which the document model has no
place for, and a GenBank file would have to carry it; it would also go
stale with the first edit. If wanted later it belongs with a saved
alignment, not the sequence.

**Take sample's bases.** `takeEdit` turns the picked sample's bases over
the region into one document range: the reference columns of the region
(through `refIndex` plus the stack's `offset`, wrapped on a circle) are
replaced by the sample's bases with gaps dropped, so a deletion removes,
an insertion-only region inserts before the next reference base, and a
mixed region (insertion plus mismatch) is one replace. It is applied with
`editorStore.apply` as an ordinary `insert`/`delete`/`replace`, so it is one
undo step, gets the edit marks, moves features, and forks a file into a
working copy like any first edit; the written bases are selected. Refused
with the reason on the button: the sample does not reach every column
(Blank), it carries no difference there, the region runs through a circle's
origin (an edit op is one range), the document is the read, or the
document is not the one expected.

Decisions. The alignment is **not redone** after a take: the window keeps
showing what was aligned, now with that difference marked taken, and Align
again shows the edited document. To take several in a row the window keeps
the edits made (`DocumentEdit`, in the coordinates of the document at the
time) and maps each next region through them (`mapThroughEdits`; an overlap
with one already taken is refused). It must then know the document it is
writing into is the one it last made: the first document is held when the
window opens and `documentHoldsReference` confirms it still has the
reference's bases at the offset (otherwise taking is off: the document was
edited between Align and opening the window), and after each take the
resulting document is kept; any other change, an undo included, makes the
open document a different object and taking stops until the next Align.
The held document is also what the window draws features and classes from,
so after an indel taken here, reopening the window does not draw the
edited document's shifted features against the old columns. The bases are
written in the document's case (lower case beside lower-case bases), so a
SnapGene file in lower case does not get a stray capital. Not done: the
ORFs the app found belong to the open document, so after a take they no
longer match the held one and the ORFs button and their CDS shading are off
until the next Align.

Checked by eye: an `SvgContext` render of a two-row stack with a reviewed
deletion and mismatch beside an unreviewed one, rasterised with rsvg (the
reviewed ones clearly fainter, the kind bars too). The status-row buttons
and the List's box were not looked at in a browser.

## A sample's own features on its row (#128)

**What carries them.** A `SequenceRecord` in the Align panel keeps the
features of the document it came from (a GenBank or SnapGene record in the
box, a file, an open tab); a raw paste or FASTA has none. They reach the
window as `StackSample.features` (`SampleFeatures`: the features and
whether the sample is circular): the single result keeps them on
`ShownAlignment.sampleFeatures`, a batch keeps one per record index beside
its rows, and when the document is the read its own features are the
sample's. `ReadAlignment` is unchanged; features are not the worker's
business.

**Mapping.** `alignmentSampleTrack.ts` (pure, tested). `sampleColumns`
lists the column of each of the row's bases in the read's numbering as
shown (`startB + offsetB`, counting the row's non-gap characters), which
needs no trace, unlike `readIndex`. A feature range in the sample's own
coordinates is mirrored (`L - end, L - start`) when the sample aligned
reversed, and its strand flipped, since the row shows the reverse
complement. A circular sample tries the range shifted by `±L`, as
`spansOf` does for the reference, so a feature written over its origin is
found at both ends of the stretch. Each range is clipped to the aligned
bases and becomes the columns of its first and last base, so the sample's
own insertions inside it are covered; one with no aligned base is dropped
before packing and takes no lane. Lane packing is the reference track's,
split out of `buildTrack` as `packTrack`; features only (no ORFs are found
in a sample), `source` left out, at most `MAX_SAMPLE_LANES` (3) per row.

**Drawing.** Under the row and its residue strip, above the trace: the
lanes add `sampleTrackHeight` to the row in `stackLayout`, so `tops`,
picking and the export follow without change. `drawTrack` takes the top of
its first lane, so the same bars, arrows and labels serve both tracks; the
name column says "Own features" beside the lanes. Hovering a bar names it
("Sample feature: …"). Decision: **the Features button switches both**,
the reference's track and every sample's own, rather than a fourth Show
button; it now also appears when only the samples have features (the
document is the read). Hidden counts: the status line names how many of
the picked sample's own did not fit, rather than a sum over 96 rows.

Not done: a sample's features take no part in the verdicts, classes or
difference colours, which stay the reference's; a sample's ORFs are not
found. Checked by eye: an `SvgContext` export of a three-row stack (a
sample whose CDS sits five bases off the document's, a reversed sample, a
sample without features), rasterised with rsvg; the canvas in a browser was
not looked at.
