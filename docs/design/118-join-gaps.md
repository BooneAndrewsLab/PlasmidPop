# 118. Marking the gap between the pieces of a join

Issue #319, follow-up to the split codons of #318 (item 1, _Split and
unfinished codons_), from option C of that issue's mockups. A feature in
several pieces (`join(249..435,1223..1368)`) was drawn as bars with nothing
between them, so a reader had to work out from the ruler why a codon was
split and how far away the next exon was. Now the sequence view marks each
end of each gap and names the gap. Display only: the document, the GenBank
round trip and the feature editor are untouched.

## What was built

- **The geometry is pure:** `joinGaps` (`src/view/linear/joinGaps.ts`) lists
  the stretch between each pair of consecutive range segments as 0-based
  boundaries on the forward strand (`end` after the earlier piece's last
  base, `start` before the later piece's first, `length` in bases), whatever
  the feature's strand: a reverse-strand feature reads its pieces in the
  other order, but the bases between two consecutive pieces are the same
  bases, so the marks and the chip sit in the same place. The chip and the
  tooltip show 1-based inclusive positions, as everything the user sees.
- **Marks.** A 1 px vertical line in the cut-site colour, dashed `3 3` so it
  cannot be taken for an enzyme's cut, at each end of each gap: after the
  earlier piece's last base and before the later piece's first, from the top
  of the strands down through the feature's own lane, so it passes through
  the bases and the translation line and ends at the bar it explains. It is
  drawn after the row's bars, as the cut-site marks are drawn after the
  strands, so no bar covers it. A boundary lands in the row that holds its
  base, so a join cut at a row break shows its two marks at the end of one
  row and the start of the next, as the split-codon edges do.
- **Chip.** In a gap with bases, a pill in the feature's lane (`intron
45-130 · 86 bp`, muted ink on the background, in the sans font) right after
  the mark where the gap begins, in the first row along the gap with room
  for it: enough width before the next mark or the row's edge, the feature's
  lane present in that row (a row keeps only the lanes its own bars need,
  so a row deep inside a long intron may lack it), and no bar of another
  feature packed into the same lane there (an intron feature often is, as
  lanes pack by the pieces a feature really covers). Placement is settled
  once per render (`ChipPlaces`), since every row of a long gap would
  otherwise walk the same rows. A gap too short for its chip keeps its
  marks and its tooltip; nothing is squeezed or overlapped.
- **The word.** `intron` for the types whose pieces are exons (CDS, mRNA,
  the RNA keys, UTRs, gene), `gap` for anything else: a `misc_feature` in
  two pieces has no intron.
- **Tooltip.** The pointer over the empty lane between two pieces (or a tap,
  which uses the split-codon mechanism of #318, `TAP_TIP_MS` and all) shows
  `gapNote`: `INS: intron 436-1222, 787 bp. The exons are joined; the
feature continues at 1223.` "Continues at" follows the strand: the first
  base of the later piece on the forward strand, the last base of the
  earlier piece on the reverse one. Pieces that touch or overlap say so
  instead. The tooltip takes the lane hit only where no bar is under the
  pointer (`featureAtHit` is empty), so a bar's own group tip still wins.
- **Exports.** `exportLinearSvg` draws through `renderLinearView`, so the
  SVG and PNG figures carry the marks and the chips as the screen does; the
  look was checked by rasterising `SvgContext` renders in both themes
  (hidden Chrome tabs never repaint).

## Decisions

- **The gap's bases stay drawn.** The mockup's alternatives A and B folded
  an intron into one row (`⋮ 787 bp intron, 7 rows hidden`). Not done: the
  intron is sequence, often annotated by other features (the gene bar, an
  intron feature, primers, cut sites), it can be edited and selected, the
  ruler counts through it, and folding would change the row layout, the hit
  testing and the scroll-to-position of every row below it, for one
  feature's benefit while another feature in the same rows wants them
  drawn. The chip says how much there is to skip; scrolling is cheap.
- **`order(...)` gets nothing.** Its pieces are listed together but nothing
  reads across them (a binding site's residues), so there is no cut to
  explain and no "between". The marks would say the pieces are joined,
  which is the one thing `order` says they are not.
- **Touching pieces (a gap of no bases) share one mark and get no chip.**
  The cut is real (a codon can be split there, a ribosomal slip is
  annotated this way), so the mark stays; a chip reading `0 bp` would have
  to sit on the next piece's bar. Overlapping pieces (a −1 frameshift,
  `join(100..500,499..900)`) get both marks, inside the bars, and no chip;
  the tooltip says by how much they overlap. On a circle a later piece that
  starts inside the earlier one is an overlap, one that starts before it is
  past the origin and the gap wraps, folded in the chip the way the app
  writes a wrapped range (`991-10`).
- **No toggle.** The marks belong to the feature's drawing, like the
  split-codon edges and the arrowheads, not to an analysis the user turns
  on, as cut sites are. A thin line and a pill in an otherwise empty lane
  add nothing a toggle would need to take away.
- **Many pieces.** Forty exons give eighty thin dashed lines, as forty
  enzymes give forty cut marks; the chip is drawn only where it fits, so
  nothing overlaps at a narrow row width. Two features in one lane whose
  gaps nest (rare: both joins, neither's pieces inside the other's) could
  put two chips over each other; not guarded against.
