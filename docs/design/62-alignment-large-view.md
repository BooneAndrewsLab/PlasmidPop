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

**Not yet:** the AB1 trace is only in the panel; a phone-specific layout
beyond the full-window dialog; #102 feature track and #104 difference
colours by feature class build on the stack (`Stack.refIndex` maps a
column to a reference position).
