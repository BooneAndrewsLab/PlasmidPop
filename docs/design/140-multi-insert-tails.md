# 140. Tail primers for several inserts in one assembly (#413)

**Asked:** `designOverlapPrimers` (item 63, reused by item 139) takes one
insert against the vector's two ends, but a real assembly is the vector plus a
promoter, a gene and a terminator, where the tails also carry the homology
between the inserts. Design the primers for every insert of an ordered
assembly, for yeast, Gibson, In-Fusion and NEBuilder alike.

## 1. A second function, not a wider one

`designMultiOverlapPrimers` (`overlapAssembly.ts`) takes an ordered list of
`{ template, region, reverse }`. `designOverlapPrimers` stays as it is: its
callers, its recorded-lineage path (`recordOverlapDesign`) and the tutorials
that print its primers are untouched, and a test pins that one insert gives
the same two primers from either function.

## 2. Where the homology goes

A junction of `N` bases between inserts A and B is the last `k` bases of A
followed by the first `N-k` of B. B's forward tail is the first part, A's reverse
tail is the reverse complement of the second, so A's amplicon ends with, and
B's begins with, the same `N` bases. `k = N` puts the junction wholly on B's
forward primer, `k = 0` wholly on A's reverse primer, `k = ceil(N/2)` is the
default "half each". One choice applies to every junction; per-junction choices
were not asked for. The first and last tails are the vector's ends, as before.

Yeast takes the overlap as an option, held to 20 to 80 (`clampYeastOverlap`),
default 40. The other kits keep their fixed 15 and 20: the kits ask for those.

## 3. Orientation

An insert can be read on the reverse strand: its text is the reverse
complement of the region, the primers are designed on that, and `pcr` finds the
product on the template's own strand, so the amplicon is looked for as the text
or its reverse complement (`productHolding` twice). The assembly is order- and
strand-independent (`gibson` finds the joins by homology), which is why the
result is checked.

## 4. Running the design

Each insert's primers are run with `pcr`, the amplicons and the vector are
assembled by the kit's own function, and the circle is compared with
`vector + inserts` read round the circle on either strand. A design that closes
in another order, or whose homology matches something beyond the junctions,
is a failure with a message, not a product. Warnings are the finished
assembly's, plus the sticky-ends note and a line saying how many junctions and
how they are split.

## 5. UI

`bench.overlap` gains `reverse` (insert 1), `more` (the further inserts, at
most eight in all), `split` and `overlap`, normalised like the rest of
`BenchSettings`. With no further insert the panel is the single design,
unchanged. **Check primers…** stays single-insert: Clone check takes one
amplicon pair, and a multi-insert check is a follow-up.

## 6. Tutorial

Exercise 9 of `yeast-assembly.md`: the _ADH1_ promoter (700 bp), a GFP
coding sequence (`U50963`) and the _CYC1_ terminator (200 bp) into pRS416,
6,515 bp, pinned in a `skipIf` block like exercises 6 to 8. The promoter
and terminator are features the user adds to gene-box windows, because a
tab's selection can serve one insert only; the records live in
`fixtures/local/ncbi` (`ADH1-window.gb`, `CYC1-window.gb`, `U50963.gb`),
which is gitignored.
