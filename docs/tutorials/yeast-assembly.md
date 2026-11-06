# Yeast assembly: a vector and two inserts, joined in the cell

- **You will end with:** a 2,797 bp circle from an EcoRV-cut vector and two inserts that share 40 bp at each junction, then three designs that carry a warning and the two primers that put 40 bp tails on a plain gene.
- **Time:** about 30 minutes.
- **Files:** [YA-Vector.gb](files/YA-Vector.gb), [YA-Insert1.gb](files/YA-Insert1.gb), [YA-Insert2.gb](files/YA-Insert2.gb), [YA-repeat-Insert2.gb](files/YA-repeat-Insert2.gb), [YA-short-Insert2.gb](files/YA-short-Insert2.gb) and [YA-gene.gb](files/YA-gene.gb) (exercise 5 only). Every file is a **synthetic example** (invented sequence).
- **Before this:** [Gibson](gibson.md) and [In-Fusion and NEBuilder](in-fusion.md), whose Bench panel and primer designer this one shares; [Before you start](before-you-start.md) if the Bench or the sample files are new to you.

Before you click anything, close every tab you do not need.

## Exercise 1 of 5: cut the vector and join three pieces

`YA-Vector.gb` is a circular 2,217 bp shuttle vector with a yeast marker (`URA3`), a centromere (`CEN6`), a yeast origin (`ARSH4`), and the bacterial `ori` and `AmpR`, all stand-ins. It has one EcoRV site. The inserts end in the bases of the cut vector, so the yeast cell can close the circle.

1. Choose **File ▸ Open** and select `YA-Vector.gb`.

2. In the **Enzymes** tab, click **Hide all**.

3. Type `EcoRV` in the **Filter** box and tick **EcoRV**.

   > [!NOTE]
   > You see that it cuts once.

4. Open the **Cloning** tab (picker: **Digest**).

   > [!NOTE]
   > You see one fragment of **2,217 bp**, with an `EcoRV` end at each side (blunt).

5. Click **Open** on its row.

   > [!NOTE]
   > You see a new tab, `YA-Vector EcoRV fragment`, linear, 2,217 bp.

   > [!TIP]
   > A circle has no ends to match, so the vector has to be cut first. The panel does not cut it for you: it takes the linear piece.

6. Choose **File ▸ Open** and select `YA-Insert2.gb`, then `YA-Insert1.gb`. Insert 2 is deliberately opened before insert 1.

7. Click the **Bench** tab.

8. At the top of the middle column, click **Yeast assembly**.

   > [!NOTE]
   > You see the heading **Yeast assembly**, with `in vivo, by homology` beside it.

9. Read the tube.

   > [!NOTE]
   > You see four documents, each ticked: `YA-Vector` 2,217 bp, `YA-Vector EcoRV fragment` 2,217 bp, `YA-Insert2` 460 bp, `YA-Insert1` 240 bp, and a line **1 document left out** at the foot of the panel. That is the circular `YA-Vector`, which has no ends. Ignore it.

10. Set **Vector** to `YA-Vector EcoRV fragment`.

    > [!TIP]
    > The vector is the part whose two ends the homology has to close. With **none (all parts are inserts)** the panel still finds the order, but it cannot say which part is the backbone.

11. Leave **Overlap** at **40 bp or more** and **Circular product** ticked.

12. Read the line above the order.

    **3 parts join into a 2,797 bp circle, in this order:**

    > [!NOTE]
    > You see the parts in the order the panel found, not the order of your tabs: `YA-Vector EcoRV fragment (vector)`, `YA-Insert1`, `YA-Insert2`.

