# Batch: many primer pairs and many inserts at once

- **You will end with:** a pasted table of six rows run as four designs, one failed row and one row rejected before the run, the pool check and a plate-format order sheet for the oligos, a scan of six residues to alanine, then three inserts cloned into one Golden Gate vector, with the constructs as a ZIP and one batch protocol, and the same table run with restriction sites and with homology ends.
- **Time:** about 30 minutes.
- **Files:** [BP-Plasmid.gb](files/BP-Plasmid.gb) (primers), then [pGG-Destination.gb](files/pGG-Destination.gb), [GG-gene.gb](files/GG-gene.gb), and for the last exercise [pLig-Vector.gb](files/pLig-Vector.gb) and [GB-Vector.gb](files/GB-Vector.gb). All synthetic, all plain downloads.
- **Before this:** [Site-directed mutagenesis](mutagenesis.md) and [Golden Gate, several parts](golden-gate-parts.md) help, since a batch row is the same design as one of those done by hand. Nothing is required; [Before you start](before-you-start.md) covers opening the files.

The **Batch** page designs a table of primers or inserts in one run: a row for each region, point mutation or insert, one after another, with the results in a table and the oligos leaving together. It lives in the primer workspace, which is not offered on a phone. You paste the table, so the exercises give it to you as text; the bases are in the sample files.

## Exercise 1 of 5: paste a table and run it

1. Choose **File ▸ Open** and select `BP-Plasmid.gb`. Close every other tab.

   > [!NOTE]
   > You see `BP-Plasmid`, **923 bp**, circular, with `synthetic promoter` (1 to 120), `synthORF` (141 to 383), `synthetic terminator` and `ori`.

2. Open the **Primers** tab of the sidebar and click **Design primers…**. In the rail down the left of the workspace, click **Batch**.

   > [!NOTE]
   > You see the heading **Batch design**, a **Method** select reading **Primer pairs**, a **Template** select reading `BP-Plasmid` and an empty **Rows** box.

   > [!TIP]
   > The same page opens from the Cloning tab's **Design many inserts ›** link, on a cloning method; Exercise 4 uses it.

3. Click in the **Rows** box and paste this table. From a spreadsheet you would copy the cells and paste them as they are: tabs, commas and semicolons all read.

   ```
   name,region,tm,size,change
   ORF,synthORF,,,
   promoter,synthetic promoter,,,
   terminator,synthetic terminator,,,
   ORF,200-300,,,
   tight,400-460,,40,
   E4A,150-152,,,GCG
   ```

   > [!NOTE]
   > You see **5 rows ready, 1 row with a problem and not run**, and under it **Line 5 (ORF): The name “ORF” is already used on line 2.**

   > [!TIP]
   > The first line names the columns, in any order. `name` is required and used once, without regard to case; `region` is a range (`200-300`, `complement(200..300)`, or a range across the origin of a plasmid) or the name of a feature, as here; `tm` and `size` are a Tm to aim at and the longest product, for that row only; `change` makes the row a point mutation. A row with no `template` uses the one under **Template**. Columns the page does not know are kept as notes.

4. Click **Design 5 rows**. The rows fill in as each one finishes.

   > [!NOTE]
   > You see **4 rows designed, 1 failed.** and one line for each row, in this order:
   >
   > | Row        | Status     | Product |
   > | ---------- | ---------- | ------- |
   > | ORF        | designed   | 483     |
   > | promoter   | designed   | 500     |
   > | terminator | designed   | 332     |
   > | tight      | **failed** | —       |
   > | E4A        | designed   | 923     |

5. Click the `tight` row.

   > [!NOTE]
   > You see its message in the last column, **No primer pair meets the criteria for this region.** Its `size` of 40 asked for a product no longer than 40 bp for a 61 bp region it has to flank.

   > [!TIP]
   > The two kinds of bad row differ. A row with a problem (a repeated name, a template that is not open, a region past the ends, bases that are not IUPAC letters) is listed under the box and **not run**. A row that is valid but cannot be designed is **failed** in the results, with the reason, and the rest go on. Cancelling a run keeps the rows already done.

