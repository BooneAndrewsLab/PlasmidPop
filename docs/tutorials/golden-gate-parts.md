# Golden Gate: four parts and the warnings (Tutorials 2 and 3)

Tutorial 2 builds a promoter, a coding part, a tag and a terminator into one
destination vector in a scrambled tab order; Tutorial 3 shows the warnings a bad
design raises. Both follow [Golden Gate: one gene into one
vector](golden-gate.md), which you should do first. About 30 minutes.

**Files for these tutorials** (synthetic, plain downloads):
[pGG-Destination.gb](files/pGG-Destination.gb), [GG-prom.gb](files/GG-prom.gb),
[GG-cds.gb](files/GG-cds.gb), [GG-tag.gb](files/GG-tag.gb),
[GG-term.gb](files/GG-term.gb),
[GG-broken-internal-BsaI.gb](files/GG-broken-internal-BsaI.gb),
[GG-broken-duplicate-overhang.gb](files/GG-broken-duplicate-overhang.gb),
[GG-warn-tag.gb](files/GG-warn-tag.gb),
[GG-warn-terminator.gb](files/GG-warn-terminator.gb). The insulin gene
(`NM_000207`) is fetched in the app.

## Tutorial 2: four parts in one tube

Four parts, a destination and a scrambled tab order. Read [Before you
start](before-you-start.md) first if the sample files are new to you.

