# Gibson assembly: a vector and two inserts

- **You will end with:** a 2,379 bp circle from a vector and two inserts that end in each other, with no enzyme site and no scar, then one design that fails and what the panel says about it.
- **Time:** about 20 minutes.
- **Files:** [GB-Vector.gb](files/GB-Vector.gb), [GB-Insert1.gb](files/GB-Insert1.gb), [GB-Insert2.gb](files/GB-Insert2.gb) and [GB-bad-Insert2.gb](files/GB-bad-Insert2.gb). Every file is a **synthetic example** (invented sequence).
- **Before this:** [Before you start](before-you-start.md) if the Bench or the sample files are new to you.

## Exercise 1 of 2: one reaction, three pieces

1. Choose **File ▸ Open** and select `GB-Vector.gb`, `GB-Insert2.gb` and `GB-Insert1.gb` (or drag them onto the window). Insert 2 is deliberately opened before insert 1.

2. Close every other tab.

   > [!WARNING]
   > If instead you see extra tabs, close them: the Gibson panel takes every open tab into the tube.

3. Click the **Bench** tab.

4. At the top of the middle column, click **Gibson**.

   > [!NOTE]
   > You see the heading **Gibson**, with `no enzyme, matching ends` beside it.

5. Under **Overlap**, leave **15 bp or more**.

   > [!TIP]
   > Overlap is the shortest homology the panel accepts at a junction (15 bp is what NEB's protocol asks for); it still reports the longest it finds.

6. Leave **Circular product** ticked.

   > [!NOTE]
   > You see your three documents, each ticked: `GB-Vector` 1,506 bp, `GB-Insert2` 449 bp, `GB-Insert1` 508 bp.

7. Read the line above the order.

   **3 parts join into a 2,379 bp circle, in this order:**

   > [!NOTE]
   > You see the parts in the order the panel found, not the order of your tabs: `GB-Vector`, `GB-Insert1`, `GB-Insert2`.

   > [!TIP]
   > Homology allows only one order, so the panel follows the chain from the first tab. The tab order was not the circle's order, which is the point.

8. Read the three junction lines, each with a tick. All three are well over 48 °C, so none is marked as weak.

   | Junction                     | Line                                |
   | ---------------------------- | ----------------------------------- |
   | `GB-Vector` to `GB-Insert1`  | **28 bp overlap, Tm 61 °C**         |
   | `GB-Insert1` to `GB-Insert2` | **30 bp overlap, Tm 65 °C**         |
   | `GB-Insert2` to `GB-Vector`  | **closes: 26 bp overlap, Tm 65 °C** |

   > [!NOTE]
   > You see the last line shut the circle; hover a junction to see the shared bases (**Shared:** and the sequence).

9. Read the **Product** line.

   > [!NOTE]
   > You see **2,379 bp, circular**, with the features `synthetic terminator`, `KanR`, `ori`, `synthetic promoter`, `synthDomainA`, `linker`, and one more, and no warning under it.

   > [!TIP]
   > The sizes add up to less than the parts: 1,506 + 508 + 449 = 2,463, but the product is 2,379. The difference is 84 bp, the three overlaps (28 + 30 + 26), because each shared stretch is in the product **once**, not once from each neighbour. There is also no scar and no junction feature: the linker is a feature of insert 1 and appears once, where the two inserts meet.

10. Click **Assemble**. The product is a scratch document; **File ▸ Save** if you want to keep it.

    > [!NOTE]
    > You see a new tab, `GB-Vector+GB-Insert1+GB-Insert2 assembly`, with the **Features** tab in front.

    **Checkpoint:**
    - [ ] The product is 2,379 bp, circular, with `synthetic terminator`, `KanR`, `ori`, `synthetic promoter`, `synthDomainA`, `linker` and `synthDomainB`, each once.

    > [!WARNING]
    > If not: check that only the three documents were open, then close the assembly tab and assemble again.

11. Open the product's **Enzymes** tab.

    > [!NOTE]
    > You see the default ticks, every enzyme that cuts the product once; a Gibson has no enzyme to pick, so unlike Golden Gate and ligation none is ticked for the reaction.

    Use **Hide all** if the map is crowded.

12. Optional: check the reading frame in the sidebar's **Translate** tab. Read from the ATG of `synthDomainA`, it runs on through the linker and `synthDomainB` to the stop: one open reading frame of **290 residues** (150 + 10 + 130).

## Exercise 2 of 2: what a bad design looks like

`GB-bad-Insert2.gb` is `GB-Insert2` with **one base** of its 30 bp overlap changed (the 14th). To the eye the ends look alike; to the panel they are different, because an overlap has to match exactly.

1. Close the assembly tab.

   > [!WARNING]
   > If you leave it open, the panel says **1 document left out**, because a circle has no ends to join by: the Gibson takes only linear pieces.

2. Choose **File ▸ Open** and select `GB-bad-Insert2.gb`.

3. Click the **Bench** tab, then **Gibson**.

4. Untick `GB-Insert2`, so the bad one replaces it.

   > [!NOTE]
   > You see the tube: `GB-Vector`, `GB-Insert1`, `GB-bad-Insert2`.

5. Read the message where the order used to be.

   **Nothing follows GB-Insert1: no other part starts with its last 15 bases or more. 1 of 3 parts were never reached.**

   > [!NOTE]
   > You see it in red, with no Product line and no **Assemble** button.

   > [!TIP]
   > The panel says where the chain breaks and how many parts it never reached, instead of guessing.

6. Set **Overlap** to **12 bp or more**.

   > [!NOTE]
   > You see the same message, with 12 where it said 15.

   > [!TIP]
   > Lowering the threshold does not rescue a mismatched overlap. The two ends no longer match along their whole length, and a junction needs that; the fix is in the design, not in the setting.

7. Set **Overlap** back to **15 bp or more**, tick `GB-Insert2` again and untick the bad one.

   > [!NOTE]
   > You see the assembly is back.

**Done when:**

- [ ] Exercise 1 gave a 2,379 bp circle in any tab order.
- [ ] The bad insert gave no product and no **Assemble** button.

Next: [In-Fusion and NEBuilder](in-fusion.md) makes the primers that put the overlaps on a piece. Back to the [tutorials index](README.md).

## How it works

[Gibson](../guide/12-cloning.md#gibson) on the Bench, including the warnings it adds (homology found elsewhere, a short part, short overlaps for the number of pieces).

The circle is made of three linear files, each one a few hundred to a thousand bases:

| File         | Length   | Starts with                            | Ends with                                           |
| ------------ | -------- | -------------------------------------- | --------------------------------------------------- |
| `GB-Vector`  | 1,506 bp | 26 bp that the second insert ends in   | 28 bp that the first insert starts with             |
| `GB-Insert1` | 508 bp   | those 28 bp, then `synthDomainA`       | a 30 bp `linker` that the second insert starts with |
| `GB-Insert2` | 449 bp   | that 30 bp linker, then `synthDomainB` | 26 bp that the vector starts with                   |

The two inserts are two halves of one fused open reading frame: `synthDomainA` (150 residues, starting on an ATG), the linker (10 residues), `synthDomainB` (130 residues) and a stop. The vector carries the promoter before the first insert and the terminator after the second, plus `KanR` and `ori` stand-ins. You never type a sequence: the panel finds the overlaps itself.

- **Overlap** (homology arm): a stretch of 15 to 40 bases that the end of one piece shares with the start of the next. The overlaps decide what joins what and in which order; there is nothing else to design.
- **Linearised vector**: the backbone as a linear piece. Its two ends are the overlaps with the first and the last insert. Here it is a file; in the lab you would cut a plasmid or amplify it by inverse PCR.
- **Exonuclease, polymerase, ligase**: the three enzymes of the mix. The exonuclease chews each 5′ end back so the overlaps become single strands that anneal; the polymerase fills the gaps and the ligase seals them.
- **Tm of an overlap**: the melting temperature of the shared stretch. The reaction is held at 50 °C, so the panel marks a junction under 48 °C.
- **Seamless**: the shared stretch appears once in the product, so there is no scar to design around.
