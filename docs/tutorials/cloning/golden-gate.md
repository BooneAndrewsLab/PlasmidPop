# Golden Gate in PlasmidPop: start here

A first run, about eight steps: put one gene into an expression vector in one
reaction. Files are in this folder, and every one is a **synthetic example**
(invented sequence). Every number below is checked by
`src/core/cloning/goldenGateTutorial.test.ts`, which runs these same files
through the functions the app uses, so the page cannot drift from the app
without the build failing.

> **Four words**
>
> - **Type IIS enzyme** (BsaI here): cuts a short distance _beside_ its
>   recognition site, so the site is thrown away with the cut-off end.
> - **Overhang**: the 4 single-stranded bases a cut leaves. Two ends join only
>   when their overhangs match, so overhangs decide what goes where.
> - **Dropout**: the stretch of the vector that the cut removes, with its two
>   BsaI sites. The gene takes its place.
> - **Part**: a piece with an overhang at each end, ready to go into a slot. Here
>   the gene is the part, and its primers add the sites and overhangs.

## The vector, and what the app does

`pGG-Expression.gb` is a circular 2,857 bp vector that already has a promoter
and a terminator. Between them sit two BsaI sites around a `lacZ-dropout`.
Cut with BsaI, the vector's backbone ends in `AATG` (after the promoter) and
`GCTT` (before the terminator), which is the pair a MoClo plant CDS part uses.
Your gene needs `AATG` before it and `GCTT` after it. PlasmidPop designs the
two PCR primers that put them there, then simulates the reaction. You never
type a sequence.

Before you start, close every tab you do not need: the Golden Gate
simulation takes the other open tabs into the tube.

## Tutorial 1: one gene into an expression vector

Choose one path. They are independent.

### Path A: a synthetic ORF

`GG-gene.gb` is a plain 702 bp open reading frame, `synthGene`, ATG to stop,
with no BsaI site and no cloning ends.

1. **File ▸ Open**, select `pGG-Expression.gb` and `GG-gene.gb` (or drag both
   onto the window). Click the **pGG-Expression** tab so it is in front.
   _Why: the primer workspace designs against the document in front, the
   destination._
2. Open the primer workspace: **Primers ▸ Design**. Under **Mode**, click
   **Clone an insert into this plasmid**.
   _Why: this is the mode that designs primers for an insert from another tab._
3. In step 3, **Ends**, click **Golden Gate part**. Step 1 now reads
   `pGG-Expression is the destination · 2,857 bp`, its backbone is 2,536 bp and
   asks for `AATG…GCTT`. **Enzyme** stays **BsaI**, and the note beside it reads
   `GGTCTC then 1 base and a 4-base 5′ overhang`.
   _Why: the vector's own cut ends say which overhangs the gene needs._
4. In step 2, **What to insert**, open **Feature in another tab…** and choose
   `synthGene (CDS)`. The line below reads `synthGene in GG-gene`, 702 bp.
   _Why: the CDS is the part of the file to amplify._
5. Back in step 3, open **Overhangs** and choose
   **From pGG-Expression: AATG…GCTT**. Both overhang fields fill in. Leave
   **Include the start codon** ticked and **tick Include the stop codon**.
   _Why: nothing is fused after this gene (the terminator follows), so the stop
   codon stays; it is off by default because tags usually follow in frame._
6. Read the note under the fields: the part is **707 bp**, `AATG` (its last 3
   bases are the part's own start codon, so the primer anneals from the base
   after it) … `GCTT`, and the **PCR product is 733 bp**. Click **Design
   primers**.
   _Why: this is the design as it would be made, before any oligo exists._
7. The workspace goes to **Results**: **BsaI part AATG…GCTT**, `PCR 733 bp ·
part 707 bp · product 3,239 bp`, the two oligos with padding, site, spacer and
   overhang told apart from the annealing part, and **No warnings**. Click
   **Simulate**.
   _Why: it runs the PCR on the GG-gene tab, then the BsaI Golden Gate into the
   vector, and opens the result._
8. A new tab opens, `pGG-Expression-synthGene`. Open its **Enzymes** tab and its
   **Features** tab and tick through the checklist.
   _Why: the product is a scratch document; **File ▸ Save** if you want to keep
   it._

**Did it work?**

