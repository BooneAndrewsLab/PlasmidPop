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

**Not yet:** the AB1 trace and the poor-base marks (#110); a phone-specific layout
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
marks on poor read bases with them, and the large view has neither; #110
tracks bringing both back there. Batch rows and phone layout are unchanged
(the row list and the result above still stack in the panel). Not checked
by eye.

## Pointing at a result finds its region (#108)

The panel's **Select aligned region in this document** button is gone (the
large view keeps its own). The result's heading is a button instead, and so
is each batch row's read name. Hovering or focusing it draws the aligned
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