6. Click the `ORF` row, then `E4A`.

   > [!NOTE]
   > For `ORF` you see a forward and a reverse oligo of 21 nt, `ATCTGATTTGCTGGTTGGCGC` and `CCCTGTGGTTCTCGTATCGGC`, and the pair is drawn on the map, flanking `synthORF`. `E4A` is a mutation: back-to-back primers whose product is the new plasmid, 923 bp, and its forward primer starts with the new codon, `GCG`.

   > [!TIP]
   > A pair row shows its best pair, as the **Results** page lists it first; design the region on **Design** to see the others. **Open product** on the `E4A` row opens the mutant as a new tab.

   **Checkpoint:**
   - [ ] **4 rows designed, 1 failed.**, products 483, 500, 332, none and 923.

   > [!WARNING]
   > If **Design** is greyed out, the table has no ready row; read the problem list under the box. If a count differs, check that no line was cut off by the paste and that `BP-Plasmid` is the template.

## Exercise 2 of 5: the pool check and the order sheet

1. Scroll under the results to **Pool check**.

   > [!NOTE]
   > You see **8 oligos** and four lines:
   >
   > - **No duplicate names.**
   > - **No two names share bases.**
   > - **3 strong cross-dimers (ΔG ≤ −6 kcal/mol), most stable first: ORF fwd × E4A rev −6.8; ORF rev × E4A fwd −6.5; ORF fwd × terminator fwd −6.3.**
   > - **Tm 59.4–66.6 °C, a spread of 7.2 °C (wider than 5 °C).**

   > [!TIP]
   > The pool check reads all the oligos as one order, after the run. Two oligos only form a cross-dimer if they are in the same tube, so for pairs that go into separate reactions the dimer line is a hint, not a fault; it matters for oligos you pool. The Tm spread matters for oligos you put on one plate and one cycling programme: here the highest Tm, 66.6 °C, is the `E4A` forward primer's, the lowest 59.4 °C the `ORF` forward primer's.

2. Click **Order sheet…**.

   > [!NOTE]
   > You see **8 oligos on 1 plate**, with **Scale** `25 nmol`, **Purification** `desalted` and **Wells fill** set to **along rows**. The preview begins `1  A1  ORF fwd` and `1  A2  ORF rev`, and the sheet's last line is `E4A rev`, 17 nt, in `A8`.

3. Set **Wells fill** to **down columns**.

   > [!NOTE]
   > You see the same oligos in `A1`, `B1`, `C1`, and so on down to `H1`.

4. Click **Download CSV**.

   > [!NOTE]
   > You save `order-sheet.csv`, with the columns `plate,well,name,sequence,length,scale,purification,notes`. A line reads `1,A1,ORF fwd,ATCTGATTTGCTGGTTGGCGC,21,25 nmol,desalted,` (with the other fill order, `A1` stays `A1`).

   > [!TIP]
   > The sheet is vendor-neutral: copy its columns into your vendor's form, or rename the header cells to the ones its template wants. Nothing is sent anywhere. The dialog refuses to download while two oligos share a name (without regard to case), since a vendor does too, and warns, without blocking, when two names have the same bases and would be paid for twice. The 97th oligo starts plate 2. **Save all to My primers** keeps the same oligos as `ORF fwd`, `ORF rev` and so on in your list.

   **Checkpoint:**
   - [ ] The pool check reports 3 cross-dimers and a spread of 7.2 °C, and the sheet has 8 oligos on 1 plate.

## Exercise 3 of 5: scan rows

1. Click **Generate scan rows…** under the **Rows** box, to open it.

   > [!NOTE]
   > You see **Gene** reading `synthORF` (the one coding feature of the template), **To residue** `A`, and **From residue** and **Through residue** empty.

2. Type `1` in **From residue**, `6` in **Through residue**, and click **Generate**.

   > [!NOTE]
   > You see **5 rows for synthORF replaced the table; 1 codon left out (already that residue, a stop, or split by an intron).** The **Rows** box now holds, from the top, `synthORF_M1A`, `synthORF_C2A`, `synthORF_E4A`, `synthORF_W5A` and `synthORF_N6A`.

   > [!TIP]
   > Residue 3 is already an alanine, so it has no row. Every other row is an ordinary row (`name`, `template`, `region`, `change`), which you can edit or delete before running; for example `synthORF_E4A` is `150..152` with `GCG`, the same change as `E4A` in Exercise 1. The new codon is the one nearest the old, so the fewest bases change; methionine 1 is included, so delete that row if the start codon should stay.

