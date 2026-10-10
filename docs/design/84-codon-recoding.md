# 84. Back-translate and recode a CDS (#209)

**Asked:** back-translate a protein, or recode a CDS, for a host's codon
usage, with limits on restriction sites, GC and runs; keep the protein;
bundled hosts plus the user's own table; one undo step; record that it was
recoded; report CAI, do not maximise it blindly.

**Data.** No new data is bundled. The six hosts of item 47 (the Codon Usage
Database counts, `codonUsageTables.ts`, terms in `DATA-LICENSES.md`) are the
menu: E. coli W3110 (a K-12 derivative), S. cerevisiae, P. pastoris, human,
mouse, CHO. A user's own table is parsed by `parseCodonUsageText` (the
database's page layout, or a codon and a count per line), kept in IndexedDB
(`codonTables`, schema 11) like the imported overhang standards and never
uploaded.

**Engine (`core/analysis/recode.ts`).** Pure and deterministic, run on the
analysis worker (`recode` request). Each residue first takes a codon by the
chosen strategy: the host's commonest, or the host's own mix by error
diffusion (the codon furthest behind its share), which scores a lower CAI on
purpose. A codon below 10 % of its amino acid is left out of both. Then a
greedy repair walks the first limit broken and tries every synonymous codon
under it, keeping the move that lowers a severity score (sites weigh 4; a run
or a GC window weighs how far past its limit it is, so a change that eases a
problem counts as progress) and, on a tie, the codon the host uses most. A
second pass allows rare codons; what is still broken is returned as
`unresolved`, with where, never hidden. Greedy can miss a solution two moves
away: that is reported, not fixed by search. Sites are looked for on both
strands from the enzyme's IUPAC recognition sequence (methylation is not
considered: a site is kept out whatever blocks it), with 24 bases of flank
either side so a site across the gene's end counts. GC windows lie inside the
gene.

**Protein identity** is checked twice: `recodeSlots` translates every codon
against its slot and throws on a mismatch, and `finishRecodeCds` reads the
protein again with `translateCds` from the document the replacement makes and
compares it with the one before. The UI offers nothing that fails either.

**CDS in place (`recodeCds.ts`).** One same-length `replace` over the CDS, so
nothing moves and every feature, style and the length stay; codons are
written back through `translateCds`'s positions, complemented on the reverse
strand, lower case kept. The start codon, stop codons and codons with a
non-ACGT base are fixed. Refused, with the reason on the button: a join (the
spliced sequence is not what the host's DNA reads, so sites and GC would be
measured on the wrong thing), a CDS across the origin, `/transl_except`.
The feature gets a `/note` ("Recoded for E. coli (W3110) codon usage ...")
replacing an earlier one. The replace and the note are two ops but one undo
step, joined with the history's coalescing keys.

**Back-translate** is the same engine with no fixed codons, on a protein
document; a final stop is added when there is none; the DNA opens as a new
document with its CDS annotated. Residues with no codon (X, B, Z) are
refused.

Not done: an enzyme picker beyond a typed, completing list of names (there is
no shared picker component to reuse; Golden Gate's is a menu of one enzyme);
recoding the selection rather than a CDS; joins; optimising for mRNA
structure or tRNA pools.
