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
Not yet: the other sequence's own features on its row.

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

**Controls.** A **Samples** button in the status row opens a popover (the same
kind as Go to, Find and Export; one at a time) with the sort select and the
hidden list with Show and Show all; **Hide** sits beside Select in document
and acts on the picked sample. The toolbar did not gain a group. State is per
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