3. Click **Design 5 rows**.

   > [!NOTE]
   > You see **5 rows designed.**, five mutations, each a 923 bp plasmid.

   **Checkpoint:**
   - [ ] **5 rows designed.** No row failed.

   > [!WARNING]
   > If **Generate** says the template has no coding feature, `BP-Plasmid` is not the template. At most **96 rows** are designed at once, so for a long gene scan a window of the protein with **From** and **Through**.

## Exercise 4 of 5: many inserts into one vector (Golden Gate)

A cloning method turns each row into **one insert to clone into one vector**, designed exactly as the Cloning workspace designs a single insert, so a row and the same insert done by hand give the same primers and the same construct.

1. Close the tabs. Choose **File ▸ Open**, open `GG-gene.gb`, then open `pGG-Destination.gb`, so the destination is the tab in front.

   > [!NOTE]
   > You see `pGG-Destination`, **2,647 bp**, circular, in front, and `GG-gene`, **702 bp**, linear, behind it.

2. In the Primers tab click **Design primers…**, then **Batch**. Choose **Golden Gate part** in **Method**.

   > [!NOTE]
   > You see **Vector** reading `pGG-Destination (this document)` and **Enzyme** reading `BsaI`. Above the results, once you run, the destination's overhangs are shown once.

3. Replace the **Rows** box with this table. Every row names its template, so the **Insert template** select does not matter here.

   ```
   name,template,region,sequence,enzyme
   gene_full,GG-gene,,,
   gene_head,GG-gene,1-300,,
   mini,,,ATGTGTCGTAGAAACGGACGCCGCCCCCAGAGTGACGAAAACTCTCTTAGGAGCGCCTATGTACTTACTAACAGAGACAGCAGTCCGACTAGGGTGCAATGTGTCGCCGGTGGCATTTAA,
   badcell,GG-gene,,,NotAnEnzyme
   lost,nowhere,1-100,,
   ```

   > [!NOTE]
   > You see **4 rows ready, 1 row with a problem and not run**, and **Line 6 (lost): No template named “nowhere”: open it, or load a record of that name.**

   > [!TIP]
   > An insert is the row's own bases (`sequence`, which needs no template), a `region` of a template, or, with neither, the whole template. The page lists the columns each method reads under the select. For Golden Gate they are `enzyme`, `left` and `right` (the two overhangs), `include_start`, `include_stop` and `tm`.

4. Click **Design 4 rows**.

   > [!NOTE]
   > You see **Every part carries the destination’s overhangs, GGAG and CGCT.** and **3 rows designed, 1 failed.**, with these constructs:
   >
   > | Row       | Status       | Construct |
   > | --------- | ------------ | --------- |
   > | gene_full | designed     | 3,029 bp  |
   > | gene_head | designed     | 2,630 bp  |
   > | mini      | **warnings** | 2,447 bp  |
   > | badcell   | **failed**   | —         |

5. Click `mini`, then `badcell`.

   > [!NOTE]
   > `mini` shows a warning that starts **No annealing part at the part's ends meets the settings**: no annealing part at its ends is free of a hairpin, so the nearest one is used. `badcell` says **NotAnEnzyme is not in the enzyme set.**

   > [!TIP]
   > What is the same for every row is checked once, before the first row runs, and said once: a destination without the enzyme's two sites, or a restriction pair that is not in the enzyme set, refuses the whole batch with the reason instead of failing every row.

6. Click **Download constructs**.

   > [!NOTE]
   > You save `pGG-Destination_constructs.zip` with `gene_full.gb`, `gene_head.gb` and `mini.gb`, one GenBank file per construct and none for the failed row.

