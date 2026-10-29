# Digest and PCR basics: cut a plasmid, copy a gene

- **You will end with:** fragments read from a digest of `pLig-Vector`, and a 323 bp PCR product from `SDM-Template` with EcoRI and BamHI sites, cut to a 313 bp piece on the shelf.
- **Time:** about 30 minutes.
- **Files:** [pLig-Vector.gb](files/pLig-Vector.gb) and [SDM-Template.gb](files/SDM-Template.gb) (synthetic examples, plain downloads).
- **Before this:** [Before you start](before-you-start.md), if the sample files or the enzyme ticks are new to you.

## Exercise 1 of 2: the digest

1. **File ▸ Open**, select `pLig-Vector.gb`.
2. Close every other tab.
3. Open the **Enzymes** tab and click **Hide all**.

   > [!WARNING]
   > If instead many enzymes are still ticked, click **Hide all** again before going on. A file you open opens with every single cutter ticked, and the digest follows the ticks and nothing else.

4. Type `EcoRI` in **Filter** and tick it.

   > [!NOTE]
   > You see `2,664 bp` under **Fragments from ticked enzymes**, and **On a gel: 1 band, 2,664 bp.**

5. Click the **Cloning** tab and pick **Digest** under **Reaction**.

   > [!NOTE]
   > You see **Digest with ticked enzymes** with `EcoRI` beside it, **1 fragment, largest first.**, and one row: **2,664 bp**, range `234–233`, ends `EcoRI 5′ AATT` on both sides.

   > [!TIP]
   > One cut opens a circle: the same 2,664 bases are now a linear piece that starts just after the cut and runs round the old origin to end just before it, which is why its range wraps. A circle cut once gives one fragment, and that molecule is what you would clone into. The row also lists the features it carries: `synthetic promoter, MCS, synthetic terminator, AmpR, +1 more`.

6. Go back to the **Enzymes** tab, type `XhoI` in **Filter** and tick it as well, so `EcoRI` and `XhoI` are ticked.

   > [!NOTE]
   > You see a lane for the double digest, a lane for each enzyme alone and a ladder, sizes `1,275, 969, 420 bp`, and **On a gel: 3 bands, 1,275 + 969 + 420 bp.**

7. In the **Cloning** tab read the three rows:

   | Fragment | Range     | Left end        | Right end       |
   | -------- | --------- | --------------- | --------------- |
   | 1,275 bp | 654–1,928 | `XhoI 5′ TCGA`  | `XhoI 5′ TCGA`  |
   | 969 bp   | 1,929–233 | `XhoI 5′ TCGA`  | `EcoRI 5′ AATT` |
   | 420 bp   | 234–653   | `EcoRI 5′ AATT` | `XhoI 5′ TCGA`  |

8. Hover the **969 bp** row.

   > [!NOTE]
   > You see the map and the sequence view draw that piece as a solid arrow while the others stay dashed.

9. Click its length to select it in the views. Then click a band in the gel in the **Enzymes** tab: the piece it stands for is selected too.

10. In the **Enzymes** tab, untick `EcoRI`, leaving only `XhoI`.

    > [!NOTE]
    > You see `1,389, 1,275 bp`, and the note, now in the warning colour: **On a gel: 1,389 ×2 bp — one band, so there is nothing to tell apart; 1,389 and 1,275 run together.**

    > [!TIP]
    > Two fragments are two pieces of DNA however they look on a gel. The gel is a rule of thumb: two bands within about 15 % of each other are called one, and these are less than 10 % apart. A different second enzyme, as in the double digest above, separates them.

11. Click **Hide all**, then tick `EcoRI` and `EcoRV` (use **Filter** for each).

    > [!NOTE]
    > You see two fragments in the **Cloning** tab: **1,830 bp** (`EcoRV` blunt to `EcoRI 5′ AATT`) and **834 bp** (`EcoRI 5′ AATT` to `EcoRV` blunt).

    | Fragment | Range     | Left end        | Right end       |
    | -------- | --------- | --------------- | --------------- |
    | 1,830 bp | 1,068–233 | `EcoRV` blunt   | `EcoRI 5′ AATT` |
    | 834 bp   | 234–1,067 | `EcoRI 5′ AATT` | `EcoRV` blunt   |

