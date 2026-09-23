# 19. Selecting amino acids in the sequence view

Done. Clicking an
amino acid on a translation line selects its codon and dragging along
the line extends the selection codon by codon in reading order, so a
reverse-strand CDS selects right to left and a codon that crosses a
`join(...)` boundary or the origin comes out whole (`codonIndexAt`,
`codonSpan` in `src/core/analysis/cdsTranslation.ts`, which now
records the feature's `strand`; the drag itself is in
`LinearSequenceView`). Clicking the feature bar still selects the
whole feature, and so does a click on a part of a translation line
with no codon under it — an intron, or the bases `/codon_start`
skips. The canvas cursor now follows what is under the pointer
(`cursor` state in `LinearSequenceView`): a hand over a feature bar or
a residue, the text caret over the bases, the arrow over empty lane
space. `Ctrl+Shift+←`/`→` do it from the keyboard
(item 32): the first press takes the codon the caret is in, as
`Shift+Arrow` takes the base it is on, and each press after that adds one
— along the row rather than along the protein, so a reverse-strand CDS
extends leftwards, as dragging already did.
