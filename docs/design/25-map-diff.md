# 25. A diff on the map, not only in the sequence

Done, 2026-09-22. The
tracked-changes marks of item 21 lived only in the sequence view and its SVG
exports; a plasmid is read as a ring, and the circular map said nothing.
Asked for by items 22 and 33 — the review before a download and **Compare
with…** both answered "is this the same construct" with a column of
sequence hunks, which says _where_ last.

- **One map with marks, not two side by side**, which is the open question
  the note left. The diff is already in the newer document's coordinates
  (`featuresRemoved` carries its own mapped locations, item 27), so there
  is one molecule to draw and no second circle whose different length
  would need a geometry of its own. `CircularRenderParams.edits` is the
  same `DocumentDiff` the sequence view takes, from the same
  `useEditDiff()`, so the Edits menu's baseline drives both views and they
  cannot disagree.
- **The marks are the backbone.** A stretch of new or replaced bases _is_ a
  stretch of the molecule, so it is drawn as an arc over the ring itself
  rather than in a band of its own — which is also the only radius left:
  the feature lanes are inside it, item 26's preview ring just under it,
  and the ruler's ticks and numbers just outside, where item 29 placed
  them first and immovably. Green for inserted, amber for replaced, the
  sequence view's own colours. A mark too short to see is widened about
  its centre to 7 px of arc, item 16's rule for a short selection: a
  single inserted base of pBR322 is 0.4 px and would otherwise be nothing
  at all.
- **A deletion has no width on the ring** — the bases it took are not on
  the molecule any more — so there is nothing to sweep, only a place to
  point at: a line across the ring at the join and a wedge just inside it
  pointing out, as the sequence view puts one over the strands. Inside
  because outside is the ruler's.
- **Features added or edited are outlined** in the colour of the change,
  as they are in the sequence view (`editOutline`, the same shape as the
  hover outline and outranking it — the pointer already says which feature
  it is on, the colour says something nothing else does). Since
  2026-09-22 the line says which kind of change it was as well: solid
  where the feature covers different bases, broken where it covers the
  same ones under another label (item 35).
- **The geometry is measured in text**, like everything else outside the
  backbone since item 29: the arc's thickness and the wedge are
  `mapMetrics` derived from the sans font, so a large export does not draw
  them as hairlines. That was a latent bug the first cut had, caught by
  asking the question item 29 had already answered for the label ring, and
  it is a test rather than a note.
- **`DiffMap` puts the ring at the top of both review dialogs**
  (`DiffReview`, shared by the download review and **Compare with…**), the
  whole molecule at a fixed 380 px with no selection, cut sites or
  preview. It is `renderCircularMap` at another size, as `DiffStrip` is
  `renderLinearView` at another size, so neither review can drift from
  what the editor draws. `readCircularTheme` was lifted out of
  `CircularMapView` for it, beside the `readLinearTheme` that `DiffStrip`
  already shared.
- **Export map as SVG carries the marks** too, as the sequence-view export
  has since item 21.
- Measured (`docs/perf-notes.md`): 0.6 ms with no diff, 0.7 ms with ten
  marks and ten deletions, 2.4 ms with two hundred of each — there is
  nothing to lay out, and the diff itself was already computed for the
  sequence view.
- **Removed features are ghosts, and the ring is clickable** (#27,
  2026-09-24).
  - **A ghost is a broken outline in the delete colour, in the lanes**, the
    shape the feature had at the location `featuresRemoved` maps it to. The
    lanes because that is where a reader looks for a feature and where its
    absence reads as one; the thin ring the first cut wanted has no radius
    left (the preview ring, the backbone's marks and the ruler have them).
    It never takes a live feature's lane: `lanesWithGhosts` stacks the
    ghosts after the live features (`packAfter`), each in the first lane
    with room where it was — usually the gap the feature left — and in a
    lane of its own further in only when none has. So a live feature never
    moves when the marks are turned on, but the map can grow a lane: on the
    bundled pBR322 with two CDSs removed and a stretch deleted by hand it
    does not (4 → 4); fifty ghosts scattered at random take it 4 → 7. No
    fill and no arrow, so a ghost cannot be read as a feature that is there.
  - **A feature a deletion took whole gets no ghost.** It maps to at most a
    base beside the wedge (item 27's rule, now `deletionThatTook` in
    `src/core/diff/removed.ts`, shared with the review's grouping): a
    3 px stub under the wedge says nothing the wedge does not, and the seven
    features a long deletion takes would stack seven lanes deep for it. The
    wedge speaks for them instead — hovered, it says `300 bp deleted, with
2 features`, and the review's grouped line names them.
  - **No label in the ring.** Even at the lowest rank a ghost's label is not
    free: `spreadTargets` spreads a crowd with every member in it, so a ghost
    label beside `bla` would move `bla`'s, and toggling the marks would
    reshuffle the live labels — the fault item 29 fixed for hover. The name
    comes up on hover instead, through the floating label a dropped name
    already uses (`lost removed`), and the review lists it. The SVG export
    has no hover, so its ghosts are unnamed; the review is where the names
    are.
  - **Clicking a change selects it as Next change would** (`changeSelection`
    in `editsView.ts`): a mark's stop, whole across a circle's origin; a
    deletion's caret; a ghost's mapped extent, as a click on a feature
    selects its extent. `changeAt` hit-tests from the same geometry the
    drawing uses — the radii, the widening of what is too short to see, 3 px
    of slack — rather than from the last frame, as the label boxes are, so it
    answers in a test with no canvas. The wedge is asked first (the smallest
    target, and it sits at a mark's end), then ghosts, then bands. It is the
    lowest thing to answer a click: a label, a live feature and a clickable
    preview span come first. The bands lie on the backbone, where a press
    starts a drag selection, so a press on one still does; only a release
    that did not move selects the change. Hovering one shows the hand and a
    floating label saying what it is (`40 bp inserted`, `8 bp changed`),
    below a feature, a label or a cut site. Measured with 200 marks, 200
    deletions and 50 ghosts, a pointer test is 20 µs.
  - **The sequence view's marks are not click targets.** A marked base there
    is a base the user may want the caret in, and a click that selected the
    whole mark would take that away; Next change covers the stepping.
  - **In a review a click points into the list** rather than at the
    document (`reviewKeyFor`, `src/app/reviewLines.ts`): a mark or wedge
    scrolls to the drawn neighbourhood holding it — a hunk carries the very
    mark objects of its diff, so this is an identity search — or to the
    "more places" line past the dozen drawn; a ghost to its Features line,
    or the line counting removals not listed. The line is lit for 1.6 s.
    The other way, a removed feature's name in the list is a button that
    points at its ghost, drawn as a hovered one is. Usage events
    `edits`/`map-click`, `review-click` (by kind) and `review-point`.
  - Measured (`docs/perf-notes.md`): ghosts cost nothing a frame can see —
    0.65 ms for pBR322 with ten ghosts, as with none — and the lanes are
    packed in under 0.1 ms.
- Not yet: the review's map is the front document's own ring, not two rings
  tied across, so a circular plasmid written from another origin still reads
  as changed throughout — that is item 22's `cdseguid` checksum, not a
  rendering question.
