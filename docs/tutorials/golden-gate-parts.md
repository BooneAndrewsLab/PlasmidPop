# Golden Gate: four parts and the warnings (Tutorials 2 and 3)

- **You will end with:** a 3,118 bp circular plasmid with promoter, coding part, tag and terminator in one tube, then three broken designs and what the panel says about each.
- **Time:** about 30 minutes.
- **Files:** [pGG-Destination.gb](files/pGG-Destination.gb), [GG-prom.gb](files/GG-prom.gb), [GG-cds.gb](files/GG-cds.gb), [GG-tag.gb](files/GG-tag.gb), [GG-term.gb](files/GG-term.gb), [GG-broken-internal-BsaI.gb](files/GG-broken-internal-BsaI.gb), [GG-broken-duplicate-overhang.gb](files/GG-broken-duplicate-overhang.gb), [GG-warn-tag.gb](files/GG-warn-tag.gb), [GG-warn-terminator.gb](files/GG-warn-terminator.gb). The insulin gene (`NM_000207`) is fetched in the app.
- **Before this:** [Golden Gate: one gene into one vector](golden-gate.md), and [Before you start](before-you-start.md) if the sample files are new to you.

**The overhangs, not the tab order, decide the order.** You open the files in a scrambled order on purpose.

## Exercise 1 of 3: four parts in one tube

1. Choose **File ▸ Open** and select, in this order: `GG-tag.gb`, `GG-prom.gb`, `GG-term.gb`, `pGG-Destination.gb`, `GG-cds.gb`.

2. Close any other tab.

   > [!WARNING]
   > If instead you see extra tabs left open, close them: every open document goes into the tube.

3. Click the **Bench** tab, then **Golden Gate**.

4. Set **Enzyme** to **BsaI** (the default) and leave no second enzyme.

   > [!NOTE]
   > You see every open document in the tube, each listed with its tab, none unticked.

5. Read the order the panel found.

   > [!NOTE]
   > You see `pGG-Destination`, `GG-Part1-Promoter`, `GG-Part2-CDS`, `GG-Part3-Tag`, `GG-Part4-Terminator`, joining on `GGAG`, `AATG`, `TTCG`, `GCTT`, `CGCT`, and nothing says **(flipped)**.

   > [!TIP]
   > The panel starts the circle at whichever document is first in the tube, so it may begin at a different part; the cyclic order is the same.

6. Expand **9 pieces left out**.

   > [!NOTE]
   > You see the vector's 321 bp dropout and each part's two flanks, each "still carries the BsaI site, so the reaction cuts it again".

7. Optional check by digest, before you assemble: read the digest rows on the Bench. The empty vector is the longest part, the uncut destination, 2,647 bp (**Against** picks another).

   > [!NOTE]
   > You see `AseI: 2,583 + 535 bp | empty 2,647 bp` and `DraI: 1,953 + 1,165 bp | empty 2,647 bp` as the first rows, with the bundled enzyme set.

   > [!TIP]
   > This is the Golden Gate miniprep: an insert-carrying clone gives the two product bands, a clone that kept the dropout (the empty vector) gives one.

8. Read the **Product** line.

   > [!NOTE]
   > You see **3,118 bp, circular**, and **no overhang warnings**.

9. Click **Assemble**.

   **Checkpoint:**
   - [ ] The product is 3,118 bp (the 2,326 bp backbone + 84 + 601 + 33 + 74 bp of parts), circular, with `KanR`, `ori`, `synthetic promoter`, `synthCDS`, `synthTag`, `synthetic terminator`, no `lacZ-dropout` and no BsaI site.

   > [!WARNING]
   > If not, compare the order and overhangs with step 5, and check that nothing else is open and **Enzyme** is **BsaI**.

10. In the product, open the **Enzymes** tab.

    > [!NOTE]
    > You see **BsaI** ticked, the Bench's enzyme, but nothing marked because no site is left (a second enzyme set on the Bench would be ticked too).

