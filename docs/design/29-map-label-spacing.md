# 29. Map labels are written over by the ruler, and drift across the map as they are spaced

Fixed 2026-09-21. Reported 2026-09-21 ("the map labels
are kind of overlap on top of each other … unless I zoom in a lot") with a
screenshot of a 13,799 bp lentiviral construct, about 40 named features, no
enzymes ticked. Four faults, all of them in how the ring was laid out
rather than in how many labels there were, and one measured rather than
seen: 610 cut-over-feature pairs, 862 feature-over-feature and 85
cut-over-cut across 48 renders of pBR322 (`cceb5df`).

- **The ruler's numbers are in the spacing pass now.** `drawRuler` wrote
  each tick number at `radius + 12` knowing nothing about the labels, and
  `drawLabels` placed its ring at `radius + 34` knowing nothing about the
  ticks, so `1,000` went through `CAP binding site`. `rulerTicks` works out
  where the numbers go before anything is placed and hands them to
  `layoutLabels` as `obstacles`: placed first, never moved, never dropped.
- **A crowded label slides along the ring, not down the canvas.** The old
  pass pushed a label down and kept its `x` at the anchor's, which near 1
  o'clock carried it _inside_ the circle and over the feature arrows. The
  offsets tried are now angular, so where the ring runs steeply (3 and 9
  o'clock) the label stacks vertically exactly as before, and where it runs
  flat (12 and 6) the labels spread sideways instead. A label may not slide
  past 12 or 6 o'clock: the text runs outwards from the ring, so one that
  crossed a pole would be written back across the map — found by rendering,
  not by reasoning, and the reason `PlacedLabel` carries its `box`.
- **The drawn box is what is tested against the canvas**, not the anchor.
  `nearCanvas` admitted an anchor within `textWidth + 56` of the edge,
  which says nothing about where the text ends up, so long names on the
  left ran off it. A label is now a candidate when its _anchor_ is on the
  canvas (the thing it names is on screen); its text is ellipsized to the
  room left on that side, and its box has to fit the canvas at whatever
  slot it takes.
- **When the ring is full the map leaves labels out and says so.** The two
  clamps that squeezed a stack back inside the canvas height could only
  compress, so past a certain density labels landed on each other with
  nothing said — that, not the kind of label, is where the 610 pairs came
  from. `layoutLabels` now places in **rank** order and drops what finds no
  slot: `{ placed, dropped }`. Rank is a property of the document, never of
  the canvas, so panning does not reshuffle which labels survive — whatever
  the pointer is on first, then features longest first, then cut sites
  rarest first (a unique cutter is what a cloner is looking for). A
  `+7 labels not shown` line sits in the bottom-left corner.
- **Hovering brings a left-out label back**, which is what makes the
  dropping affordable. The hovered label is drawn last and in a rounded
  outline (`drawBubble`) — it is the one label that may lie over its
  neighbours, and a bare rectangle of background over them reads as a hole
  punched in the map — and `EDGE_INSET` keeps every label a few pixels
  clear of the canvas so that outline is never clipped. Its leader waits
  for the end with it: drawn in `placed` order it was painted over by
  every muted leader crossing it, so the highlight showed only on the
  stretch where nothing else ran. One the ring had
  no room for is drawn on top of whatever is there, with a leader of its
  own back to the feature (`drawFloatingLabel`). Cut sites had no hit
  region at all — `hitTest` knows `backbone` and `lane` — so `cutAt` in
  `CircularMapView` finds the tick under the pointer within 6 px and
  passes `hoveredCut`; it is hover only, and a press near the backbone
  still starts a selection.
- **Hovering does not change the layout**, which took two goes to get
  right (reported 2026-09-21 with four screenshots of pBR322's bla). The
  hovered label was ranked first so that it could never be dropped, which
  let it take the slot nearest its anchor and pushed its neighbours
  around: `beta-lactamase` and `bla` swapped places as the pointer moved
  between the two arcs. Rank is the document's alone now, and a hovered
  label that did not fit comes back through the floating path instead,
  which costs the layout nothing. The second half of the same report:
  `featuresToLabel` collapses same-named features into one label, so the
  feature under the pointer often has _no_ label of its own — pBR322's
  `mat_peptide` beta-lactamase sits inside the CDS of that name — and
  nothing was highlighted while a second copy of the name was floated over
  the first. `hoveredLabelId` resolves the pointer to the nearest label of
  the same name, so the label that is already there lights up, leader and
  all.
- **Leaders are drawn before every piece of text, and text sits on a plate
  of the background.** A label a neighbour's leader ran through was as hard
  to read as one a neighbour's name ran through, and no spacing rule can
  help with a line. An export asked for a transparent background paints no
  plate, which is the right answer for one.
- **The map's own geometry is measured in text now** (`mapMetrics`): the
  tick, number, elbow and label radii and the line height all come from the
  sans font's size, and come out at the offsets the map has always used
  (7, 12, 26, 34) at 12 px. The export scales its fonts with `size` and had
  a fixed 14 px line height, so a 2,000 px export would have overlapped
  every label; nothing exposes `size` yet, so it was latent.
- **The SVG export buys room instead of dropping** (`PAD_STEPS`): it
  re-renders with a larger canvas and the same circle — `outerMargin` grows
  with the canvas, so the radius does not move — and keeps the first size
  that loses nothing. A figure has no hover, so a name left out of one is
  lost for good. A 900 px export of the reported construct fits at once; a
  deliberately small 400 px export of pBR322 with every feature named grew
  to 496 px.
- **`SvgContext.measureText` uses Helvetica's advance widths** rather than a
  flat 0.55 em. The estimate is what decides what fits, and "MCS" is 2.2 em
  of Helvetica against 1.65 em of the average — the difference between two
  labels clearing each other in an export and running together. The
  monospace path (the sequence-view export's Courier metric) is untouched.
- **Measured by rendering, not by asserting on the layout**
  (`src/view/circular/labelCollisions.test.ts`, the harness the earlier
  count was taken with, now committed): pBR322 with every feature named and
  a 13.8 kb construct shaped like the reported one, at four canvas sizes,
  four zooms and 0/10/20/35 cut sites, comparing every drawn text box with
  every other. **0 collisions** in all 128 renders, against the 1,557 pairs
  before. `LABEL_REPORT=1` prints the table. Cost is in
  `docs/perf-notes.md`: 1.3 ms for 50 features, 6.5 ms for the absurd case
  of every cut site of all 127 bundled enzymes.
- Three things asked for alongside it: a left click on empty map space
  clears the selection (a press that turns into a pan does not —
  `CLICK_SLOP`); selecting a feature scrolls its row into view when the
  Features tab is open; and a selection now remembers the feature it came
  from (`selectedFeatureId`, cleared by any plain `setSelection`), so
  clicking pBR322's CDS selects that one row rather than both it and the
  gene of the same extent. The Features tab still lights up every feature
  matching a range the user selected by hand, because a range says nothing
  about which feature was meant. The highlighted leader on the map starts
  at the _hovered_ feature's lane, not the labelled one's, so hovering a
  `mat_peptide` inside a CDS draws a line that reaches the arc under the
  pointer.
- Not yet: **a second label ring**, which is what SnapGene does with a
  crowded map and the only thing that would raise how much fits rather than
  how well it is spaced — the drop counts are the evidence for whether it
  is worth it, and they are now visible (`+N`): a roomy canvas loses
  nothing on a real record, the Both view's 420 × 560 pane loses 19 of 42
  on the reported construct. Note that at the sides a second ring is really
  a second _column_ and needs the widest text in the first one (~140 px)
  before it helps, which `OUTER_MARGIN` (110) cannot fund without shrinking
  the circle. Also not yet: the leader lines still fan out in a near-parallel
  tangle where a dozen labels bunch, nothing in the ring is clickable, and
  the label ring is sized for the sans font but `OUTER_MARGIN` is still a
  constant.
