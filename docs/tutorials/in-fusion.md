# In-Fusion and NEBuilder: one gene into a linearised vector

- **You will end with:** one gene in an EcoRV-cut vector, with the designed primer tails: a 2,049 bp circular plasmid (exercise 1) or a 1,779 bp one with insulin (exercise 2).
- **Time:** about 20 minutes.
- **Files:** [pIF-Vector.gb](files/pIF-Vector.gb), [IF-gene.gb](files/IF-gene.gb) (exercise 1 only).
- **Before this:** [Gibson](gibson.md); [Before you start](before-you-start.md) if the Bench or the sample files are new to you.

Before you click anything, close every tab you do not need.

## Exercise 1 of 2: a synthetic ORF

`IF-gene.gb` is a plain 603 bp open reading frame, `synthProt`, ATG to stop, with no cloning ends and no EcoRV site.

1. Choose **File ▸ Open** and select `pIF-Vector.gb` and `IF-gene.gb` (or drag both onto the window).

2. Click the **pIF-Vector** tab so it is in front.

3. In the **Enzymes** tab, click **Hide all**.

4. Type `EcoRV` in the **Filter** box and tick **EcoRV**.

   > [!NOTE]
   > You see that it cuts once.

5. Open the **Cloning** tab (picker: **Digest**).

   > [!NOTE]
   > You see one fragment of **1,446 bp**, with an `EcoRV` end at each side (blunt).

6. Click **Open** on its row.

   > [!NOTE]
   > You see a new tab, `pIF-Vector EcoRV fragment`, linear, 1,446 bp.

   > [!TIP]
   > Open makes the cut vector a document of its own, which is what the designer asks for. A circle, `pIF-Vector`, has no ends to match.

7. Click the **Bench** tab.

8. Click **Gibson** at the top of the middle column.

   > [!WARNING]
   > If you see a red line, **Nothing follows pIF-Vector EcoRV fragment: no other part starts with its last 15 bases or more. 1 of 2 parts were never reached.**, and **1 document left out** (the circular vector), ignore them: they come from the assembly above the designer looking at tabs that do not yet share ends.

9. At the bottom, open **Design insert primers (In-Fusion, NEBuilder)**.

   > [!NOTE]
   > You see two kit buttons, **In-Fusion** (selected, 15 bases of homology) and **NEBuilder HiFi**.

10. Set **Linearised vector** to `pIF-Vector EcoRV fragment`.

11. Set **Insert from** to `IF-gene`.

    > [!NOTE]
    > You see **Insert** read `synthProt (CDS), 1–603, 603 bp`.