11. Optional: translate from the ATG of `synthCDS` (the sidebar's **Translate** tab). The result is one open reading frame running from the CDS straight into `synthTag` in the same frame, ending `...FGGSGGHHHH*`.

## Exercise 2 of 3: seeing the warnings

Keep the vector, parts 1 and 2 (`GG-prom.gb`, `GG-cds.gb`) open, and close the original part 3 and part 4 (`GG-tag.gb`, `GG-term.gb`).

### An internal BsaI site

1. Open `GG-broken-internal-BsaI.gb` in place of part 3, and `GG-term.gb` as part 4.

   > [!NOTE]
   > You see **No part starts with the overhang BsaI 5′ TTCG left by GG-Part2-CDS. 2 of 5 parts were never reached.** and **Assemble** is off.

   > [!TIP]
   > BsaI cuts that part in three. The middle piece is useful, but the pieces that still carry a site are cut again, and the overhang the CDS hands on, `TTCG`, now has no part to start from. A site inside a part always breaks it.

### A duplicate overhang

2. Open `GG-broken-duplicate-overhang.gb` in place of part 3 (with `GG-term.gb`).

   > [!NOTE]
   > You see **No part starts with the overhang BsaI 5′ AATG left by GG-Broken-Tag-DuplicateOverhang.**

   > [!TIP]
   > Its right overhang `AATG` is the one the CDS already starts on. Golden Gate needs every overhang distinct: two parts offering the same overhang give an ambiguous, unusable design, and the panel refuses to guess.

### A near-miss warning that still assembles

3. Open `GG-warn-tag.gb` and `GG-warn-terminator.gb` as parts 3 and 4 (with parts 1 and 2 and the vector).

   > [!NOTE]
   > You see **3,118 bp** and the warning **AATG and AATC differ at one base, so a ligase may join one in place of the other.**

   > [!TIP]
   > A warning means the product shown is the one the design intends and **Assemble** still works, but in the tube the ligase can pair `AATG` with `AATC` and make other products. A designer swaps one of the overhangs.

**Checkpoint:**

- [ ] Two designs refused (no **Assemble**) and one assembling at 3,118 bp with a warning.

## Exercise 3 of 3: four parts with a gene from NCBI, human insulin (INS)

The gene replaces `GG-cds` (`AATG` ... `TTCG`), with no stop codon of its own so that the tag follows in frame. The insulin CDS is 110 codons plus a stop, so the stop is left out, and the 330 bp that remain are a whole number of codons. The primer workspace designs the two oligos for that; nothing is typed by hand.

The layout of a Golden Gate primer, which the workspace follows:

`5′ - padding - BsaI site - 1 spacer base - 4-nt overhang - gene-specific 3′ end - 3′`

1. Choose **File ▸ Open** and select `pGG-Destination.gb`, `GG-prom.gb`, `GG-tag.gb` and `GG-term.gb`, and close every other tab, including `GG-cds` and the `GG-warn` files left from Exercise 2.

2. Click the **pGG-Destination** tab so it is in front: it is the destination, and the workspace designs against the document in front.

3. Choose **Primers ▸ Design** (the primer workspace).

4. Under **Mode**, click **Clone an insert into this plasmid**.

5. In step 2 of the panel, **What to insert**, click **Gene from NCBI…**, type `NM_000207` and click **Add**.

   > [!NOTE]
   > You see the record open as a tab of its own, with its CDS as the insert: 333 bp, named `insulin preproprotein`, while the workspace stays on the destination.

   > [!TIP]
   > The insert is named after the CDS's `/product`, as in the ligation exercise.

6. In step 3 of the panel, next to **Ends**, click **Golden Gate part**.

   > [!NOTE]
   > You see **Enzyme: BsaI** (the default) and the note `GGTCTC then 1 base and a 4-base 5′ overhang`, from the enzyme table.

7. Leave **and** at _no other_.

8. Under **Overhangs**, type `AATG` on the left and `TTCG` on the right.

   > [!TIP]
   > The picker's **From pGG-Destination: GGAG…CGCT** is the pair for a part filling the whole dropout; here the CDS sits between the promoter and the tag, so it takes their junctions instead.

9. Leave **Include the start codon** ticked and **Include the stop codon** unticked.

   > [!TIP]
   > The stop codon is left out so the tag continues the reading frame.

   > [!NOTE]
   > You see under the fields: the part is **335 bp**, **330 coding bases** to the right overhang, and a **PCR product of 361 bp**.

10. Click **Design primers**.

    > [!NOTE]
    > You see one part, `BsaI part AATG…TTCG`, and one amber warning about the annealing parts (the gene's ends are GC-rich).

    The note under the overhang fields described the part as `AATG` (its last 3 bases are the part's own start codon, so the primer anneals from the base after it) … `TTCG`. Both oligos show their padding, site, spacer and overhang told apart from the annealing part. The tube line on the Design page names the destination, the promoter, the tag and the terminator; the INS record has no BsaI site, so it is not in it.

11. Back in the primer workspace, click **Simulate**.

    > [!NOTE]
    > You see the product open as `pGG-Destination-insulin preproprotein`, **2,848 bp**, circular.

    **Checkpoint:**
    - [ ] The product is 2,848 bp, circular, with `KanR`, `ori`, `synthetic promoter`, `INS` and the insulin chain features, `synthTag`, `synthetic terminator`, and **BsaI** ticked in its **Enzymes** tab.

    > [!WARNING]
    > If not, check that the destination was in front when you chose **Primers ▸ Design** (the workspace designs against the document in front) and that **Include the stop codon** is unticked.

12. Optional: translate from the INS start codon (the sidebar's **Translate** tab). The result is `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCNFGGSGGHHHH*`: preproinsulin, then the linker and His tag from the tag part, one frame, one stop.

The PCR runs on the INS tab and the Golden Gate on the five parts. The product and the primers are named after that CDS feature, so the tab is `pGG-Destination-insulin preproprotein` and **Save both** keeps `insulin_preproprotein-F-BsaI` and `-R-BsaI`.

**Done when:**

- [ ] Exercise 1 gave 3,118 bp, circular, in any tab order.
- [ ] Exercise 3 gave 2,848 bp, circular, with `INS` between `synthetic promoter` and `synthTag`.

Next: back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).

## How it works

Background: [Golden Gate](../guide/12-cloning.md#golden-gate).

BsaI cuts `GGTCTC` and leaves a 4-base overhang one base beyond the site on the far side. In every part (`GG-prom.gb` to `GG-term.gb`) the two sites point inwards, so cutting throws the sites and the flanks away. In the destination vector the two sites sit _inside_ the `lacZ-dropout` and point out towards the backbone, so cutting throws away the dropout and its sites and keeps the rest. The backbone's two ends are `CGCT` and `GGAG`; the parts carry `GGAG`→`AATG`, `AATG`→`TTCG`, `TTCG`→`GCTT`, `GCTT`→`CGCT`. Five distinct overhangs, none palindromic, none one base from another, so nothing can join the wrong ends.

The oligos themselves depend on the padding setting (6 bases by default, which is what NEB advises for an enzyme its cleavage-near-the-end chart does not rate) and on the annealing lengths the designer picks, so they are not written out here. What does not depend on them is the part, 335 bp between `AATG` and `TTCG`, and the 2,848 bp product.

These NCBI results were verified against a local copy of the record kept under the gitignored `fixtures/local/ncbi/NM_000207.gb`; the test skips cleanly when that file is absent.
