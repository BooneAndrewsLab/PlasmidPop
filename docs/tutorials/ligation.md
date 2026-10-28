# Ligation: restriction cloning

Cut a vector and an insert with restriction enzymes and join them with ligase.
Four short exercises on the [Bench](../guide/12-cloning.md#the-bench): the
directional case that works, the mismatch that cannot, the single-enzyme case
that needs dephosphorylation, and a real gene from NCBI. About 30 minutes. Read
[Before you start](before-you-start.md) first if the Bench or the sample files
are new to you, and [Digest and PCR basics](digest-pcr.md), the basics this
tutorial builds on, if cutting a plasmid or the shelf is new. Every number below is checked by
`src/core/cloning/tutorialFiles.test.ts`, which runs these same files through
the functions the Bench uses.

**Files for this tutorial** (synthetic, plain downloads):
[pLig-Vector.gb](files/pLig-Vector.gb),
[Insert-EcoRI-BamHI.gb](files/Insert-EcoRI-BamHI.gb),
[Insert-PstI-BamHI.gb](files/Insert-PstI-BamHI.gb),
[Insert-EcoRI-EcoRI.gb](files/Insert-EcoRI-EcoRI.gb). The insulin gene
(`NM_000207`) is third party data: you fetch it in the app, nothing here
contains it.

Background: [Ligation](../guide/12-cloning.md#ligation),
[The shelf](../guide/12-cloning.md#the-shelf) and
[Digest](../guide/12-cloning.md#digest).

## A. Directional cloning with EcoRI + BamHI

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

## B. Negative control: ends that do not match

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

## C. One enzyme: why dephosphorylate (−P)

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

## Ligation with a gene from NCBI: human insulin (INS)

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

Next: [Golden Gate: one gene into one vector](golden-gate.md), or back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).
