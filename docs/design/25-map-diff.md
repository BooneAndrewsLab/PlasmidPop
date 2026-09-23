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
- Not yet: a **removed** feature is named in the review's Features list
  but is not drawn on the ring — where a deletion took it the wedge is
  already there, and a ghost arc for one deleted by hand has nowhere to go
  that the preview ring and the lanes have not taken. Nothing on the ring
  is clickable, so a mark cannot be jumped to (item 33 wants the same
  thing for stepping between differences). The review's map is the front
  document's own ring, not two rings tied across, so a circular plasmid
  written from another origin still reads as changed throughout — that is
  item 22's `cdseguid` checksum, not a rendering question.
