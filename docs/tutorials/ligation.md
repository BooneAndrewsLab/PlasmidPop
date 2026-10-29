# Ligation: restriction cloning

- **You will end with:** a 3,441 bp circular plasmid from a vector and an insert joined with EcoRI and BamHI, then the same idea with human insulin from NCBI (2,979 bp circular).
- **Time:** about 30 minutes.
- **Files:** [pLig-Vector.gb](files/pLig-Vector.gb), [Insert-EcoRI-BamHI.gb](files/Insert-EcoRI-BamHI.gb), [Insert-PstI-BamHI.gb](files/Insert-PstI-BamHI.gb), [Insert-EcoRI-EcoRI.gb](files/Insert-EcoRI-EcoRI.gb). The insulin gene (`NM_000207`) is third party data: you fetch it in the app, nothing here contains it.
- **Before this:** [Digest and PCR basics](digest-pcr.md) (and [Before you start](before-you-start.md) if the Bench or the sample files are new to you).

Four short exercises on the [Bench](../guide/12-cloning.md#the-bench): the directional case that works, the mismatch that cannot, the single-enzyme case that needs dephosphorylation, and a real gene from NCBI.

## Exercise 1 of 4: directional cloning with EcoRI + BamHI

1. Open `pLig-Vector.gb` and `Insert-EcoRI-BamHI.gb`.
2. In the vector's tab open the **Enzymes** tab and click **Hide all**. (A file you open opens with every single cutter ticked, and the digest follows the ticks and nothing else.)

3. Tick **EcoRI** and **BamHI**.
4. Open the **Cloning** tab (picker: **Digest**).

   > [!NOTE]
   > You see two fragments: **2,640 bp** (`BamHI 5′ GATC` at its left end, `EcoRI 5′ AATT` at its right: the backbone) and **24 bp** (`EcoRI 5′ AATT` to `BamHI 5′ GATC`: the stuffer, with the PstI site in it).

   > [!WARNING]
   > If instead you see one fragment of 2,664 bp, only one of the two enzymes is cutting; check that both are ticked.

5. Click **Add** on the **2,640 bp** row.

   > [!NOTE]
   > You see **Added ✓** and the Bench count goes to 1.

6. In the insert's tab open the **Enzymes** tab, click **Hide all**, and tick **EcoRI** and **BamHI**.

   > [!NOTE]
   > You see **801**, 11 and 7 bp. The 11 and 7 bp pieces are the padding with a blunt end; the 801 bp piece is `EcoRI 5′ AATT` to `BamHI 5′ GATC` and carries `synthORF1`.

7. **Add** the 801 bp piece.
8. Open the **Bench** tab and choose **Ligation**. Untick nothing; keep **Circular product** ticked.

   > [!NOTE]
   > You see two parts on the shelf, the backbone first, then the insert.

9. Check the junctions. Nothing needs flipping with **⇄**.

   > [!NOTE]
   > You see backbone to insert **✓** (EcoRI to EcoRI) and the closing junction **✓** (BamHI to BamHI).

10. Read the **Product** line.

    > [!NOTE]
    > You see **3,441 bp, circular**, carrying the synthetic promoter, the synthetic terminator, `AmpR`, `ori` and `synthORF1`.

    > [!TIP]
    > `MCS` is there twice, as two partial pieces: the cut ran through it, and the 24 bp stuffer with the PstI site is gone.

11. Click **Assemble**.

    - [ ] The new document is **3,441 bp** (2,640 + 801) with `synthORF1` on the **forward** strand, the same way as the promoter.

    > [!WARNING]
    > If not, go back to the junction line: a **✕** there means the ends do not match.

12. Open the new document's **Enzymes** tab.

    > [!NOTE]
    > You see **EcoRI** and **BamHI** ticked, each cutting once. **PstI cuts it not at all** (it cut the vector only inside the stuffer); SacI cuts it twice (once in the backbone, once in the ORF).

Optional, a miniprep check: **Check by digest** is on the Bench, under the product's map, before you press **Assemble** (the assembled document has no such panel). A vector cut with two enzymes cannot close on itself, so the Bench says there is no empty vector to compare with and ranks the product's own lane, clearest first. With the bundled enzyme set the first rows are `MluI: 2,876 + 565 bp`, `HpaI: 2,741 + 700 bp`, `ScaI: 2,566 + 875 bp`, `SacI: 2,541 + 900 bp`. The vector alone with SacI is one band, 2,664 bp: that is how a miniprep digest of this clone differs from the empty vector.

## Exercise 2 of 4: negative control, ends that do not match

1. Close the `Insert-EcoRI-BamHI` tab. (The shelf is separate from the tabs, so this changes nothing there; it just keeps the tab bar tidy.) Open `Insert-PstI-BamHI.gb`.
2. In its **Enzymes** tab tick **PstI** and **BamHI** only.
3. **Add** the **797 bp** piece (`PstI 3′ TGCA` to `BamHI 5′ GATC`).
4. On the Bench, remove the earlier insert with its **✕**.

   > [!NOTE]
   > You see the 2,640 bp backbone first and this insert second on the shelf.

5. Read the junctions.

   > [!NOTE]
   > You see the junction from the backbone to the insert say **✕ ends do not match**, the closing junction (BamHI to BamHI) **✓**, no **Product** line, and **Assemble** off.

   > [!TIP]
   > The backbone ends in EcoRI (`AATT`, 5′ overhang), the insert begins with PstI (`TGCA`, 3′ overhang): those cannot pair.

6. Press **⇄** on the insert.

   > [!NOTE]
   > You see **both** junctions say ✕ (BamHI against EcoRI, PstI against BamHI).

   > [!TIP]
   > No orientation works, which is the point: incompatible ends are never rescued by flipping.

7. The fix, as a designer would: put the vector's PstI end to use. Remove the backbone from the shelf with **✕**.
8. On the vector, re-tick **PstI** and **BamHI**.

   > [!NOTE]
   > You see fragments **2,656** and **8 bp**.

9. **Add** the 2,656 bp backbone, and put it first.

   - [ ] Both junctions are **✓** and the product is **3,453 bp**, circular, with exactly one PstI site.

   > [!WARNING]
   > If not, check that the backbone is first on the shelf and the insert second.

The vector's two ends and the insert's two ends must be the same pair: with EcoRI on one side and PstI on the other, the insert cannot go in at all.

## Exercise 3 of 4: one enzyme, why dephosphorylate (−P)

A vector cut with a single enzyme has two identical ends and can close on itself, which is the usual empty-vector background. A phosphatase takes the 5′ phosphates off, so it cannot.

1. Open `Insert-EcoRI-EcoRI.gb` (and the vector). On both, tick **EcoRI** only.

   > [!NOTE]
   > You see for the vector one fragment, **2,664 bp**, `EcoRI 5′ AATT` at both ends; for the insert the **801 bp** piece, EcoRI at both ends.

2. **Add** both, vector first.
3. On the Bench choose **Ligation**, and untick the insert so only the vector is in the reaction.

   > [!NOTE]
   > You see the closing junction **✓** and a product of **2,664 bp**: the vector closed on itself, with no insert.

4. Tick the insert again, and press **−P** on the vector's shelf row.
5. Untick the insert once more.

   > [!NOTE]
   > You see the vector alone say **both sides dephosphorylated**, and **Assemble** is off.

6. Tick the insert again.

   > [!NOTE]
   > You see the junctions **✓ ✓** (the insert still has its phosphates) and a product of **3,465 bp**, circular.

   > [!TIP]
   > Only the vector lost its phosphates, so the insert can still ligate into it but the vector cannot ligate to itself.

7. Press **⇄** on the insert.

   > [!NOTE]
   > You see the same 3,465 bp with `synthORF1` on the **reverse** strand (as shelved, it was on the **forward** strand).

   > [!TIP]
   > Orientation is not decided by the enzyme. On a bench you would screen for the right one.

Optional extra, a miniprep check digest: repeat the steps above without **−P** and, on the Bench, look at **Check by digest** under the 3,465 bp product, before **Assemble**. After **Assemble** the product opens with **EcoRI** ticked, two sites. The vector is the longest part, so it is the empty vector (cut once with EcoRI and closed on itself, 2,664 bp). The first rows: `EcoRI: 2,664 + 801 bp | empty 2,664 bp` and `SacI: 2,565 + 900 bp | empty 2,664 bp`. An insert-carrying colony shows the 801 bp band with EcoRI, an empty one only 2,664 bp, which is why −P matters.

## Exercise 4 of 4: a gene from NCBI, human insulin (INS)

Accession **`NM_000207`** (`NM_000207.3`, human insulin, mRNA, 465 bp; its CDS is 333 bp, the 110 residue preproinsulin plus the stop codon). It has no EcoRI or BamHI site in the CDS (checked), which is why EcoRI + BamHI will work.

1. Open `pLig-Vector.gb` and leave it in front.
2. Open the **Primers** tab (sidebar).
3. Switch the mode at the top to **Clone an insert into this plasmid**.

   > [!NOTE]
   > You see **Where on the vector**: with nothing selected, it takes the feature named `MCS`.

4. Under **What to insert** choose **Gene from NCBI…**, type `NM_000207` in the box and press **Add**. Only that accession is sent to NCBI.

   > [!NOTE]
   > You see the record open as a tab of its own, and its CDS becomes the insert: 333 bp, starting `ATGGCCCTGTGGATGCGC` and ending `...CTGGAGAACTACTGCAACTAG`. The workspace stays on the vector.

5. In **Enzymes** click the **EcoRI · BamHI** row. It is listed first, the other usable pairs after it. Leave **Padding** (6) and **Junction** at their defaults.
6. Click **Design primers**.

   > [!NOTE]
   > You see **PCR 357 bp**, one **caution** warning, and no red ones.

   The primers, written as ordered (tail in lower case):

   ```
   INS-F-EcoRI  5′ gttctggaattcATGGCCCTGTGGATGCGC 3′              (annealing part 18 nt, Tm 60.9 °C)
   INS-R-BamHI  5′ ctaataggatccCTAGTTGCAGTAGTTCTCCAGC 3′           (annealing part 22 nt, Tm 55.6 °C)
   ```

   > [!TIP]
   > The caution says no annealing part at the insert's ends meets the settings; nearest is "GC content above 65%": the start of the insulin CDS is GC rich. The reverse primer's annealing part includes the stop codon (`CTA` is the reverse complement of `TAG`).

7. Click **Simulate**. It runs PCR on the record, the EcoRI + BamHI digests and the ligation into the vector's backbone, and opens the product as a new document.

   - [ ] The product is **2,979 bp, circular**, with one EcoRI site just before the `ATG` and one BamHI site just after the stop codon.

8. Open the product's **Enzymes** tab.

   > [!NOTE]
   > You see **EcoRI** and **BamHI** ticked, the two enzymes the primers use, one site each. PstI does not cut this product at all.

   The product carries the vector's features and the record's annotation (`INS`, `insulin preproprotein`, `sig_peptide`, `proinsulin`, `insulin B chain`, `C-peptide` and the exons), plus the two primers as features, named after the record's feature (`insulin_preproprotein-F-EcoRI`); the primer names above are labels for this page.

Optional, a miniprep-style check: which single enzyme tells a colony that took the insert from one that did not. The enzyme with the clearest bands for this product is **MluI**, which cuts it **twice**: **2,414 + 565 bp** (the same ranking function the Bench's **Check by digest** uses). That panel is not on screen here: this product came from the primer workspace's **Simulate**, not from a Bench reaction. Use the product's own Enzymes tab:

1. Click **Hide all**, so EcoRI and BamHI stop counting in the digest.
2. **Cuts** is a remembered setting. If it says **Once**, MluI is not listed, because it cuts twice. Change it to **Twice**, **Once or twice**, **3 times or fewer** or **Any number**; **Filter** (the name box) narrows the list further, so type `MluI` there to find it quickly.
3. Tick **MluI**. **Fragments from ticked enzymes** reads `2,414, 565 bp`, two bands on the gel lane.

**Done when:**

- [ ] Exercise 1 gave a **3,441 bp** circular product (2,640 + 801) with no PstI site.
- [ ] Exercise 4 gave a **2,979 bp** circular product with one EcoRI and one BamHI site.

Next: [Golden Gate: one gene into one vector](golden-gate.md), or back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).

## How it works

Background: [Ligation](../guide/12-cloning.md#ligation), [The shelf](../guide/12-cloning.md#the-shelf) and [Digest](../guide/12-cloning.md#digest).