13. Read the three junction lines, each with a tick. A yeast junction is judged by its length and its GC, never by a melting temperature.

    | Junction                               | Line                              |
    | -------------------------------------- | --------------------------------- |
    | `YA-Vector EcoRV fragment` to insert 1 | **40 bp overlap, 50% GC**         |
    | `YA-Insert1` to `YA-Insert2`           | **40 bp overlap, 55% GC**         |
    | `YA-Insert2` to the vector             | **closes: 40 bp overlap, 53% GC** |

    > [!NOTE]
    > You see the last line shut the circle; hover a junction to see the shared bases (**Shared:** and the sequence).

14. Read the **Product** line.

    > [!NOTE]
    > You see **2,797 bp, circular**, with the features `URA3`, `CEN6`, `ARSH4`, `AmpR`, `ori`, `synthetic promoter`, and **+5 more**, and no warning under it.

    > [!TIP]
    > The sizes add up to more than the product: 2,217 + 240 + 460 = 2,917, but the product is 2,797. The difference is 120 bp, the three overlaps, because each shared stretch is in the product **once**.

15. Click **Assemble**. The product is a scratch document; **File ▸ Save** if you want to keep it.

    > [!NOTE]
    > You see a new tab, `YA-Vector EcoRV fragment+YA-Insert1+YA-Insert2 assembly`, with the **Features** tab in front.

16. Look through the **Features** tab.

    > [!NOTE]
    > You see `URA3`, `CEN6`, `ARSH4`, `AmpR`, `ori`, `synthetic promoter`, `synthGene` and `synthetic terminator`, and three more named `homology 1`, `homology 2` and `homology 3`, each 40 bp long: `homology 1` at 2,178 to 2,217, `homology 2` at 2,378 to 2,417 and `homology 3` at 1 to 40.

    > [!TIP]
    > The homology features are the app's marks on the junctions, so you can check them by eye on the map. They are not part of any file.

    **Checkpoint:**
    - [ ] The product is 2,797 bp, circular, with the five vector features, `synthetic promoter`, `synthGene` and `synthetic terminator`, and three `homology` features of 40 bp.

    > [!WARNING]
    > If not: check that **Vector** is the EcoRV fragment and that no other insert is ticked in the tube, then close the assembly tab and assemble again.

## Exercise 2 of 5: homology that occurs twice

`YA-repeat-Insert2.gb` is `YA-Insert2` with its 40 bp of homology with insert 1 copied once more, over the terminator (bases 361 to 400). In a tube that changes nothing. In a yeast cell the homology has two places to recombine.

1. Close the assembly tab.

2. Choose **File ▸ Open** and select `YA-repeat-Insert2.gb`.

3. Click the **Bench** tab. The panel keeps the **Vector** you set.

4. Untick `YA-Insert2`, so the repeat file replaces it.

   > [!NOTE]
   > You see the tube: `YA-Vector EcoRV fragment`, `YA-Insert1` and `YA-repeat-Insert2` ticked.

5. Read the line above the order, and the **Product** line.

   > [!NOTE]
   > You see the same circle as before: **3 parts join into a 2,797 bp circle, in this order:**, three junctions of 40 bp, and a **Product** of **2,797 bp, circular**.

6. Read the warning.

   **The parts assemble, but the tube may also give something else:**

   > [!NOTE]
   > You see one line under it: **The homology joining YA-Insert1 to YA-repeat-Insert2 also occurs in YA-repeat-Insert2 at 361, where the cell could recombine instead and give a different construct.**

   > [!TIP]
   > The panel searches every part, the vector's interior included, on both strands, for each junction's homology. The design is not rejected: **Assemble** still works. The warning says the cell may use the copy at 361 instead of the junction and give a smaller or different circle.

7. Untick `YA-repeat-Insert2` and tick `YA-Insert2` again.

   > [!NOTE]
   > You see the warning go.

## Exercise 3 of 5: homology that is too short

`YA-short-Insert2.gb` is `YA-Insert2` without the first 15 bases of its homology with insert 1 (445 bp), so it shares only 25 bp with insert 1.

1. Choose **File ▸ Open** and select `YA-short-Insert2.gb`.

2. Click the **Bench** tab and untick `YA-Insert2`.

