# 16. Make tiny features visible on the circular map

Done. A
selection whose arc would be under 7 px on screen (the 2 bp feature at
141..142 of pBR322, say) is widened about its centre to that much
(`selectionSweep` in `src/view/circular/renderCircular.ts`) and drawn
again over the features as a needle from just outside the backbone in
to the inner edge of the lanes.

**The caret and unselected features** (#26, 2026-09-24). The caret, a
zero-length selection, is now that same needle: it was a 16 px tick on the
backbone, which a feature arc covered. A range segment under
`MIN_FEATURE_PX` (3 px) of arc is drawn widened about its middle by the
same `selectionSweep` — three rather than seven, since an unselected mark
should not look like something longer — and the map view's `featureAt`
takes the same width of the pointer, looking a few bases either side when
nothing is under it exactly, so a mark that can be seen can be hovered and
clicked. Both are drawn and tested through a recording `DrawingContext`.
