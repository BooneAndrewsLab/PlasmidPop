# Enzymes: cut once, a double digest, and methylation

- **You will end with:** the enzymes that cut a 600 bp plasmid once, found and read in the table; a double digest of EcoRI and BamHI that gives 390 and 210 bp; and XbaI and MscI, two enzymes whose sites the host's Dam and Dcm methylation blocks, cut or not cut by a change under **Grown in**.
- **Time:** about 20 minutes.
- **Files:** [EN-Plasmid.gb](files/EN-Plasmid.gb) (synthetic, a plain download).
- **Before this:** nothing; [Before you start](before-you-start.md) helps if the sample files are new to you.

The **Enzymes** tab of the sidebar is a slim panel; **Open Enzyme workspace ›** opens the rest beside the map, on four pages: **Enzymes**, **Digest**, **Double** and **Table**. Each exercise starts from the same file, and the reference sections of the [Enzymes page](../guide/07-enzymes.md) say the rest.

## Exercise 1 of 3: enzymes that cut once

A unique site is what you clone into, and the enzymes that cut once are the ones to look for.

1. Choose **File ▸ Open file…** and select `EN-Plasmid.gb`. Close every other tab.

   > [!NOTE]
   > You see `EN-Plasmid`, **600 bp**, circular, with a `synthetic promoter`, a `synthetic cassette` and a `synthetic terminator` in its **Features** list.

2. Click the **Enzymes** tab.

   > [!NOTE]
   > You see **127 enzymes: 21 cut once, 16 more than once, 90 not at all. 21 ticked. 1 ticked site blocked by Dam/Dcm (grown in dam+/dcm+).** A document opens with the enzymes that cut once ticked, so their sites are already on the map. The blocked site is explained in Exercise 3.

3. Click **Open Enzyme workspace ›**.

   > [!NOTE]
   > You see the workspace open on its **Enzymes** page (the first time; it opens on the page it was left on), with **37 of 127** in its heading: the 21 that cut once and the 16 that cut more than once. **Grown in** is in the head, set to **dam+/dcm+**.

4. Set **Cuts** to **Once**.

   > [!NOTE]
   > You see **21 of 127** in the heading and 21 rows. The line under the table says **21 of 127 enzymes cut once. 90 do not cut.**

5. Find **EcoRI**, **BamHI** and **HindIII** in the table.

   > [!NOTE]
   > You see each with **Cuts** 1, and the base its cut falls after under **Positions**: EcoRI **91**, BamHI **301**, HindIII **451**. All three leave a **5′** overhang, and each on its own gives one band of **600 bp**, because a circle cut once is one piece.

6. Click **91** on the EcoRI row.

   > [!TIP]
   > Clicking a position selects that recognition site in the views. A row anywhere else opens the enzyme in full beside the table: every site, with ten bases either side, and its lane alone on a gel.

7. Set **Cuts** to **Twice**.

   > [!NOTE]
   > You see six rows, among them **XbaI**: two cuts, at **193** and **542**, giving **349 + 251 bp**. **HpaII** and **MspI** share a row, because they cut the same site in the same place. Two bands is what a **diagnostic digest** is checked against; set **Cuts** back to **Any number** when you are done.

**Done when:**

- [ ] The tab said 21 enzymes cut once, and the table with **Once** listed 21.
- [ ] EcoRI, BamHI and HindIII each cut once, at 91, 301 and 451.

Look at the **MscI** row while **Cuts** is on **Once**: it cuts once, at **385**, but its position carries a small **m** and **Dam/Dcm** says **1 of 1**. A unique site is not always a usable one; Exercise 3 is about that.

## Exercise 2 of 3: a double digest, and reading the gel

You want to cut the plasmid with EcoRI and BamHI, to see the 210 bp piece between them.

1. Click **Hide all**, so that nothing is ticked.

   > [!NOTE]
   > You see every tick box in the table clear.

2. In the **Filter** box type `EcoRI`, and click the EcoRI row (anywhere but its tick box or its position).

   > [!NOTE]
   > You see EcoRI beside the table: **GAATTC · 5′ overhang · cuts once**, with **Tick** and **Find a partner ›** above its site.

3. Click **Find a partner ›**.

   > [!NOTE]
   > You see the **Double** page, with **Pair** set to **EcoRI**, and a table of **Enzyme 1**, **Enzyme 2** and **Bands**. The first rows are EcoRI with SspI (**439 + 161 bp**), XbaI (**451 + 149 bp**) and BstEII (**482 + 118 bp**), and the fourth is **EcoRI** and **BamHI**, **390 + 210 bp**.

   > [!TIP]
   > The order is the app's rule for how easily the bands read, described under [Choosing a diagnostic digest](../guide/07-enzymes.md#choosing-a-diagnostic-digest); it is not the order of the sizes. XbaI is listed with one cut, because its Dam-blocked site is not cut in this host: that is Exercise 3.

4. Click the **EcoRI** and **BamHI** row.

   > [!NOTE]
   > You see a gel under the table with three lanes, **EcoRI**, **BamHI** and **Both**, and the line **EcoRI + BamHI, beside each enzyme alone. Select another pair to draw its lanes; the ticks are not changed.** Each enzyme alone gives one band of 600 bp; together, **390** and **210**.

5. Click **Tick both** on that row.

   > [!NOTE]
   > You see the button read **Ticked**. EcoRI and BamHI are now the only enzymes ticked.

6. Click the **Digest** page.

   > [!NOTE]
   > You see two chips, **BamHI** and **EcoRI**, and the gel with the same three lanes. The line under it says **On a gel: 2 bands, 390 + 210 bp.** and the one above it **Beside it, each alone: BamHI 600 bp; EcoRI 600 bp.**