12. Click **Add** on the **834 bp** row.

    > [!NOTE]
    > You see **Added ✓**, then **Add again**, and the row says **On shelf**.
    - [ ] The last line of the tab reads **The shelf holds 1 part, 834 bp.**

    > [!WARNING]
    > The shelf lives in the browser, so parts from an earlier session are still on it and add to the count. To start from none, open the **Bench** (the link at the bottom of the Cloning tab) and press **Clear shelf**.

13. Click **Open** on the **1,830 bp** row.

    > [!NOTE]
    > You see a new tab, `pLig-Vector EcoRV-EcoRI fragment`, with `1,830 bp, linear · EcoRV blunt / EcoRI 5′ AATT` in the toolbar.

14. In the edit bar click **Blunt (fill in)**.

    > [!NOTE]
    > You see `1,834 bp` and `EcoRV blunt / EcoRI blunt` in the toolbar: the four bases of the overhang `AATT` were copied into base pairs.

    > [!TIP]
    > A blunt end joins any other blunt end, so this is how an EcoRI end is made to meet an EcoRV one. **Blunt (trim)** is the other way: it removes the overhang instead, and here leaves the length at 1,830, because the top strand of this end already stops at the cut.

15. Press `Ctrl+Z` once to see the sticky end come back, and `Ctrl+Shift+Z` to blunt it again. (At the EcoRI end of the sequence view the other strand's four bases are drawn just outside the last column while it is sticky.)

16. Open the **Enzymes** tab, click **Hide all**, then open the **Cloning** tab.

    > [!NOTE]
    > You see **No enzyme is ticked**, and the molecule still listed as one fragment, **1,834 bp**, with the ends it has.

17. Click **Add**.

    - [ ] The last line of the tab reads **The shelf holds 2 parts, 2,668 bp.**

    > [!WARNING]
    > If not, the total is the sum of what is on the shelf: 834 + 1,834 = 2,668. Check that the tab you added from is the blunted **1,834 bp** piece and not the 1,830 bp one.

## Exercise 2 of 2: the PCR

1. Open the **Bench** (the link at the bottom of the Cloning tab) and press **Clear shelf**, so the counts below start at none.
2. **File ▸ Open** `SDM-Template.gb`, close the other tabs, and make `SDM-Template` the tab in front.
3. In the **Cloning** tab pick **PCR** under **Reaction**.

   > [!NOTE]
   > You see **PCR** with `two primers, one template` beside it, and the panel asks you to paste the two oligos.

4. Paste into **Forward primer**: `ATGGCAAGGGGGCGTCTGTG`
5. Paste into **Reverse primer**, written 5′ to 3′ as you would order it: `TTATACTTCCACCAGAAGACGGTAACTG`

   > [!NOTE]
   > You see **20 nt, Tm 63 °C · → 139–158** under the forward box and **28 nt, Tm 59 °C · ← 414–441** under the reverse.

6. Read the product: the panel says **One product:** and lists **303 bp**, `139–441`, **exact match**, with **Show**, **Shelve** and **Open**. Under it a gel draws one band in a lane labelled **PCR**.
7. Set **Polymerase** to **Taq**.

   > [!NOTE]
   > You see **304 bp**, one base longer, and the note **One 3′ A on each end, for TA cloning**.

8. Set **Polymerase** back to **Proofreading**.
9. Click **Show**.

   > [!NOTE]
   > You see the map and the sequence view draw the product as a span with the two primers as arrows on it, and the button reads **Hide**.

10. Click **Hide** to take them off.
11. Replace the primers with ones that carry a restriction site on a tail. Forward: `GGGAATTCTTATGGCAAGGGGGCGTCTGTG`, reverse: `GCGGATCCTTTTATACTTCCACCAGAAGACGGTAACTG`

    > [!NOTE]
    > You see **30 nt, 10 of them a 5′ tail, Tm 63 °C on the template, 67 °C once the product carries it · → 139–158** and **38 nt, 10 of them a 5′ tail, Tm 59 °C on the template, 66 °C once the product carries it · ← 414–441**. The product is **323 bp**, `139–441`, **exact match, 20 bp of tail**.

    > [!TIP]
    > The tail is `GGG` + `GAATTC` (EcoRI) + `TT` on the forward and `GCG` + `GGATCC` (BamHI) + `TT` on the reverse. The bases outside the site are a clamp, because an enzyme cuts poorly at the very end of a molecule. The positions stay 139–441 because a tail pairs with nothing, yet the product is 20 bp longer because it carries both tails. The two temperatures are why a tailed pair is cycled first at the lower Tm and then at the higher.

12. Click **Shelve**.

    - [ ] The last line of the tab reads **The shelf holds 1 part, 323 bp.**

13. Click **Open**.

    > [!NOTE]
    > You see a new tab, `SDM-Template PCR product`, linear, 323 bp, with `synthORF` and a `Forward` and a `Reverse` primer feature on it.

14. In its **Enzymes** tab click **Hide all**, then tick `EcoRI` and `BamHI`.
15. In the **Cloning** tab (**Digest**) read the three fragments:

    | Fragment | Left end        | Right end       |
    | -------- | --------------- | --------------- |
    | 313 bp   | `EcoRI 5′ AATT` | `BamHI 5′ GATC` |
    | 7 bp     | `BamHI 5′ GATC` | plain blunt end |
    | 3 bp     | plain blunt end | `EcoRI 5′ AATT` |

    > [!TIP]
    > The clamps are what is left over. The 313 bp piece is the gene with an EcoRI end and a BamHI end, the same two enzymes in the same order as the `MCS` of `pLig-Vector`, so it is ready for [Ligation](ligation.md).

16. Click **Add** on the **313 bp** row (range `4–316`).

    - [ ] The shelf now holds **2 parts, 636 bp.**

    > [!WARNING]
    > If not, the total is 323 + 313 = 636: check that you added the **313 bp** row and not another one.

17. Look at the sequence of the `SDM-Template PCR product` tab.

    > [!NOTE]
    > You see its first ten and last ten bases in capitals and the gene between them in lower case.

18. Back in the `SDM-Template` tab, try the first wrong pair. Forward: `ATGGCAAGGGGGCGTCTGTG`, and reverse, pasted as it stands in the gene and not reverse-complemented: `CAGTTACCGTCTTCTGGTGGAAGTATAA`

    > [!NOTE]
    > You see no product, and: **Both primers anneal to the same strand of SDM-Template, so they both copy the same way and nothing is amplified. One of them wants reverse-complementing.**

    > [!TIP]
    > A reverse primer is the reverse complement of the template's end. A primer pasted straight from the sequence copies the same strand as the forward one, so the two never meet. Pointing away is not wrong on a plasmid, though: forward `CAGTTACCGTCTTCTGGTGGAAGTATAA` with reverse `CACAGACGCCCCCTTGCCAT` (the two ends of `synthORF`, each pointing out of the gene) lists **986 bp**, `414–158, over the origin` on a circle. That is inverse PCR, how a vector is linearised; on a linear template the same pair would say the primers point away from each other.

19. Now a primer that matches nothing. Forward: `ACGTACGTACGTACGTACGTAC`, with the good reverse from step 5.

    > [!NOTE]
    > You see **22 nt — no 3′ end long enough to prime. The last 5 bases have to match exactly.** under the forward box and, in red, **Forward does not anneal to SDM-Template, so there is nothing for the other primer to meet.** No **Shelve** button appears.

**Done when:**

- [ ] The shelf holds **2 parts, 2,668 bp** after Exercise 1 (834 and 1,834), and **2 parts, 636 bp** after Exercise 2 (323 and then the 313 bp EcoRI–BamHI piece).
- [ ] The plain pair gave **303 bp** (`139–441`), the tailed pair **323 bp** with **20 bp of tail**.

Next: [Ligation](ligation.md) takes the pieces you shelved here and joins them on the Bench. Back to the [tutorials index](README.md). The guide's [Digest](../guide/12-cloning.md#digest), [Sticky ends on a document](../guide/12-cloning.md#sticky-ends-on-a-document), [PCR](../guide/12-cloning.md#pcr) and [The shelf](../guide/12-cloning.md#the-shelf) are the reference for what you did here.

## How it works

Nothing on this page joins anything: joining is the **Bench**, and the [tutorials](README.md) after this one use it. What these two panels give the Bench is the **shelf**, the parts you collect here. There is no NCBI gene path in this tutorial: a gene fetched from NCBI is digested and amplified the same way, step for step, but these exercises need plasmids whose sites and primer positions are known.

| File           | Length   | What it is                                                                                                                                                                  |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pLig-Vector`  | 2,664 bp | Circular: `synthetic promoter`, `MCS` (EcoRI, PstI, BamHI), `synthetic terminator`, `AmpR` (reverse strand), `ori`. EcoRI, PstI, BamHI and EcoRV cut it once; XhoI twice.   |
| `SDM-Template` | 1,241 bp | Circular: `synthetic promoter`, `synthORF` (139–441, 100 codons and a stop), `synthetic terminator`, `AT-rich spacer`, `AmpR` and `ori` stand-ins. One EcoRI and one BamHI. |

The enzymes' positions are all you need for Exercise 1: EcoRI cuts `pLig-Vector` at 233 and XhoI at 653 and 1,928, EcoRV at 1,067 (blunt). The EcoRI and BamHI sites of `SDM-Template` are outside `synthORF`, so a PCR that copies only the gene has neither, and the tails in Exercise 2 add them.

Eight words:

- **Digest**: cutting DNA with restriction enzymes. The panel cuts the document with the enzymes **ticked in the Enzymes tab**, all at once and completely, and lists the pieces.
- **Fragment**: one piece of a digest. A circle cut once is **one** fragment, opened up; a circle cut n times gives n; a linear molecule cut n times gives n + 1.
- **Sticky end**: an end where one strand sticks out past the other. EcoRI leaves a 5′ overhang, `AATT`. Two sticky ends with the same overhang can pair; that is what ligation uses.
- **Blunt end**: both strands stop together, as EcoRV leaves them. A PCR product from a proofreading polymerase is blunt at both ends.
- **Blunting**: turning a sticky end into a blunt one. **Fill in** (Klenow or T4 DNA polymerase) copies a 5′ overhang into base pairs; **trim** (mung bean nuclease) removes an overhang.
- **Shelf**: the parts you collect for the Bench. It lives in the browser, so a part stays until you remove it.
- **Primer**: a short oligo written 5′ to 3′ as you would order it. Only its 3′ end has to match the template; the rest is a **tail**, and it is copied into the product all the same.
- **Tm**: the melting temperature of the part that anneals. A primer with a tail has two, one on the template and a higher one once the product carries the whole oligo.

Other methods to know: the product's capital letters mean "not from the template", the way a primer is written out in a paper; what is left in capitals is the 5′ tails and any mismatch. A primer must match exactly in its last five bases, though up to two mismatches further back are allowed and are carried into the product. A shelved product still has to be cut before it joins: its sites are not exposed until an enzyme has cut them, and the shelved product is marked dephosphorylated, because oligos are made without a 5′ phosphate unless you order them with one.

**Methylation.** Some enzymes will not cut a site that dam or dcm methylation covers. None of the sites in these two files is in such a context, so the numbers above do not depend on it; when one is, the Cloning tab says how many sites it left out and why. See [Where the DNA was grown](../guide/07-enzymes.md#where-the-dna-was-grown).