7. Click **Protocol…**, optionally type a **Vector, ng** and an insert to vector ratio, and choose **Download Markdown**.

   > [!NOTE]
   > You see **3 protocols, 6 oligos to order, downloaded.** The file holds each construct's reactions and expected digest, then **one** table of the six oligos, each sequence once.

   > [!TIP]
   > **Open all constructs** opens the constructs as tabs, but only up to 12 so that it never opens a wall of tabs; the ZIP has no limit. **Save all to My primers** and **Order sheet…** work as for pairs, over these oligos. A construct remembers how it was made: its History tab's **Made from** tree shows the PCR and the assembly.

   **Checkpoint:**
   - [ ] **3 rows designed, 1 failed.**, constructs of 3,029, 2,630 and 2,447 bp, a ZIP of three files and a protocol of three.

## Exercise 5 of 5: the same table, another recipe

The recipe is a setting on the page, not on the table: the same inserts go in by restriction sites or by homology ends when you change **Method** and **Vector**.

1. Close the tabs. Open `GG-gene.gb`, then `pLig-Vector.gb`, so the vector is in front. In **Batch**, choose **Restriction sites**; **5′ enzyme** and **3′ enzyme** read `EcoRI` and `BamHI`.
2. Paste this table and click **Design 4 rows**. (`pLig-Vector`'s cloning site holds EcoRI, PstI and BamHI.)

   ```
   name,template,region,sequence
   gene_full,GG-gene,,
   gene_head,GG-gene,1-300,
   mini,,,ATGTGTCGTAGAAACGGACGCCGCCCCCAGAGTGACGAAAACTCTCTTAGGAGCGCCTATGTACTTACTAACAGAGACAGCAGTCCGACTAGGGTGCAATGTGTCGCCGGTGGCATTTAA
   lost,nowhere,1-100,
   ```

   > [!NOTE]
   > You see **3 rows ready, 1 row with a problem and not run**, then **3 rows designed.**, with constructs of 3,348, 2,946 and 2,766 bp. `mini` carries a similar warning, about its annealing part. The forward primer of `gene_full` starts `gttctggaattc`: padding, then the EcoRI site `GAATTC`, then the start of the gene.

3. Open `GG-gene.gb`, then `GB-Vector.gb` (a **linear** vector whose two ends are its homology), choose **Homology ends** with the **Kit** `In-Fusion`, and run the same table.

   > [!NOTE]
   > You see **3 rows designed.**, with constructs of 2,208, 1,806 and 1,626 bp, each with a warning that **In-Fusion asks for 15 bases of homology at each of the 2 junctions.**

   > [!WARNING]
   > A circular vector is refused before any row is designed, with the designers' own reason: digest it, or amplify it by inverse PCR, and use that fragment. A `kit` cell can give one row another kit (`In-Fusion`, `NEBuilder HiFi` or `Yeast assembly`); one that is not one of those fails that row.

**Done when:**

- [ ] Exercise 1 gave 4 designed and 1 failed, with 1 more row rejected before the run, and Exercise 2 an order sheet of 8 oligos.
- [ ] Exercise 3 gave 5 scan rows and 1 codon left out.
- [ ] Exercise 4 gave 3 Golden Gate constructs (3,029, 2,630 and 2,447 bp) and 1 failed row.

Next: back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).

## How it works

Background: [Batch design](../guide/10-primers.md#batch-design) and [Many inserts at once](../guide/12-cloning.md#many-inserts-at-once).

This is a **synthetic example** (invented sequence). `BP-Plasmid` is 923 bp, circular: `synthetic promoter` (1 to 120), `synthORF` (141 to 383, 81 codons, ATG to stop, starting `M C A E W N`), `synthetic terminator` (384 to 463) and an `ori` stand-in (524 to 923).

Each row is its own request to the analysis worker, in order, so the page stays usable and the table fills as rows finish; **Cancel** keeps the rows done. A pair row flanks its region (the region is the target, the primers lie outside it), so a region the whole plasmid cannot flank, or a product ceiling shorter than the region, fails. A row with `change` is a point mutation designed as the Cloning tab's mutagenesis designs it. The criteria are the Settings' primer criteria, and a row's `tm` is a window of 5 °C either side. The run, like the table, is kept in the page's memory only: a reload starts clean.

A `GG-gene` insert has no cloning ends; the batch designs them. For Golden Gate the part takes the overhangs of the destination (`GGAG` and `CGCT`, the backbone's ends), and the primer tails carry the BsaI site, padding and overhang in lower case, with the annealing part in upper case.
