# 10. Linear molecule end handling

Done. A `SeqDocument` carries the
shape of its two ends (`src/core/document/ends.ts`: kind, overhang bases
in the same top-strand convention as a digest fragment, and the enzyme),
null for a circular molecule or a plainly blunt linear one. `digest`
gives the outer fragments the molecule's own ends, a linear `ligate`
product keeps the outermost ends of the assembly, and
`documentFromFragment` (**Open** in the Cloning tab) opens a fragment as
a document. An edit that reaches a tip blunts that end, reverse
complement swaps them, making the molecule circular drops them. The
sequence view washes over single-stranded bases, leaves a gap opposite
them and draws a bottom-strand overhang in the gutter beyond the first
or last column (the gutters grow to fit); the toolbar names both ends.
They survive a save: GenBank has no field for them, so they ride in a
`PlasmidPop-ends:` comment that the parser turns back into ends
(`src/io/genbank/endsComment.ts`). Not yet: filling in or chewing back an
overhang (Klenow / T4 blunting), ends on the circular map, and any
carriage through FASTA or SnapGene.
