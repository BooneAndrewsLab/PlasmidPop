# 127. Select and copy in the alignment's large view (#366)

**Asked:** pick a run of nucleotides or amino acids in the Canvas-drawn
alignment and copy it. Native text selection does not exist on a canvas.

**Built:** our own selection, `src/app/alignmentSelection.ts`: one row (the
document's or a sample's) and one strip (bases or amino acids), an anchor
column and a head column, inclusive of both. Drag, or Shift-click to move the
head, sets it; `selectionTargetAt` (in `alignmentStackDraw.ts`, beside
`rowAtOffset`) says which row and strip a pointer is on. `drawStack` paints
it as a tinted, outlined block; an export does not carry it.

**Decisions** (the issue's defaults):

- Ctrl+C copies the sample's own residues, gaps and uncovered columns left
  out; Ctrl+Alt+C copies the row as drawn, gaps kept and uncovered columns
  as `-`, the form of aligned FASTA. Text is as the row is shown, so a read
  that aligned reversed copies reverse-complemented.
- Any single row, the document's included. A selection never spans rows, so
  the result is one sequence rather than a block needing a layout.
- An amino-acid strip copies the translated residues of each codon the
  columns touch (any column of it, not all three), in reading order, one
  line per CDS. A sample's residue is `residueOf`'s, the same the strip draws,
  so a partly covered or indel codon is `-`.
- The selection is dropped when the stack changes (hide, show), since columns
  move.

Not covered by tests: the pointer handling in `AlignmentStackView` (a real
browser was not driven); the pure pieces are.
