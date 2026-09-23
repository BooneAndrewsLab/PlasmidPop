# 4. Translation of any selected range in six frames

Done. The
Translate sidebar tab shows the selection (or the whole sequence when
nothing is selected) in frames +1..+3 and −1..−3
(`translateSixFrames` in `src/core/analysis/sixFrame.ts`; −1 starts at
the 3′ end of the selection), with stop codons marked, per-frame Copy
and an Export FASTA button that writes one protein record per frame
(`src/app/sixFrameExport.ts`). A **Code** select (2026-09-21) picks any of
the 27 genetic codes of item 1; it is `SharedState.geneticCode`, kept with
the view preferences and shared with the ORFs tab
(`GeneticCodeSelect.tsx`), because a six-frame translation and an ORF scan
have no feature to ask which code they are reading — unlike a CDS, which
is always read with its own `/transl_table`. The scan follows it too:
which codons stop a reading is what an ORF is made of, so changing the
code drops every open document's analysis, **Add as CDS feature** writes
`/transl_table` when it is not the standard code, and the six-frame FASTA
names it in the description lines. Clicking a residue to select its codon
is item 19. Not yet: nothing outstanding here.