- [ ] Product **3,239 bp**, **circular**.
- [ ] Features: `KanR`, `ori`, `synthetic promoter`, `synthGene`,
      `synthetic terminator`, and **no** `lacZ-dropout`.
- [ ] **BsaI** is ticked in the Enzymes tab (the reaction's enzyme).
- [ ] BsaI has **0 sites** in the product (the vector had 2): nothing is marked,
      because the cut threw the sites away.
- [ ] `synthGene` runs from the promoter's `AATG` to its own stop, then
      `GCTT`, then the terminator: one open reading frame of 233 residues.

### Path B: a gene from NCBI (human insulin, NM_000207)

The record is third-party data, so you fetch it; nothing in this folder
contains it. It needs a network connection, and only the accession you type
leaves the browser.

1. **File ▸ Open**, select `pGG-Expression.gb` only. Close any other tab.
   _Why: it is the destination, and it stays in front._
2. **Primers ▸ Design**, **Mode: Clone an insert into this plasmid**.
3. In step 3, **Ends**, click **Golden Gate part**. **Enzyme** stays **BsaI**.
4. In step 2, **What to insert**, click **Gene from NCBI…**, type `NM_000207`
   and click **Add**. (This is the same search as **File ▸ Open from NCBI…**,
   with **Add** where that one says Open.) The record opens as a tab of its own
   and the workspace stays on the vector. The insert line reads
   `insulin preproprotein` in the new tab, **333 bp**.
   _Why: the CDS becomes the insert; a gene off NCBI has no BsaI site and no
   cloning ends, so the primers add them._
5. In step 3 open **Overhangs** and choose **From pGG-Expression: AATG…GCTT**.
   Leave **Include the start codon** ticked and **tick Include the stop
   codon**.
6. The note reads: the part is **338 bp**, **PCR product 364 bp**. Click
   **Design primers**. Results shows one amber caution about the annealing
   parts (the gene's ends are GC-rich: `GC content above 65%`); that is
   expected here, and **Simulate** still works. Click **Simulate**.
7. A new tab opens, `pGG-Expression-insulin preproprotein`. Check it.

**Did it work?**

- [ ] Product **2,870 bp**, **circular**.
- [ ] Features: `KanR`, `ori`, `synthetic promoter`, `INS` with the insulin
      chain features, `synthetic terminator`, and **no** `lacZ-dropout`.
- [ ] **BsaI** is ticked in the Enzymes tab, with **0 sites** in the product.
- [ ] Translating from the insulin start codon reads
      `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*`:
      preproinsulin, one frame, one stop, then `GCTT`.

**Two things on the map that look odd and are right.** The base just before
the start codon is a capital `A` that is not in the NCBI record: the overhang
is `AATG`, and its `ATG` is the gene's own start codon, so the primer adds only
the first `A`. That is why the promoter runs straight into the start codon.
After the stop codon come the four overhang bases `GCTT`, then the
terminator, so there is a four-base gap there and none on the promoter side.
The `INS` gene feature, the first `exon` and the forward primer feature start
on that `A`, because the part's edge cuts them off; the CDS and the peptides
start on the `ATG`.

(The oligos depend on the padding setting and on the annealing lengths the
designer picks, so they are not written out. What does not depend on them is
the part and the product length.)

## Tutorial 2 (optional): several parts in one tube

Real constructs are often built from a promoter, a coding part, a tag and a
terminator at once. The four-part exercise in the
[README](README.md#golden-gate-four-parts-in-one-tube) opens four part files
and a destination in a scrambled tab order, and shows that the overhangs, not
the tab order, decide the assembly: **3,118 bp**, with a check digest. It also
has an NCBI version, where the gene replaces one of the parts.

## Tutorial 3 (optional): what a bad design looks like

[Seeing the warnings](README.md#seeing-the-warnings) in the README shows
three broken designs: a BsaI site inside a part, two parts that offer the
same overhang, and two overhangs one base apart. Each one tells you what is
wrong, in the panel's own words, before you order anything.

## Background

[Golden Gate](../../guide/12-cloning.md#golden-gate) on the Bench, and
[Golden Gate ends](../../guide/10-primers.md#golden-gate-ends-primers-that-make-the-insert-a-part)
in the primer workspace.
