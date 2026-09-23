# 16. Make tiny features visible on the circular map

Done. A
selection whose arc would be under 7 px on screen (the 2 bp feature at
141..142 of pBR322, say) is widened about its centre to that much
(`selectionSweep` in `src/view/circular/renderCircular.ts`) and drawn
again over the features as a needle from just outside the backbone in
to the inner edge of the lanes. Not yet: the same treatment for the
caret, or for a tiny feature that is not selected.
