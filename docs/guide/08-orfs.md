# Open reading frames

The **ORFs** tab lists open reading frames: stretches that start with `ATG`
and run in frame to the first stop codon, on both strands, including frames
that cross the origin of a circular sequence. The list updates in the
background whenever the sequence changes.

Each row shows the strand (→ forward, ← reverse), the range in 1-based
coordinates (including the stop codon) and the length of the protein in
amino acids. The list is sorted by position.

## Minimum length

Only ORFs of at least **Minimum length** codons (not counting the stop) are
listed; the default is 75 codons, about 225 bp. Lower it to see short
peptides, raise it to keep the list to real genes. Press `Enter` or leave the
field to apply.

## Genetic code

**Code** chooses the genetic code the scan reads with. It decides where an
ORF ends as well as where it may begin: under the standard code the stops
are `TAA`, `TAG` and `TGA`, while under the vertebrate mitochondrial code
`TGA` is tryptophan and `AGA`/`AGG` are stops instead — so a mitochondrial
gene scanned with the standard code is cut short at the first `TGA`.

It is the same choice as the [Translate](09-translate.md) tab's, one for the
app rather than per document, and it is remembered. A `CDS` feature is not
affected: those are always read with their own `/transl_table`.

## Working with an ORF

1. **Click** an ORF to select it. Both views scroll to it.
2. **ORF translation** below the list shows the protein, with the first
   codon as `M` and the stop as `*`.
3. **Copy protein** puts the amino-acid sequence on the clipboard.
4. **Add as CDS feature** annotates the ORF as a `CDS` with `/codon_start=1`
   and the `/translation`, opens the Features tab and lets you type the
   name straight away. When the code is not the standard one it writes
   `/transl_table` too, so the feature reads back the way it was found.

If some other range is selected (not an ORF from the list), the tab shows
the translation of that selection in frame +1 instead, so you can check any
stretch of at least three bases. For all six frames at once, use the
[Translate](09-translate.md) tab.