7. Read the table of fragments.

   > [!NOTE]
   > You see **2 fragments, largest first.** Piece 1 is **390 bp**, spanning **302–91** (round the origin), from BamHI to EcoRI, carrying the promoter, the cassette and the terminator. Piece 2 is **210 bp**, spanning **92–301**, from EcoRI to BamHI, carrying `synthetic cassette`.

8. Click the **210** band on the gel.

   > [!TIP]
   > Clicking a band selects that piece in the sequence view and on the map. A band in **Both** that is in neither single lane is the piece between the two sites, and that is the 210 bp one here (the 390 bp piece is what is left of the plasmid). **Add** puts a piece on the shelf for the Bench.

**Done when:**

- [ ] The Double page listed EcoRI with BamHI at 390 + 210 bp.
- [ ] The Digest page's table has two pieces, 390 bp and 210 bp, at 302–91 and 92–301.

## Exercise 3 of 3: methylation

Most laboratory _E. coli_ methylate the A of every GATC (Dam) and the inner C of CCAGG and CCTGG (Dcm), and some enzymes will not cut where that lands in their site. `EN-Plasmid` has both: an XbaI site inside a GATCTAGA (Dam) and an MscI site inside a CCTGGCCA (Dcm).

1. Click **Enzymes** in the rail, and with **Cuts** on **Any number**, type `XbaI` in the **Filter** box.

   > [!NOTE]
   > You see one row: **XbaI**, **TCTAGA**, **5′**, **Cuts** 2, positions **193** (with an **m**) and **542**, **Dam/Dcm** **1 of 2**, and bands **349 + 251 bp**. That is what the sequence says; the host decides whether it happens.

2. Click the row.

   > [!NOTE]
   > You see **1 of 2 sites may be blocked by Dam/Dcm methylation**, and a table of its sites in which the one cut after **193** has **Dam** in its **Dam/Dcm** column, and the one after **542** has nothing.

3. Click **Hide all**, tick the box on the XbaI row, then click the **Digest** page.

   > [!NOTE]
   > You see one chip, **XbaI**, and **1 fragment, largest first.** One piece of **600 bp**, **543–542**, with the same XbaI end on both sides, and **On a gel: 1 band, 600 bp.** Under the table is **1 site of XbaI is left out: EN-Plasmid is dam+/dcm+, and its methylation blocks it.** The plasmid is cut once, not twice.

4. Under **Grown in**, choose **unmethylated**.

   > [!NOTE]
   > You see **2 fragments**: **349 bp** (194–542) and **251 bp** (543–193), and **On a gel: 2 bands, 349 + 251 bp.** The note about the left-out site is gone. Plasmid made by PCR, or grown in a `dam− dcm−` strain, gives this digest.

5. Choose **dam+ only**, then **dcm+ only**.

   > [!NOTE]
   > With **dam+ only** XbaI is blocked again: one piece, 600 bp. With **dcm+ only** it cuts twice, 349 + 251 bp, because the XbaI site is Dam's and not Dcm's.

6. Choose **dam+/dcm+** again. Click **Enzymes**, then **Hide all**, type `MscI` in the **Filter** box, tick the box on its row, and click the **Digest** page.

   > [!NOTE]
   > You see one chip, **MscI**, and no table: **Every site of MscI in EN-Plasmid is blocked by its dam+/dcm+ methylation, so nothing is cut. If the DNA came from a dam−/dcm− strain or a PCR, say so under Grown in above.**

7. Choose **dam+ only** under **Grown in**.

   > [!NOTE]
   > You see MscI cut: **1 fragment**, **600 bp**, **386–385**, with **MscI blunt** at both ends. MscI's site is Dcm's, so a host with Dam alone does not block it. With **dcm+ only** it is blocked again, and the page says so with the host's name.

**Done when:**

- [ ] In **dam+/dcm+** XbaI gave one piece of 600 bp, and in **unmethylated** two, 349 and 251 bp.
- [ ] MscI cut nothing in **dam+/dcm+**, and once, 600 bp, in **dam+ only**.

Changing **Grown in** is an edit like any other, so **Undo** takes it back, and it is saved with the document. The Enzymes tab says how many ticked sites are blocked, in its status line, and the double digests leave an enzyme out as a partner if its only site is blocked. See [Where the DNA was grown](../guide/07-enzymes.md#where-the-dna-was-grown).

Next: back to the [tutorials index](README.md).

## How it works

This is a **synthetic example** (invented sequence), so nothing here is a real plasmid.

`EN-Plasmid` is 600 bp, circular: `synthetic promoter` (11–80), `synthetic cassette` (101–450) and `synthetic terminator` (561–600). Six sites were written into an otherwise random sequence and the rest checked: EcoRI `GAATTC` (cut after base 91), XbaI `TCTAGA` inside `GATCTAGA` (cut after 193), BamHI `GGATCC` (301), MscI `TGGCCA` inside `CCTGGCCA` (385), HindIII `AAGCTT` (451) and a second XbaI site inside `GTCTAGAC` (542). The other enzymes that cut once or twice cut where the random sequence happens to have their sites, and the counts on the page are what the bundled table of 127 enzymes finds.

Four words:

- **Cuts:** how many times the enzyme cuts this DNA, from the sequence alone, whatever the host.
- **Band:** a fragment, or fragments within about 15% of each other, as a gel would show them.
- **Dam and Dcm:** the methylation of GATC and of CCAGG and CCTGG in most laboratory _E. coli_. A site is **marked** whatever the host is; **Grown in** decides whether the mark blocks the cut.
- **Grown in:** where the DNA was grown: **dam+/dcm+**, **dam+ only**, **dcm+ only** or **unmethylated**.