Background: [Golden Gate](../guide/12-cloning.md#golden-gate).

The design: BsaI cuts `GGTCTC` and leaves a 4-base overhang one base beyond the
site on the far side. In every part (`GG-prom.gb` to `GG-term.gb`) the two sites
point inwards, so cutting throws the sites and the flanks away. In the
destination vector the two sites sit _inside_ the `lacZ-dropout` and point out
towards the backbone, so cutting throws away the dropout and its sites and keeps
the rest. The backbone's two ends are `CGCT` and `GGAG`; the parts carry
`GGAG`→`AATG`, `AATG`→`TTCG`, `TTCG`→`GCTT`, `GCTT`→`CGCT`. Five distinct overhangs, none
palindromic, none one base from another, so nothing can join the wrong ends.

**The overhangs, not the tab order, decide the order.** Open the files in a scrambled
order on purpose.

1. Open, in this order: `GG-tag.gb`, `GG-prom.gb`, `GG-term.gb`,
   `pGG-Destination.gb`, `GG-cds.gb`. Close any other tab.
2. **Bench**, **Golden Gate**. **Enzyme: BsaI** (the default), no second enzyme.
   Every open document is in the tube, each listed with its tab; none unticked.
3. The panel reports the order it found, whatever the tab order was:
   `pGG-Destination`, `GG-Part1-Promoter`, `GG-Part2-CDS`, `GG-Part3-Tag`,
   `GG-Part4-Terminator` (it starts the circle at whichever document is first
   in the tube, so it may begin at a different part; the cyclic order is the
   same). The overhang each part joins on is `GGAG`, `AATG`, `TTCG`, `GCTT`,
   `CGCT`. Nothing says **(flipped)**.
4. **9 pieces left out** (expand it): the vector's 321 bp dropout and each
   part's two flanks, each "still carries the BsaI site, so the reaction cuts it again".
5. **Product**: **3,118 bp, circular**, with `KanR`, `ori`, `synthetic promoter`,
   `synthCDS`, `synthTag`, `synthetic terminator` (no `lacZ-dropout`, no BsaI
   site). **No overhang warnings.** **Assemble**.
6. In the product, the Enzymes tab has **BsaI** ticked, the Bench's enzyme, but
   it has no site left, so nothing is marked (a second enzyme set on the
   Bench would be ticked too). `synthCDS` runs straight into `synthTag` in the same frame:
   translating from the CDS's ATG gives one open reading frame that ends
   `...FGGSGGHHHH*`.

What to check:

- [ ] Order and overhangs as above, however you ordered the tabs. Close all and
      reopen in another order to convince yourself.
- [ ] 9 pieces left out, none of them parts.
- [ ] 3,118 bp = the 2,326 bp backbone + 84 + 601 + 33 + 74 bp of parts.

**Check by digest** (on the Bench, before **Assemble**). The empty vector is the longest part, the uncut
destination, 2,647 bp (**Against** picks another). With the bundled enzyme
set the first rows are `AseI: 2,583 + 535 bp | empty 2,647 bp` and
`DraI: 1,953 + 1,165 bp | empty 2,647 bp`. This is the Golden Gate miniprep:
an insert-carrying clone gives the two product bands; a clone that kept the
dropout (the empty vector) gives one.

## Seeing the warnings

Keep the vector, parts 1 and 2 open; close the original part 3 and part 4.

- **Internal BsaI site.** Open `GG-broken-internal-BsaI.gb` in place of part 3
  (and `GG-term.gb` as part 4). BsaI cuts that part in three; the middle
  piece is useful, but the pieces that still carry a site are cut again, and
  the overhang the CDS hands on, `TTCG`, now has no part to start from. The
  panel says **No part starts with the overhang BsaI 5′ TTCG left by
  GG-Part2-CDS. 2 of 5 parts were never reached.** and **Assemble** is off.
  A site inside a part always breaks it.
- **Duplicate overhang.** Open `GG-broken-duplicate-overhang.gb` in place of part
  3 (with `GG-term.gb`). Its right overhang `AATG` is the one the CDS already
  starts on. The panel says **No part starts with the overhang BsaI 5′ AATG left
  by GG-Broken-Tag-DuplicateOverhang.** Golden Gate needs every overhang
  distinct: two parts offering the same overhang give an ambiguous, unusable
  design, and the panel refuses to guess.
- **Near-miss warning (assembles).** Open `GG-warn-tag.gb` and
  `GG-warn-terminator.gb` as parts 3 and 4 (with parts 1 and 2 and the vector).
  It assembles to **3,118 bp**, with the warning **AATG and AATC differ at one
  base, so a ligase may join one in place of the other.** This is what a
  warning means: the product shown is the one the design intends and
  **Assemble** still works, but in the tube the ligase can pair `AATG` with
  `AATC` and make other products. A designer swaps one of the overhangs.

## Four parts with a gene from NCBI: human insulin (INS)

The gene replaces `GG-cds` (`AATG` ... `TTCG`), with no stop codon of its own so
that the tag follows in frame. The insulin CDS is 110 codons plus a stop, so the
stop is left out, and the 330 bp that remain are a whole number of codons. The
primer workspace designs the two oligos for that; nothing is typed by hand.

The layout of a Golden Gate primer, which the workspace follows:

`5′ - padding - BsaI site - 1 spacer base - 4-nt overhang - gene-specific 3′ end - 3′`

1. Open `pGG-Destination.gb`, `GG-prom.gb`, `GG-tag.gb` and `GG-term.gb`, and
   close the Ligation exercise's files. Leave **pGG-Destination** in front: it
   is the destination, and the workspace designs against the document in front.
2. **Primers ▸ Design** (the primer workspace), mode **Clone an insert into
   this plasmid**. Step 2, **Gene from NCBI…**, type `NM_000207`, **Add**. The
   record opens as a tab of its own and its CDS becomes the insert — 333 bp,
   named `insulin preproprotein` after the CDS's `/product`, as in the
   ligation exercise above — while the workspace stays on the destination.
3. Step 3, **Ends ▸ Golden Gate part**. **Enzyme: BsaI** (the default); the
   note beside it reads `GGTCTC then 1 base and a 4-base 5′ overhang`, from the
   enzyme table. Leave **and** at _no other_.
4. **Overhangs**: type `AATG` on the left and `TTCG` on the right (the picker's
   **From pGG-Destination: GGAG…CGCT** is the pair for a part filling the whole
   dropout; here the CDS sits between the promoter and the tag, so it takes
   their junctions instead). Leave **Include the start codon** ticked and
   **Include the stop codon** unticked.
5. The note under the fields: the part is **335 bp**, `AATG` (its last 3 bases
   are the part's own start codon, so the primer anneals from the base after
   it) … `TTCG`, stop codon left out, **330 coding bases** to the right
   overhang — a whole number of codons, so what follows reads on in frame —
   and a **PCR product of 361 bp**. **Design primers**.
6. Results shows the one part: `BsaI part AATG…TTCG`, both oligos with their
   padding, site, spacer and overhang told apart from the annealing part, and
   one amber warning about the annealing parts (the gene's ends are GC-rich).
   The tube line on the Design page names the destination, the promoter, the
   tag and the terminator; the INS record has no BsaI site, so it is not in it.
7. **Simulate**: the PCR runs on the INS tab and the Golden Gate on the five
   parts, and the product opens as `pGG-Destination-insulin preproprotein`,
   **2,848 bp**,
   circular, with `KanR`, `ori`, `synthetic promoter`, `INS` and the insulin
   chain features, `synthTag`, `synthetic terminator`, and **BsaI** ticked in
   its Enzymes tab. Translating from the INS start codon gives
   `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCNFGGSGGHHHH*`: preproinsulin, then
   the linker and His tag from the tag part, one frame, one stop. (The
   product and the primers are named after that CDS feature, so the tab is
   `pGG-Destination-insulin preproprotein` and **Save both** keeps
   `insulin_preproprotein-F-BsaI` and `-R-BsaI`.)
8. **Check by digest**: put the same five documents on the Bench's **Golden
   Gate** and read the check digest there before **Assemble**, against the
   destination (2,647 bp): first rows `AseI: 2,313 + 535 bp | empty 2,647 bp`
   and `EcoNI: 2,220 + 628 bp | empty 2,647 bp`.

(The oligos themselves depend on the padding setting — 6 bases by default,
which is what NEB advises for an enzyme its cleavage-near-the-end chart does
not rate — and on the annealing lengths the designer picks, so they are not
written out here. What does not depend on them is the part, 335 bp between
`AATG` and `TTCG`, and the 2,848 bp product.)

(These NCBI results were verified against a local copy of the record kept
under the gitignored `fixtures/local/ncbi/NM_000207.gb`; the test skips cleanly when that file
is absent.)

Back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).
