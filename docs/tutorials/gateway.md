# Gateway cloning: a BP reaction, then an LR reaction

- **You will end with:** a 1,412 bp circular entry clone (BP), then a 1,551 bp circular expression clone (LR) with the gene between `attB1` and `attB2`.
- **Time:** about 25 minutes.
- **Files:** [GW-Insert.gb](files/GW-Insert.gb), [GW-pDONR.gb](files/GW-pDONR.gb), [GW-pDEST.gb](files/GW-pDEST.gb), [GW-bad-pDEST.gb](files/GW-bad-pDEST.gb) (exercise 3 only).
- **Before this:** nothing; [Before you start](before-you-start.md) if the Bench or the sample files are new to you.

Before you click anything, close every tab you do not need. The att sites in these files are invented: see [How it works](#how-it-works).

## Exercise 1 of 3: the BP reaction, an insert into a donor vector

1. Choose **File ▸ Open** and select `GW-Insert.gb`, `GW-pDONR.gb` and `GW-pDEST.gb` (or drag them onto the window). Each opens in its own tab.

   > [!WARNING]
   > If instead you see other tabs, close them: the panel takes its molecules from the open tabs.

2. Click the `GW-Insert` tab.

3. Open its **Features** tab.

   > [!NOTE]
   > You see `attB1` and `attB2` in the list, one on either side of `synthGene`.

4. Click the `GW-pDONR` tab and open its **Features** tab.

   > [!NOTE]
   > You see `attP1` and `attP2` in its **Features** list, on either side of `ccdB`.

5. Click the **Bench** tab.

6. Click **Gateway** at the top of the middle column.

   > [!NOTE]
   > You see the heading **Gateway**, with `att sites, no enzyme` beside it. The panel opens on **LR**.

7. Click **BP**.

   > [!NOTE]
   > You see **Choose the attB substrate and the donor vector. A BP needs two attB sites on the first and two attP sites on the second.**

8. Open the **attB substrate** list.

   > [!NOTE]
   > You see each tab listed with the sites it annotates: `GW-Insert — attB1, attB2`, `GW-pDONR — attP1, attP2` and `GW-pDEST — attR1, attR2`.

9. Choose `GW-Insert` as the **attB substrate**.

10. Choose `GW-pDONR` as the **donor vector**.

    > [!NOTE]
    > You see **Entry clone:** appear, with **Product: 1,412 bp, circular · synthGene, KanR, ori, attL1, attL2**, and the only warning: **The ccdB cassette of GW-pDONR leaves on the byproduct, so an entry clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.**

    > [!TIP]
    > The cassette is not in the clone, so a strain that ccdB kills grows the clone and not the donor you started with.

    > [!NOTE]
    > You see **Open clone** and no **Open byproduct**: a linear substrate has no circle to leave behind.

    > [!TIP]
    > The clone is smaller than the donor with an insert added: 1,390 + 422 = 1,812, and the clone is 1,412, because the cassette and the flanks left. Nothing was cut and nothing was joined: the two sites on each molecule swapped the DNA between them.

11. Click **Open clone**.

    > [!NOTE]
    > You see a new tab, `GW-Insert × GW-pDONR BP`, with the **Features** tab in front. Find `synthGene`, `KanR`, `ori`, `attL1` and `attL2`, each once, and no `ccdB`.
    - [ ] The new tab is **1,412 bp**, **circular**.

    > [!WARNING]
    > If not, check that **attB substrate** is `GW-Insert` and **donor vector** is `GW-pDONR`.

    > [!TIP]
    > `attL1` starts at base 1,386 and runs 13 bases past the end of the sequence, onto base 1, so the Features tab lists `attL2` before `attL1` (and the pickers say `attL2, attL1`). The recombination did not know where the circle starts; the document is the same circle however it is rotated.

    The clone is a scratch document: **File ▸ Save** if you want to keep it. It remembers how it was made, which the **History** tab's **Made from** shows. Leave it open for the next exercise.

## Exercise 2 of 3: the LR reaction, an entry clone into a destination vector

1. Click the **Bench** tab.

2. Click **Gateway**, then click **LR**.

3. Open the **entry clone** list.

   > [!NOTE]
   > You see the four open tabs with their sites, including `GW-Insert × GW-pDONR BP — attL2, attL1`, and `GW-pDEST — attR1, attR2`.

4. Choose `GW-Insert × GW-pDONR BP` as the **entry clone**.

5. Choose `GW-pDEST` as the **destination vector**.

   > [!NOTE]
   > You see **Expression clone:** appear, with **Product: 1,551 bp, circular · synthGene, synthetic promoter, synthetic terminator, AmpR, ori, attB1, +1 more**.

   > [!NOTE]
   > You also see the warning **The ccdB cassette of GW-pDEST leaves on the byproduct, so an expression clone that grows in an ordinary strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.** and two buttons, **Open clone** and **Open byproduct**.

   > [!TIP]
   > The panel matched attL1 with attR1 and attL2 with attR2 by number, found the 15 bp core of each pair, and swapped the stretch between the sites. The entry clone is a circle, so both circles of the exchange exist.

6. Click **Open byproduct**.

   > [!NOTE]
   > You see a new tab, `GW-Insert × GW-pDONR BP × GW-pDEST LR byproduct`, 1,698 bp, with `ccdB`, `CmR`, `KanR`, `ori`, `attP1` and `attP2`.

7. Click the **Bench** tab.

8. Click **Open clone**.

   > [!NOTE]
   > You see a new tab, `GW-Insert × GW-pDONR BP × GW-pDEST LR`, 1,551 bp, with the **Features** tab in front.
   - [ ] The clone is **1,551 bp** and the byproduct **1,698 bp**, both **circular**.

   > [!WARNING]
   > If not, check that **entry clone** is `GW-Insert × GW-pDONR BP` and **destination vector** is `GW-pDEST`.

9. In the clone's **Features** tab, find `attB1`, `attB2`, the promoter, the terminator and `AmpR`.

   > [!NOTE]
   > You see `attB1` at 25 bp (bases 1,540 to 1,551 and, past the origin, 1 to 13), and `synthGene` at 20 to 379, 360 bp, ATG to a stop, in one piece.

   > [!TIP]
   > LR makes attB, the same kind of site the PCR product started with, and the gene went through two reactions without a base changed.

   The clone and the byproduct are scratch documents; the clone is the one to keep.

## Exercise 3 of 3: what a bad design looks like

Two ways for a reaction to fail before it starts. `GW-bad-pDEST.gb` is `GW-pDEST` with the second site named `attR3`, a core that nothing in the insert shares.

1. Choose **File ▸ Open** and select `GW-bad-pDEST.gb`.

2. Click the **Bench** tab.

3. Click **Gateway**, then click **LR**.

4. Choose `GW-Insert × GW-pDONR BP` as the **entry clone**.

5. Choose `GW-bad-pDEST` as the **destination vector**.

   > [!NOTE]
   > You see, in red, **The sites do not pair: GW-Insert × GW-pDONR BP has attL1 and attL2, GW-bad-pDEST has attR1 and attR3. Each number recombines only with its own.** There is no product line and no **Open clone**.

   > [!TIP]
   > `attL2` has no `attR2` to meet. The panel does not guess that attR3 is close enough; in the lab it would simply not recombine. This is what you have if you pick the wrong destination from a catalogue.

6. Choose `GW-Insert` as the **entry clone** instead, and `GW-pDEST` as the **destination vector**.

   > [!NOTE]
   > You see **GW-Insert has no attL site annotated. A LR needs two, flanking the DNA to move; annotate them, or open a file that does.**

   > [!TIP]
   > The PCR product has attB sites, and an LR starts from attL. This is the usual mistake of leaving out the BP, or of opening the wrong tab.

7. Click **BP**.

8. Choose `GW-Insert` as the **attB substrate**, and `GW-pDEST` as the **donor vector**.

   > [!NOTE]
   > You see **GW-pDEST has no attP site annotated. A BP needs two, flanking the cassette they replace.**

   > [!TIP]
   > A destination vector has attR sites, so it is not a donor; the panel says which kind it was looking for.

9. Choose `GW-pDONR` as the **donor vector** again.

   > [!NOTE]
   > You see the BP is back.

**Done when:**

- [ ] The entry clone is **1,412 bp**, **circular**, with `attL1` and `attL2` and no `ccdB`.
- [ ] The expression clone is **1,551 bp**, **circular**, with `AmpR`, `attB1` and `attB2` and no `KanR`, `CmR` or `ccdB` (the byproduct has all three of those and no `AmpR`).

## How it works

**The att sites in these files are invented.** PlasmidPop carries no att sequences: it reads the sites a file annotates (`attB1`, `attP2`, `attL1`, `attR2` and so on) and pairs them by number. Here each site is a 15 base core with a short arm on each side, so the sizes (25, 55 and 40 bp) are not those of the real sites, and none of the sequence is. With a real donor, entry or destination vector, which labels its own sites, the steps are the same. The app does not design primers that add attB sites to a PCR product, so the insert here is supplied as the product, with its attB sites already annotated; in the lab you would put the attB tails on the primers yourself. A plasmid that does not label its sites gets a message, not a guess. All four files are synthetic examples.

The seven words of this page:

- **att site**: a short stretch where the integrase swaps DNA. There are four kinds, **attB**, **attP**, **attL** and **attR**, and each carries a number (`attB1`, `attB2`).
- **Core**: the bases two partner sites share. The panel finds the core itself (the longest stretch the two sites have in common) and crosses over in its middle. Here it is 15 bp.
- **BP reaction**: attB substrate × donor vector (attP) gives an **entry clone** (attL) and a byproduct (attR).
- **LR reaction**: entry clone (attL) × destination vector (attR) gives an **expression clone** (attB) and a byproduct (attP).
- **Numbers pair**: `attB1` recombines only with `attP1`, `attL1` only with `attR1`. The two numbers on a molecule are what give the insert its direction.
- **ccdB cassette**: a gene that kills an ordinary _E. coli_ strain. It sits between the two sites of a donor and of a destination vector, so it leaves with the byproduct and the clone you want is the one that grows.
- **Selection marker**: each vector carries one for its backbone. In a BP the clone keeps the donor's, in an LR the destination's, and the other comes away on the byproduct.

The four files:

| File           | Length   | What it is                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `GW-Insert`    | 422 bp   | Linear: `attB1` (1–25), `synthGene` (32–391, 120 codons), `attB2` (398–422)    |
| `GW-pDONR`     | 1,390 bp | Circular: `attP1`, `ccdB`, `attP2`, then `KanR` and `ori` stand-ins            |
| `GW-pDEST`     | 1,837 bp | Circular: promoter, `attR1`, `ccdB`, `CmR`, `attR2`, terminator, `AmpR`, `ori` |
| `GW-bad-pDEST` | 1,837 bp | `GW-pDEST` with `attR3` where `attR2` was: used for the design that fails      |

`GW-Insert` is a PCR product, so it is linear. The donor and the destination carry the ccdB stand-in between their sites; the destination's cassette also carries a `CmR` stand-in, as real destination vectors do. You never type a sequence.

The sums of exercise 1: the insert contributes 397 bp (422 less 12 bp before its `attB1` crossover and 13 bp after its `attB2` one); the donor contributes its backbone, 1,015 bp (1,390 less the 375 bp cassette). 397 + 1,015 = 1,412. The 400 bp that are not in the clone are the 375 bp cassette and the 25 bp of the substrate's flanks. A linear substrate has no circle to leave behind: its two ends come away as loose pieces, and the panel does not make a document of them. The warning talks about a byproduct the panel did not give you: it says where the cassette went, whether or not the reaction made a document of it.

What the exercise 1 clone holds, beyond what the steps showed:

- `attL1` and `attL2` are **40 bp** each: half of an attB's bases and half of an attP's. They are different sequences (their cores differ), which is what keeps the insert's direction.
- The gene is whole, **360 bp**, `synthGene` at 20–379, between the two sites: `attL2` follows it at 386–425, and 6 bp separate `attL1` from it.
- `KanR` (the donor's marker) is on the clone, on the reverse strand as in the donor.

The sums of exercise 2: 1,412 + 1,837 = 3,249, and 1,551 + 1,698 = 3,249. Every base that went into the reaction is in one circle or the other; a recombination exchanges DNA and loses none, unlike a digest and a ligation, and if the two sizes do not add up, something else was open. The clone is the entry clone's 397 bp between its sites plus the destination's 1,154 bp outside its cassette (1,837 less 683); the byproduct is that 683 bp cassette plus the entry clone's 1,015 bp backbone. The destination loses the 683 bp between the middles of its two cores (`ccdB`, `CmR` and the spacers) and gains the 397 bp of the entry clone's insert piece, while the entry clone's backbone, with `KanR` and the origin, goes the other way onto the byproduct.

What the exercise 2 products hold:

- `attB1` and `attB2` are **25 bp** each, the very bases the PCR product had. The byproduct's `attP1` and `attP2` are **55 bp**, the very bases the donor had.
- `synthGene` is whole (360 bp), with **6 bp** between `attB1` and its ATG, and **12 bp** between `attB2` and the terminator.
- The clone's features are `synthGene`, `synthetic promoter`, `synthetic terminator`, `AmpR`, `ori`, `attB1` and `attB2`, each once. The byproduct's are `ccdB`, `CmR`, `KanR`, `ori`, `attP1` and `attP2`. The markers are the swap the selection uses: ampicillin for the clone, and the ccdB and chloramphenicol genes on the circle that does not grow.
- Each new site is half of each parent's: an attB is half of an attL and half of an attR, which is why the numbers and not the names say what pairs. The Product line lists `synthGene` first, before the promoter, because the document starts where the crossover wrote it; along the circle the order is promoter, `attB1`, `synthGene`, `attB2`, terminator.

PlasmidPop reads the att sites from the annotation and carries no att sequences, and it does not design attB primers or annotate a PCR product's attB tails. To use your own gene, make the PCR product in the lab (or add the attB sites to the sequence yourself) and annotate its two sites `attB1` and `attB2`; see [Features](../guide/05-features.md). There is no NCBI gene path in this tutorial: a gene from NCBI would need those sites added by hand first, and nothing in these pages contains a third-party record.

## Next

[Gateway](../guide/12-cloning.md#gateway) on the Bench in the user guide also covers a vector annotated on the other strand, the check against a ccdB gene on the wrong circle, the frame warning for a tag in the backbone, and why a multisite reaction is done a fragment at a time. The design note is item 48 (`docs/design/48-gateway.md`). Back to the [tutorials index](README.md).