12. Compare the two primers with this table (upper case is the vector's end; the rest anneals):

    | Primer      | Length and parts                               | Sequence                                   |
    | ----------- | ---------------------------------------------- | ------------------------------------------ |
    | **Forward** | **37 nt: 15 of vector, 22 annealing at 60 °C** | `ATGACAGCGGCTGATatgtgtagcgagcgtatgcgtt`    |
    | **Reverse** | **40 nt: 15 of vector, 25 annealing at 60 °C** | `GGGCCCCTTGCGGATttatggctgccaactgtatacgcac` |

    > [!TIP]
    > The forward tail is the vector's last 15 bases, ending `GAT`; the reverse tail is the reverse complement of its first 15, so it also ends `GAT`, read from the other strand. The two annealing parts differ in length (22 and 25 bases) because each grows until it melts at 60 °C.

13. Look at the **Product** line.

    > [!NOTE]
    > You see **2,049 bp, circular**, and under **The parts assemble, but the tube may also give something else:** the note **In-Fusion asks for 15 bases of homology, which both tails carry**.

14. Click **Open product**.

    > [!NOTE]
    > You see a new tab, `pIF-Vector EcoRV fragment+IF-gene PCR product assembly`.
    - [ ] The new tab is **2,049 bp** (1,446 + 603), **circular**.

    > [!WARNING]
    > If not, the product is always the vector plus the insert (1,446 + 603): check **Linearised vector** and **Insert**.

15. Open the new tab's **Features** tab.

    > [!NOTE]
    > You see `KanR`, `ori`, `synthetic promoter`, `synthProt`, `synthetic terminator`, and the two primers, `Forward` and `Reverse`.

    > [!TIP]
    > The map starts at the fragment's first base, `ATC`, after the cut, so the gene begins at base 1,447 rather than near the origin. The circle is the same; only the numbering starts elsewhere.

16. Open the new tab's **Enzymes** tab.

    > [!NOTE]
    > You see the default ticks: every enzyme that cuts the product once. **EcoRV** has **0 sites** (the vector had 1).

17. Optional: back on the Bench, click **NEBuilder HiFi** beside **In-Fusion**.

    > [!NOTE]
    > You see the tails grow to 20 bases: **Forward** reads **42 nt: 20 of vector, 22 annealing** and **Reverse** **45 nt: 20 of vector, 25 annealing**. The annealing parts are the same, and the product is still 2,049 bp.

    The product is a scratch document: **File ▸ Save** if you want to keep it.

## Exercise 2 of 2: a gene from NCBI (human insulin, NM_000207)

The record is third-party data, so you fetch it; nothing in this folder contains it. It needs a network connection, and only the accession you type leaves the browser.

1. Repeat steps 1 to 6 of exercise 1 with `pIF-Vector.gb` only: open it, tick **EcoRV** alone, and **Open** the fragment in the Cloning tab. Then close any other tab.

2. Choose **File ▸ Open from NCBI…**.

3. Type `NM_000207` and click **Open**.

   > [!NOTE]
   > You see the record open as a tab of its own, `NM_000207`.

   > [!TIP]
   > A gene off NCBI has no cloning ends, so the primers will add them.

4. Click the **Bench** tab.

5. Click **Gibson** and open **Design insert primers**. The tails below are the In-Fusion ones (15 bases), so if you tried **NEBuilder HiFi** in exercise 1, click **In-Fusion** again.

6. Set **Linearised vector** to `pIF-Vector EcoRV fragment`.

7. Set **Insert from** to `NM_000207`.

8. In **Insert**, choose `insulin preproprotein (CDS), 60–392, 333 bp`.

   > [!TIP]
   > The CDS is the part to amplify, not the whole mRNA record.

9. Compare the primers with this table:

   | Primer      | Length and parts                               | Sequence                                    |
   | ----------- | ---------------------------------------------- | ------------------------------------------- |
   | **Forward** | **33 nt: 15 of vector, 18 annealing at 61 °C** | `ATGACAGCGGCTGATatggccctgtggatgcgc`         |
   | **Reverse** | **41 nt: 15 of vector, 26 annealing at 61 °C** | `GGGCCCCTTGCGGATctagttgcagtagttctccagctggt` |

   > [!NOTE]
   > You see the **Product** line read **1,779 bp, circular**, followed by the notes of exercise 1.

10. Click **Open product**.

    > [!NOTE]
    > You see a new tab, `pIF-Vector EcoRV fragment+NM_000207 PCR product assembly`.
    - [ ] The new tab is **1,779 bp** (1,446 + 333), **circular**.

    > [!WARNING]
    > If not, the product is always the vector plus the insert (1,446 + 333): check that **Insert** is the CDS (333 bp) and not the whole record.

**Done when:**

- [ ] Exercise 1 gave **2,049 bp**, **circular**, with **EcoRV** at **0 sites**.
- [ ] The product is **1,779 bp**, **circular**, with **EcoRV** at **0 sites**.
- [ ] The **Features** tab lists `INS` with the insulin chain features.

## How it works

The five words of this page:

- **Linearised vector**: the vector opened at the place the gene will go. Its two ends are what the insert has to match.
- **Tail**: the 5′ end of a primer that does not pair with the template. Here a tail is a copy of the vector's end, 15 bases for In-Fusion and 20 for NEBuilder HiFi.
- **Annealing part**: the 3′ end of the primer that pairs with the template and starts the copying. The app grows it until it melts at 60 °C.
- **Blunt end**: a cut that leaves no overhang. EcoRV cuts `GAT^ATC`, straight through its site.
- **Seamless**: no site is left at the junction; the gene sits against the cut vector's ends.

`pIF-Vector.gb` is a circular 1,446 bp vector with a promoter and a terminator and, between them, one EcoRV site. You cut it there, so the gene sits between promoter and terminator. PlasmidPop designs the two primers that add the vector's ends to the gene, runs the PCR and the assembly on the screen, and opens the result. You never type a sequence. The designer sits at the bottom of the **Gibson** panel on the Bench, as **Design insert primers (In-Fusion, NEBuilder)**, because the reaction is the Gibson one. In-Fusion (Takara) and NEBuilder HiFi (NEB) work like the [Gibson assembly](gibson.md). Both files are synthetic examples (invented sequence).

What the exercise 1 product holds, beyond what the steps showed:

- The promoter side reads `GAT` then the gene's own `ATG`, and the stop codon is followed by `ATC`: the two halves of the old EcoRV site, now with the gene between them.
- `synthProt` is one open reading frame of **200 residues** and a stop.
- The Enzymes tab has the default ticks. An In-Fusion design has no enzyme of its own to tick.

What the exercise 2 product holds:

- Translating from the insulin start codon reads `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*`: preproinsulin, one frame, one stop; `GAT` sits just before the `ATG`.
- With **NEBuilder HiFi** the tails are 20 bases and the product is the same 1,779 bp.

The oligos depend on the template, the kit and the annealing rule, so a different gene gives different ones. What does not depend on the oligos is the vector and the insert length: the product is always the vector plus the insert.

## Next

See [In-Fusion and NEBuilder: designing the insert primers](../guide/12-cloning.md#in-fusion-and-nebuilder-designing-the-insert-primers) and [Gibson](../guide/12-cloning.md#gibson) for the reaction. To linearise a vector by PCR instead of by a digest, see [PCR](../guide/12-cloning.md#pcr) (inverse PCR). Back to the [tutorials index](README.md).
