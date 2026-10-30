# Golden Gate in PlasmidPop: one gene into an expression vector

- **You will end with:** a 3,239 bp circular plasmid with `synthGene` between the promoter and the terminator (path A), or a 2,870 bp one with the insulin gene (path B).
- **Time:** about 20 minutes.
- **Files:** [pGG-Expression.gb](files/pGG-Expression.gb), [GG-gene.gb](files/GG-gene.gb) (path A only).
- **Before this:** [Before you start](before-you-start.md) if the Bench or the sample files are new to you.

Before you click anything, close every tab you do not need: the Golden Gate simulation takes the other open tabs into the tube. Then choose one path. They are independent.

## Path A: a synthetic ORF

`GG-gene.gb` is a plain 702 bp open reading frame, `synthGene`, ATG to stop, with no BsaI site and no cloning ends.

1. Choose **File ▸ Open** and select `pGG-Expression.gb` and `GG-gene.gb` (or drag both onto the window).

   > [!WARNING]
   > If instead you see extra tabs, close them: the simulation would take them into the tube.

2. Click the **pGG-Expression** tab so it is in front.

3. Open the **Primers** tab in the sidebar and click **Design primers…**.
4. Under **Mode**, click **Clone an insert into this plasmid**.

5. In step 3 of the panel, next to **Ends**, click **Golden Gate part**.

   > [!NOTE]
   > You see `pGG-Expression is the destination · 2,857 bp`, and **Enzyme** stays **BsaI**.

6. In step 2 of the panel, **What to insert**, open **Feature in another tab…** and choose `synthGene (CDS)`.

   > [!NOTE]
   > You see `synthGene in GG-gene`, 702 bp.

7. Back in step 3, open **Overhangs** and choose **From pGG-Expression: AATG…GCTT**.

   > [!NOTE]
   > You see both overhang fields filled in.

   > [!TIP]
   > The vector's own cut ends say which overhangs the gene needs.

8. Leave **Include the start codon** ticked and tick **Include the stop codon**.

   > [!TIP]
   > Nothing is fused after this gene (the terminator follows), so the stop codon stays. It is off by default because tags usually follow in frame.

9. Click **Design primers**.

   > [!NOTE]
   > You see the part is **707 bp** and the **PCR product is 733 bp**.

10. Click **Simulate**.

    > [!NOTE]
    > You see `PCR 733 bp · part 707 bp · product 3,239 bp` and **No warnings**.

11. Look at the tab that opened, `pGG-Expression-synthGene`.

    > [!NOTE]
    > You see a **3,239 bp** **circular** product with `synthGene` and no `lacZ-dropout`.

    > [!WARNING]
    > If not, close any extra tab (the simulation takes other open tabs that BsaI cuts into the tube) and click **Simulate** again.

12. Open its **Enzymes** tab and look at **BsaI**.

    > [!NOTE]
    > You see **BsaI** ticked with **0 sites** (the vector had 2): the cut threw them away.

The product is a scratch document; use **File ▸ Save** if you want to keep it.

**Done when:**

- [ ] The product is **3,239 bp** and **circular**.
- [ ] `synthGene` sits between the promoter and the terminator, and there is no `lacZ-dropout`.

## Path B: a gene from NCBI (human insulin, NM_000207)

The record is third-party data, so you fetch it; nothing in this folder contains it. It needs a network connection, and only the accession you type leaves the browser.

1. Choose **File ▸ Open** and select `pGG-Expression.gb` only.

   > [!NOTE]
   > You see one tab, **pGG-Expression**.

   > [!WARNING]
   > If instead you see other tabs, close them: the vector is the destination and stays in front, and the simulation takes other tabs into the tube.

2. Open the **Primers** tab in the sidebar and click **Design primers…**.
3. Click **Mode: Clone an insert into this plasmid**.
4. In step 3 of the panel, next to **Ends**, click **Golden Gate part**.

