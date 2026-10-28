# Cloning tutorial: Ligation and Golden Gate

Hands-on exercises for the [Bench](../../guide/12-cloning.md#the-bench). Every
file here is a **synthetic example**: invented sequences, nothing taken from
a catalogue, a paper or a database. Every number below is checked by
`src/core/cloning/tutorialFiles.test.ts`, which runs these same files through
the functions the Bench uses, so the tutorial cannot drift from the app
without the build failing.

Each exercise is done twice: once with the synthetic ORF in this folder, and
once with a real gene, human insulin (`INS`), that you fetch from NCBI. A gene
off NCBI has no cloning sites at its ends, so those exercises start by
designing primers that add them.

## Files

| File                                      | What it is                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pLig-Vector.gb`                          | Circular 2,664 bp vector for the ligation exercises: `synthetic promoter`, `MCS` (EcoRI, PstI, BamHI, in that order), `synthetic terminator`, `AmpR` (a stand-in resistance gene, reverse strand), `ori` (a stand-in origin). EcoRI, PstI and BamHI cut it once each, all inside the MCS. |
| `Insert-EcoRI-BamHI.gb`                   | Linear 819 bp: EcoRI site, the 783 bp ORF `synthORF1` (ATG to stop), BamHI site, with a few bases of padding. No other EcoRI, BamHI or PstI site.                                                                                                                                         |
| `Insert-PstI-BamHI.gb`                    | The same ORF with a PstI site where the EcoRI site was: the negative control.                                                                                                                                                                                                             |
| `Insert-EcoRI-EcoRI.gb`                   | The same ORF with an EcoRI site at both ends, for single-enzyme cloning and dephosphorylation.                                                                                                                                                                                            |
| `pGG-Destination.gb`                      | Circular 2,647 bp Golden Gate destination vector: `KanR` (stand-in), `ori`, and a `lacZ-dropout` between two BsaI sites.                                                                                                                                                                  |
| `GG-prom.gb`                              | Part 1, 106 bp, `synthetic promoter`, BsaI overhangs `GGAG` ... `AATG`.                                                                                                                                                                                                                   |
| `GG-cds.gb`                               | Part 2, 623 bp, `synthCDS`, a coding part without a stop, `AATG` ... `TTCG`.                                                                                                                                                                                                              |
| `GG-tag.gb`                               | Part 3, 55 bp, `synthTag` (a short linker and His tag ending in a stop codon), `TTCG` ... `GCTT`.                                                                                                                                                                                         |
| `GG-term.gb`                              | Part 4, 96 bp, `synthetic terminator`, `GCTT` ... `CGCT`.                                                                                                                                                                                                                                 |
| `GG-broken-internal-BsaI.gb`              | Part 3 with a third BsaI site inside it (54 bp).                                                                                                                                                                                                                                          |
| `GG-broken-duplicate-overhang.gb`         | Part 3 whose right overhang is `AATG`, already taken by the promoter/CDS junction.                                                                                                                                                                                                        |
| `GG-warn-tag.gb`, `GG-warn-terminator.gb` | A replacement pair for parts 3 and 4 that joins on `AATC`, one base from `AATG`: assembles, with a warning.                                                                                                                                                                               |

Not in this folder: the INS record. It is third party data, so you fetch it
yourself (below); nothing here contains it.

## Opening the files

Either drag the files onto the PlasmidPop window, or use **File ▸ Open** and
select several at once. Each opens in a tab of its own; **File ▸ Show files**
(the **Files** tab) lists them. Open only what an exercise names, in the order
it names, and close the rest, because the Golden Gate panel puts every open
tab in the tube.

Throughout, **Hide all** in the Enzymes tab clears the ticks: a file you open
yourself opens with every enzyme that cuts once ticked, so clear them and tick
only what the exercise says; the **Filter** box finds an enzyme by name. A
product the app makes (Assemble, Simulate) opens with only the enzymes the
reaction used ticked, and the exercises say which.

## Ligation

Background: [Ligation](../../guide/12-cloning.md#ligation),
[The shelf](../../guide/12-cloning.md#the-shelf) and
[Digest](../../guide/12-cloning.md#digest).

### A. Directional cloning with EcoRI + BamHI

1. Open `pLig-Vector.gb` and `Insert-EcoRI-BamHI.gb`.
2. Vector tab: Enzymes tab, **Hide all**, tick **EcoRI** and **BamHI**. Open
   the **Cloning** tab (picker: **Digest**). Expect two fragments:
   - **2,640 bp**, `BamHI 5′ GATC` at its left end and `EcoRI 5′ AATT` at its
     right: the backbone;
   - **24 bp**, `EcoRI 5′ AATT` to `BamHI 5′ GATC`: the stuffer, with the PstI
     site in it.

   Click **Add** on the **2,640 bp** row. It reads **Added ✓** and the Bench
   count goes to 1.

3. Insert tab: Enzymes tab, **Hide all**, tick **EcoRI** and **BamHI**. The
   digest gives **801**, 11 and 7 bp; the 11 and 7 bp pieces are the padding
   with a blunt end. The 801 bp piece is `EcoRI 5′ AATT` to `BamHI 5′ GATC`
   and carries `synthORF1`. **Add** it.
4. Open the **Bench** tab, choose **Ligation**. The shelf has two parts, the
   backbone first, then the insert. Untick nothing; keep **Circular product**
   ticked.
5. Check the junctions: backbone to insert **✓** (EcoRI to EcoRI), insert to
   backbone, the closing junction, **✓** (BamHI to BamHI). Nothing needs
   flipping with **⇄**.
6. The **Product** line says: **3,441 bp, circular**, carrying the synthetic
   promoter, the synthetic terminator, `AmpR`, `ori` and `synthORF1`
   (`MCS` is there twice, as two partial pieces: the cut ran through it, and
   the 24 bp stuffer with the PstI site is gone). Click **Assemble**.
7. In the new document: `synthORF1` is on the **forward** strand, the same way
   as the promoter. The Enzymes tab has **EcoRI** and **BamHI** ticked, the two
   enzymes the ligation used, and each cuts it once; **PstI cuts it not at
   all** (it cut the vector only inside the stuffer); SacI cuts it twice (once
   in the backbone, once in the ORF, see the extra below).

What to check:

- [ ] Backbone 2,640 bp and stuffer 24 bp, not one 2,664 bp band: both
      enzymes cut.
- [ ] Both junctions say **✓**.
- [ ] Product 3,441 bp = 2,640 + 801.
- [ ] No PstI site in the product.

**Check by digest** is on the Bench, under the product's map, before you press
**Assemble** (the assembled document has no such panel). A vector cut with two
enzymes cannot close on itself, so the Bench says there is no empty vector to compare
with and ranks the product's own lane, clearest first. With the bundled
enzyme set the first rows are `MluI: 2,876 + 565 bp`, `HpaI: 2,741 + 700 bp`,
`ScaI: 2,566 + 875 bp`, `SacI: 2,541 + 900 bp`. The vector alone with SacI is
one band, 2,664 bp: that is how a miniprep digest of this clone differs from
the empty vector.

### B. Negative control: ends that do not match

1. Close the insert from A (or leave it). Open `Insert-PstI-BamHI.gb`. Tick
   **PstI** and **BamHI** only and **Add** the **797 bp** piece
   (`PstI 3′ TGCA` to `BamHI 5′ GATC`). On the Bench, remove the earlier
   insert with its **✕** so the shelf holds the 2,640 bp backbone first and this insert
   second.
2. The junction from the backbone to the insert says **✕ ends do not match**:
   the backbone ends in EcoRI (`AATT`, 5′ overhang), the insert begins with PstI
   (`TGCA`, 3′ overhang). The closing junction (BamHI to BamHI) is **✓**.
   There is no **Product** line and **Assemble** stays off.
3. Press **⇄** on the insert: now **both** junctions say ✕ (BamHI against
   EcoRI, PstI against BamHI). No orientation works, which is the point:
   incompatible ends are never rescued by flipping.
4. The fix, as a designer would: put the vector's PstI end to use. Remove the
   backbone from the shelf with **✕**, re-tick **PstI** and **BamHI** on the vector
   (fragments **2,656** and **8 bp**), **Add** the 2,656 bp backbone, and put it
   first. Both junctions turn **✓** and the product is **3,453 bp**, circular, with exactly one PstI site.

Remember what the vector's other end is for: with EcoRI on one side and PstI
on the other the insert cannot go in at all; the vector's two ends and the
insert's two ends must be the same pair.

### C. One enzyme: why dephosphorylate (−P)

A vector cut with a single enzyme has two identical ends and can close on
itself, which is the usual empty-vector background. A phosphatase takes the 5′
phosphates off, so it cannot.

1. Open `Insert-EcoRI-EcoRI.gb` (and the vector). On both, tick **EcoRI** only.
   Vector: one fragment, **2,664 bp**, `EcoRI 5′ AATT` at both ends. Insert:
   the **801 bp** piece, EcoRI at both ends. **Add** both, vector first.
2. Bench, **Ligation**. Untick the insert so only the vector is in the
   reaction: its closing junction is **✓**, product **2,664 bp**: the vector
   closed on itself, with no insert.
3. Tick the insert again, and press **−P** on the vector's shelf row. Now the
   vector alone (untick the insert once more) says **both sides
   dephosphorylated** and **Assemble** is off. With the insert ticked as well
   the junctions are **✓ ✓** (the insert still has its phosphates) and the product
   is **3,465 bp**, circular.
4. Orientation is not decided by the enzyme. The insert as shelved gives
   `synthORF1` on the **forward** strand; **⇄** on the insert gives the same
   3,465 bp with `synthORF1` on the **reverse** strand. On a bench you would
   screen for the right one.

Optional extra, a miniprep check digest: repeat step 3 without **−P** and, on
the Bench, look at **Check by digest** under the 3,465 bp product, before
**Assemble**. After **Assemble** the product opens with **EcoRI** ticked, two
sites.
The vector is the longest part, so it is the empty vector (cut once with EcoRI
and closed on itself, 2,664 bp). The first rows: `EcoRI: 2,664 + 801 bp | empty
2,664 bp` and `SacI: 2,565 + 900 bp | empty 2,664 bp`. An insert-carrying
colony shows the 801 bp band with EcoRI, an empty one only 2,664 bp, which
is why −P matters.

### Ligation with a gene from NCBI: human insulin (INS)

Accession **`NM_000207`** (`NM_000207.3`, human insulin, mRNA, 465 bp; its CDS
is 333 bp, the 110 residue preproinsulin plus the stop codon). It has no EcoRI
or BamHI site in the CDS (checked), which is why EcoRI + BamHI will work.

1. Open `pLig-Vector.gb` and leave it in front. Open the **Primers** tab
   (sidebar) and switch the mode at the top to **Clone an insert into this
   plasmid**.
2. **Where on the vector**: nothing selected; it takes the feature named
   `MCS`.
3. **What to insert**: **Gene from NCBI…**, type `NM_000207` in the box
   (only that accession is sent to NCBI) and press **Add**. The record opens as
   a tab of its own, and its CDS becomes the insert: 333 bp, starting
   `ATGGCCCTGTGGATGCGC` and ending `...CTGGAGAACTACTGCAACTAG`. The workspace stays on the
   vector.
4. **Enzymes**: the suggestions list **EcoRI · BamHI** first (the other usable pairs after
   it). Click that row. Leave **Padding** (6) and **Junction** at their
   defaults.
5. **Design primers**. The primers, written as ordered (tail in lower case):

   ```
   INS-F-EcoRI  5′ gttctggaattcATGGCCCTGTGGATGCGC 3′              (annealing part 18 nt, Tm 60.9 °C)
   INS-R-BamHI  5′ ctaataggatccCTAGTTGCAGTAGTTCTCCAGC 3′           (annealing part 22 nt, Tm 55.6 °C)
   ```

   Expected: **PCR 357 bp**, one **caution** warning (no annealing part
   at the insert's ends meets the settings, nearest is "GC content above 65%":
   the start of the insulin CDS is GC rich), no red ones. The reverse primer's
   annealing part includes the stop codon (`CTA` is the reverse complement of
   `TAG`).

6. **Simulate** runs PCR on the record, the EcoRI + BamHI digests and the
   ligation into the vector's backbone, and opens the product as a new
   document: **2,979 bp, circular**. It carries the vector's features and the
   record's annotation (`INS`, `insulin preproprotein`, `sig_peptide`,
   `proinsulin`, `insulin B chain`, `C-peptide` and the exons), plus the two
   primers as features, named after the record's feature
   (`insulin_preproprotein-F-EcoRI`); the primer names above are labels for this
   page.
   The product opens with **EcoRI** and **BamHI** ticked in the Enzymes tab,
   the two enzymes the primers use: one site each (EcoRI just before the
   `ATG`, BamHI just after the stop codon). PstI does not cut this product at
   all.
7. Optional, a miniprep-style check: which single enzyme tells a colony that
   took the insert from one that did not. The enzyme with the clearest bands
   for this product is **MluI**, which cuts it **twice**: **2,414 + 565 bp**
   (the same ranking function the Bench's **Check by digest** uses). That
   panel is not on screen here: this product came from the primer workspace's
   **Simulate**, not from a Bench reaction. Use the product's own Enzymes tab:
   1. **Hide all**, so EcoRI and BamHI stop counting in the digest.
   2. **Cuts** is a remembered setting. If it says **Once**, MluI is not
      listed, because it cuts twice. Change it to **Twice**, **Once or twice**,
      **3 times or fewer** or **Any number**; **Filter** (the name box) narrows
      the list further, so type `MluI` there to find it quickly.
   3. Tick **MluI**. **Fragments from ticked enzymes** reads
      `2,414, 565 bp`, two bands on the gel lane.

## Golden Gate

Background: [Golden Gate](../../guide/12-cloning.md#golden-gate).

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

### Seeing the warnings

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

### Golden Gate with a gene from NCBI: human insulin (INS)

The app's primer workspace has no Golden Gate primer mode: its cloning mode designs
restriction-site primers (and warns on a Type IIS enzyme rather than designing
for it). So the primers are written by hand and entered in Cloning ▸ PCR, which
takes any oligo with a tail. The layout of a Golden Gate primer is:

`5′ - padding - BsaI site - 1 spacer base - 4-nt overhang - gene-specific 3′ end - 3′`

Here the gene replaces `GG-cds` (`AATG` ... `TTCG`), with no stop codon of its own so
that the tag follows in frame. The insulin CDS is 110 codons plus a stop, so the stop
is left out, and the 330 bp that remain are a whole number of codons.

```
INS-F-BsaI  5′ TTGGTCTCAAATGGCCCTGTGGATGCGCCTCC 3′
            TT | GGTCTC | A | AATG (the ATG is the gene's start) ... the gene from its first base
INS-R-BsaI  5′ TTGGTCTCACGAAGTTGCAGTAGTTCTCCAGCTGG 3′
            TT | GGTCTC | A | CGAA (reverse complement of TTCG) | gene's last 22 bases before the stop, reverse complemented
```

1. Fetch `NM_000207` as in the ligation section (**File ▸ Open from NCBI…**,
   type `NM_000207`, **Open**), and leave its tab in front.
2. Cloning tab, picker **PCR**. Paste the two oligos above. Template is the
   record. The panel finds one product of **353 bp** (the 330 bp CDS plus both
   tails). **Open** it: its two BsaI sites point inwards, with `AATG` at the left end
   and `TTCG` at the right.
3. Open `pGG-Destination.gb`, `GG-prom.gb`, `GG-tag.gb` and `GG-term.gb` too.
   **Close or untick every other tab**: the INS record has no BsaI site and
   would sit in the tube as a blunt piece, and the Ligation exercise files are
   not wanted.
4. Bench, **Golden Gate**, BsaI. The tube now has: the destination, the
   promoter, the PCR product `NM_000207 PCR product` (in place of
   `GG-cds`), the tag and the terminator. Order: destination, promoter, PCR
   product, tag, terminator; no warnings.
5. **Product: 2,848 bp**, circular, with `KanR`, `ori`, `synthetic promoter`,
   `INS` and the insulin chain features, `synthTag`, `synthetic terminator`.
   Translating from the INS start codon gives
   `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCNFGGSGGHHHH*`: preproinsulin, then
   the linker and His tag from the tag part, one frame, one stop.
6. **Check by digest**, on the Bench before **Assemble**, against the destination (2,647 bp): first rows
   `AseI: 2,313 + 535 bp | empty 2,647 bp` and `EcoNI: 2,220 + 628 bp | empty 2,647 bp`.

(These NCBI results were verified against a local copy of the record kept
under the gitignored `fixtures/local/ncbi/NM_000207.gb`; the test skips cleanly when that file
is absent.)

## If a number does not match

The numbers above are for the bundled enzyme set (the default) and for the
documents with their default host methylation (dam+ dcm+). None of the sites
in these files lies in a dam or dcm context, so the numbers are the same with
either; the ranking of the check digest's enzymes depends on the enzyme set in
use, the band sizes of the named enzymes do not.
