# 55. Thinner introns, and a thickness per feature

Done, 2026-09-25 (#88; `src/view/featureShape.ts`, `FeatureEditor.tsx`).
Colleague feedback: _make intron type thinner, maybe have setting on features
to adjust thickness?_ An intron drawn as solid as the exons around it hides
the gene's structure: exon, intron, exon read as one long bar.

## Thin, medium, full

A feature is drawn at one of three thicknesses, a share of its lane:
`thin` (30%), `medium` (60%) and `full`. A thinner bar sits in the middle of
the lane. The lane itself keeps its height, so the layout, the lanes a row
needs, the map's labels and clicking a feature are as they were. There is no
"thick", since a bar thicker than its lane would run into the next one.

- By default an intron is thin and everything else is full
  (`DEFAULT_BY_TYPE`, one line to extend).
- In the sequence view only a full bar carries its name inside it, because
  a thinner one has no height for text. The map's labels sit outside the
  arcs and are unaffected.
- A site (a point between two bases) stays a full-height mark, since it is
  not a bar.
- Arrows scale with the bar, so a thin intron ends in a small point.

## Kept as a qualifier

A chosen thickness is a `/PlasmidPop_thickness="thin"` qualifier on the
feature. ApE's colour qualifiers are read the same way. So it goes wherever
the feature goes with no plumbing: GenBank, the store and the stored
history, share links, the clipboard, extracts and products made on the
Bench. Other programs keep it as a qualifier they do not know. The feature
editor sets it with a **Thickness** control, _As its type_ removing it, and
leaves it out of the qualifier rows so it is not edited twice. A value this
build does not know is ignored, and the type's default applies.

A per-type default in Format (every CDS thin, say) was considered and left
out, since only introns were asked for.