5. In step 2 of the panel, **What to insert**, click **Gene from NCBI…**.
6. Type `NM_000207` and click **Add**. (This is the same search as **File ▸ Open from NCBI…**, with **Add** where that one says Open.)

   > [!NOTE]
   > You see `insulin preproprotein` in the new tab, **333 bp**.

7. In step 3, open **Overhangs** and choose **From pGG-Expression: AATG…GCTT**.
8. Leave **Include the start codon** ticked and tick **Include the stop codon**.

   > [!NOTE]
   > You see the part is **338 bp** and the **PCR product is 364 bp**.

9. Click **Design primers**.

   > [!NOTE]
   > You see one amber caution: `GC content above 65%`.

   > [!TIP]
   > The amber GC caution is expected here (the gene's ends are GC-rich), and **Simulate** still works.

10. Click **Simulate**.

    > [!NOTE]
    > You see a new tab, `pGG-Expression-insulin preproprotein`, a **2,870 bp** **circular** product.

    > [!WARNING]
    > If not, close any extra tab (the simulation takes other open tabs that BsaI cuts into the tube) and click **Simulate** again.

11. Open the **Enzymes** tab of the new tab.

    > [!NOTE]
    > You see **BsaI** ticked, with **0 sites** in the product.

**Done when:**

- [ ] The product is **2,870 bp** and **circular**.
- [ ] The features are `KanR`, `ori`, `synthetic promoter`, `INS` with the insulin chain features and `synthetic terminator`, and there is no `lacZ-dropout`.

> [!TIP]
> **Two things on the map look odd and are right.** The base just before the start codon is a capital `A` that is not in the NCBI record: the overhang is `AATG`, and its `ATG` is the gene's own start codon, so the primer adds only the first `A`. That is why the promoter runs straight into the start codon. After the stop codon come the four overhang bases `GCTT`, then the terminator, so there is a four-base gap there and none on the promoter side. The `INS` gene feature, the first `exon` and the forward primer feature start on that `A`, because the part's edge cuts them off; the CDS and the peptides start on the `ATG`.

The oligos depend on the padding setting and on the annealing lengths the designer picks, so they are not written out. What does not depend on them is the part and the product length.

## Next

[Four parts and the warnings](golden-gate-parts.md) puts four parts in one tube in a scrambled tab order (**3,118 bp**, with a check digest, and an NCBI version), and [Exercise 2, seeing the warnings](golden-gate-parts.md#exercise-2-of-3-seeing-the-warnings) shows three broken designs: a BsaI site inside a part, two parts that offer the same overhang, and two overhangs one base apart.

## How it works

- **Type IIS enzyme** (BsaI here): cuts a short distance _beside_ its recognition site, so the site is thrown away with the cut-off end.
- **Overhang**: the 4 single-stranded bases a cut leaves. Two ends join only when their overhangs match, so overhangs decide what goes where.
- **Dropout**: the stretch of the vector that the cut removes, with its two BsaI sites. The gene takes its place.
- **Part**: a piece with an overhang at each end, ready to go into a slot. Here the gene is the part, and its primers add the sites and overhangs.

`pGG-Expression.gb` is a circular 2,857 bp vector that already has a promoter and a terminator. Between them sit two BsaI sites around a `lacZ-dropout`. Cut with BsaI, the vector's backbone ends in `AATG` (after the promoter) and `GCTT` (before the terminator), which is the pair a MoClo plant CDS part uses. Your gene needs `AATG` before it and `GCTT` after it. PlasmidPop designs the two PCR primers that put them there, then simulates the reaction. You never type a sequence.

Every file is a **synthetic example** (invented sequence), and every number above is checked by `src/core/cloning/goldenGateTutorial.test.ts`, which runs these same files through the functions the app uses.

Background: [Golden Gate](../guide/12-cloning.md#golden-gate) on the Bench, and [Golden Gate ends](../guide/10-primers.md#golden-gate-ends-primers-that-make-the-insert-a-part) in the primer workspace.

Back to the [tutorials index](README.md).