3. Read the message where the order used to be.

   **Nothing follows YA-Insert1: no other part starts with its last 40 bases or more. 1 of 3 parts were never reached.**

   > [!NOTE]
   > You see it in red, with no Product line and no **Assemble** button.

   > [!TIP]
   > **Overlap** is the shortest homology the panel accepts, 40 bp by default. The two ends share only 25, so at 40 they do not join.

4. Set **Overlap** to `25`.

   > [!NOTE]
   > You see **3 parts join into a 2,797 bp circle, in this order:**. The second junction line is marked with a **!** instead of a tick, and reads **25 bp overlap, 56% GC**.

5. Read the warning.

   > [!NOTE]
   > You see: **Recombination falls off sharply below 30 bp of homology: homology 2 (YA-Insert1 to YA-short-Insert2), 25 bp.**

   > [!TIP]
   > The panel accepts the design because you lowered the setting, and tells you why it is a weak one. The fix is longer homology, here the full 40 bp of `YA-Insert2`, not a lower number.

6. Set **Overlap** back to `40`, untick `YA-short-Insert2` and tick `YA-Insert2` again.

## Exercise 4 of 5: no vector, a linear product

1. Untick `YA-Vector EcoRV fragment`.

   > [!NOTE]
   > You see the **Vector** select fall back to **none (all parts are inserts)**, and in red: **Nothing follows YA-Insert2: no other part starts with its last 40 bases or more. 1 of 2 parts were never reached.** The inserts share one junction, but without the vector nothing closes the circle.

2. Untick **Circular product**.

   > [!NOTE]
   > You see **2 parts join into a 660 bp molecule, in this order:** and a **Product** of **660 bp, linear**, with the features `synthetic promoter`, `synthGene`, `synthetic terminator` and `homology 1`.

3. Read the warnings.

   > [!NOTE]
   > You see three lines under **The parts assemble, but the tube may also give something else:**
   >
   > - **The product is linear. A linear molecule with no telomere is lost from yeast; assemble it as a circle.**
   > - **No yeast selectable marker (URA3, LEU2, HIS3, TRP1, MET15, LYS2, ADE2, KanMX) is annotated on the product, so nothing selects the assembly.**
   > - **No ARS, CEN or 2-micron feature is annotated on the product, so it will not replicate in yeast.**

   > [!TIP]
   > The marker and origin checks read the features the parts carry. They would also fire for a vector whose `URA3` or `CEN6` was never annotated, which is when to run Detect features on the product first. Here the vector is simply not in the tube.

4. Tick `YA-Vector EcoRV fragment` and **Circular product** again.

## Exercise 5 of 5: tails for a plain gene

`YA-gene.gb` is a plain 450 bp open reading frame, `synthProt`, ATG to stop, with no cloning ends. The designer puts 40 bases of the cut vector on each primer.

1. Choose **File ▸ Open** and select `YA-gene.gb`.

2. Click the **Bench** tab.

   > [!WARNING]
   > If you see a red line, **Nothing follows YA-Insert2: no other part starts with its last 40 bases or more. 1 of 4 parts were never reached.**, and **1 document left out** (the circular vector), ignore them: they come from the assembly above the designer looking at `YA-gene`, which shares no ends with the rest.

3. At the bottom, open **Design insert primers (Yeast assembly)**.

   > [!NOTE]
   > You see no kit buttons, as there are in the Gibson panel: this designer is for the yeast kit alone.

4. Set **Linearised vector** to `YA-Vector EcoRV fragment`.

5. Set **Insert from** to `YA-gene`.

   > [!NOTE]
   > You see **Insert** read `synthProt (CDS), 1–450, 450 bp`.

6. Compare the two primers with this table (upper case is the vector's end; the rest anneals):

   | Primer      | Length and parts                               | Sequence                                                                |
   | ----------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
   | **Forward** | **69 nt: 40 of vector, 29 annealing at 60 °C** | `TGAAGCATTCGCCTGCCTCTCTAACTGTTGCTAGACCGATatgagcttcgatgtgtatacctacttcgg` |
   | **Reverse** | **64 nt: 40 of vector, 24 annealing at 60 °C** | `TGGACTTCCACAGGGCTCTCGACGGAATAAGAGAACCGATttagttcttcgcagcccttgttcc`      |

   > [!TIP]
   > The forward tail is the vector's last 40 bases, ending `GAT`; the reverse tail is the reverse complement of its first 40, so it also ends `GAT`. The annealing parts grow until they melt near 60 °C.

7. Look at the **Product** line, and the note under it.

   > [!NOTE]
   > You see **2,667 bp, circular**, and under **The parts assemble, but the tube may also give something else:** the note **Yeast assembly asks for 40 bases of homology, which both tails carry.**

8. Click **Save primers**.

   > [!NOTE]
   > You see **Saved 2 primers to My primers.** They are named `YA-gene-YA-F` and `YA-gene-YA-R`.

9. Click **Open product**.

   > [!NOTE]
   > You see a new tab, `YA-Vector EcoRV fragment+YA-gene PCR product assembly`.
   - [ ] The new tab is **2,667 bp** (2,217 + 450), **circular**.

**Done when:**

- [ ] Exercise 1 gave a **2,797 bp** circle, three `homology` features of 40 bp, and no warning.
- [ ] Exercise 2 gave the same circle and the warning that the homology also occurs in `YA-repeat-Insert2` at 361.
- [ ] Exercise 3 gave no product at 40 bp, and at 25 bp the warning about homology below 30 bp.
- [ ] Exercise 4 gave a 660 bp linear molecule with three warnings.
- [ ] Exercise 5 gave primers with 40 bp tails and a **2,667 bp** circle.

Next: [Gibson](gibson.md) is the same reaction in a tube, where the melting temperature of each overlap matters. Back to the [tutorials index](README.md).

## How it works

[Yeast assembly](../guide/12-cloning.md#yeast-assembly) on the Bench, including the warnings it adds.

The circle is made of a cut vector and two linear files:

| File                | Length   | Starts with                            | Ends with                                                      |
| ------------------- | -------- | -------------------------------------- | -------------------------------------------------------------- |
| `YA-Vector`         | 2,217 bp | a circle; EcoRV cuts it into one piece | the piece starts and ends at the cut                           |
| `YA-Insert1`        | 240 bp   | the last 40 bp of the cut vector       | `synthetic promoter`, then 40 bp shared with insert 2          |
| `YA-Insert2`        | 460 bp   | those 40 bp, then `synthGene`          | `synthetic terminator`, then the first 40 bp of the cut vector |
| `YA-repeat-Insert2` | 460 bp   | the same 40 bp                         | the same, with those 40 bp also over bases 361 to 400          |
| `YA-short-Insert2`  | 445 bp   | the last 25 of those 40 bp             | the same as `YA-Insert2`                                       |
| `YA-gene`           | 450 bp   | `synthProt`, ATG to stop               | no cloning ends                                                |

- **Homologous recombination**: yeast joins DNA that shares a stretch of sequence, so the parts can be assembled in the cell instead of in a tube. With a linearised vector this is called **TAR cloning** or **gap repair**.
- **Overlap**: the shortest homology the panel accepts, 20 to 80 bp, 40 by default. The panel judges a junction by its length (a warning under 30 bp or over 80) and its GC (under 30% or over 70%), not by a Tm, because there is no enzyme and no 50 °C.
- **Linearised vector**: the backbone cut open. Its two ends are the homology with the first and the last insert.
- **Marker and origin**: `URA3` selects the yeast that took up the circle; `CEN6` and `ARSH4` keep it there. The panel reads them from the annotations, so a product without them is flagged.
- **Seamless**: the shared stretch appears once in the product, so there is no scar to design around.
