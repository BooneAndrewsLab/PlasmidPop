# CRISPR: pick a guide, add guides as features, paired nickases, and prime editing

- **You will end with:** one SpCas9 guide picked out of nine and its two oligos to order; two guides saved as features with one undo; a pair of nickases that leaves a 40 nt 5′ overhang; and two pegRNAs for a one-base edit, the nearer one changing the PAM.
- **Time:** about 25 minutes.
- **Files:** [CR-Target.gb](files/CR-Target.gb) (synthetic, a plain download).
- **Before this:** nothing; [Before you start](before-you-start.md) helps if the sample files are new to you.

The **CRISPR** tab of the sidebar is a slim panel: the **Nuclease**, the guides it found and three doors. **Open CRISPR workspace ›** opens the rest beside the map, on three pages: **Guides**, **Pairs** and **Prime**. Each exercise starts from the same file, and the reference sections of the [CRISPR page](../guide/17-crispr.md) say the rest.

## Exercise 1 of 4: find a guide and pick it

You want one guide for the target, and the tab lists the guides without a known problem first.

1. Choose **File ▸ Open file…** and select `CR-Target.gb`. Close every other tab.

   > [!NOTE]
   > You see `CR-Target`, **600 bp**, linear, with one feature, `synthetic target`, in its **Features** list.

2. Click the **CRISPR** tab.

   > [!NOTE]
   > You see **Nuclease** on **SpCas9 (NGG)**, the line **9 guides, 5 without flags.** and five rows, each with its strand (→ or ←), the spacer with its PAM run on, the GC content and the off-target counts. The first is `TGTATACTCACTTGAGCGCT` with `TGG`, **45%**, **0·0·0·0**. The four guides with a `!` are not listed yet.

3. Click **Open CRISPR workspace ›**.

   > [!NOTE]
   > You see the workspace open on its **Guides** page, with **5 of 9** in its heading and, under the table, **5 guides listed, of 9 found. 5 of the 9 have no flags. Flagged guides are hidden; Show flagged lists them.** The head of the page says **Off-targets are counted in the open documents only.** and the rest of the warning; press **Got it** when you have read it, and from then on the dotted **Off-targets up to** label keeps it as a tooltip.

4. Press **Show flagged**.

   > [!NOTE]
   > You see **9 · 5 clean** in the heading and nine rows, with a `!` on four of them: the guides at **74–93**, **133–152**, **184–203** and **329–348**. Hover the `!` for the reason: **Binds somewhere else exactly** (74 and 329), **TTTT ends a U6 transcript** (133) and **Low GC** (184).

5. Click the row at **74–93**.

   > [!NOTE]
   > You see the guide in full beside the table, headed **Guide at 74 (forward)**: **Cut** **blunt, after base 90**, **GC** **50%**, **Specificity** **50 / 100** and **Flags** **Binds somewhere else exactly**. Under **Other sites** is one row, **exact**, **CR-Target**, **→ 329–348**: the same 20 bases are at the other guide. Two exact copies of a guide score 50.

   Click the row again to put the guide away, and press **Show flagged** again so that the flagged guides are hidden.

6. In **Spacer contains…** type `GCTCGAC`.

   > [!NOTE]
   > You see **1 of 9** in the heading and one row, **266–285**. The filter takes IUPAC codes, so it is also how to find a guide from a paper. With **Show flagged** pressed there are two rows: **133–152** has the same run too, and a TTTT.

7. Click the row at **266–285**.

   > [!NOTE]
   > You see **Guide at 266 (forward)**: **Spacer** `CATCAGCATTCATGCTCGAC`, **PAM** `TGG`, **Cut** **blunt, after base 282**, **GC** **50%**, **Specificity** **100 / 100** and **Flags** **none**. This is the guide to take.

8. Look under **Oligos to order**, with **Overhangs** on its first choice, **pX330 / lentiCRISPRv2 (CACC / AAAC, U6 G)**.

   > [!NOTE]
   > You see `CACCGCATCAGCATTCATGCTCGAC` and `AAACGTCGAGCATGAATGCTGATGC`: the spacer with `CACC` in front, a `G` added because the spacer does not start with one (the U6 promoter starts with G), and the reverse complement with `AAAC`. Choose **No overhangs** and they are the bare `CATCAGCATTCATGCTCGAC` and `GTCGAGCATGAATGCTGATG`.

9. Click **Copy oligos**, then **Save to My primers**.

   > [!NOTE]
   > **Copy oligos** puts both on the clipboard, one to a line. You see **Saved 2 oligos to My primers.** under the buttons; they can be exported with the rest of an order from [My primers](../guide/10-primers.md#my-primers).

**Done when:**

- [ ] The tab said 9 guides, 5 without flags, and **Show flagged** listed 9.
- [ ] The guide at 266 was open, with Specificity 100 / 100 and `CACCGCATCAGCATTCATGCTCGAC` as its top oligo.

Specificity here is an upper bound: PlasmidPop counts off-targets in the open documents only, so check a guide against the host genome with a genome-wide tool before ordering it.

## Exercise 2 of 4: add guides as features

A guide saved as a feature goes with the file, into GenBank, and onto the maps.

1. With the CRISPR workspace open on **Guides**, type `GCTCGAC` in **Spacer contains…** and click the row at **266–285**.

2. Click **Add as feature** beside the guide's name.

   > [!NOTE]
   > You see **Added 1 feature.** with an **Undo** beside it, and the workspace stays where it is. The Features list has a new `misc_feature` named **guide 266**, on the forward strand, with the note **CRISPR protospacer, TGG PAM**; rename it from the **Features** tab.

3. Click **Undo**.

   > [!NOTE]
   > You see the feature gone: `synthetic target` is the only one again.

4. Clear **Spacer contains…**, click `synthetic target` in the **Features** tab, then click the **CRISPR** tab. Tick **Only cuts in the selection**.

   > [!NOTE]
   > You see **Cuts in 231–300** under the box and the line **2 guides, 2 without flags.** Only guides whose cut falls inside the selected range are kept: **240–259** (←) and **266–285** (→). The box cannot be ticked until something is selected.

5. Click **Open CRISPR workspace ›**, then **Add all 2 listed as features**.

   > [!NOTE]
   > You see **2 · 2 clean** in the heading, and **Added 2 features.** with **Undo**. The features are **guide 240** (reverse strand) and **guide 266** (forward strand), beside `synthetic target`.

6. Click **Undo**.

   > [!NOTE]
   > You see both features taken back in one step.

**Done when:**

- [ ] **Add as feature** made **guide 266**, and **Undo** removed it.
- [ ] With **Only cuts in the selection** ticked the tab said 2 guides, and **Add all 2 listed as features** made guide 240 and guide 266.

When the list has been narrowed by a filter, the button reads **Add the N listed as features** instead of **Add all N listed as features**; either way it annotates exactly the rows in the table.

## Exercise 3 of 4: paired nickases

Two nicks on opposite strands make a double-strand break with less risk than one cut by a nuclease that cuts both. The pairs are of guides, and the page lists every pair that nicks close enough.

1. Untick **Only cuts in the selection**, then click **Paired nickases ›** in the tab.

   > [!NOTE]
   > You see the **Pairs** page, headed **Paired nickases**, with **5** on **Pairs** in the rail. **Nickase** is on **D10A (nicks the strand the guide pairs with)**, **Nicks at most (bp) apart** says **100**, and the line under the table says **5 pairs of guides nick within 100 bp of each other, the closest first. Select one to draw its two guides.**

2. Read the table.

   > [!NOTE]
   > You see the columns **#**, **Forward nick**, **Reverse nick**, **Apart (bp)** and **Overhang**, and five rows:
   >
   > | #   | Forward nick                     | Reverse nick                     | Apart (bp) | Overhang          |
   > | --- | -------------------------------- | -------------------------------- | ---------- | ----------------- |
   > | 1   | ← 414–433 `TGTCTAGAGTCTAAGTGCGA` | → 388–407 `CGTGTGATTCTCACGCACAT` | 12         | 12 nt 3′ overhang |
   > | 2   | ← 240–259 `ACTCTACTGTAGCGTTGATC` | → 266–285 `CATCAGCATTCATGCTCGAC` | 40         | 40 nt 5′ overhang |
   > | 3   | ← 240–259 `ACTCTACTGTAGCGTTGATC` | → 184–203 `TCATTAACAATTTGTCAGAC` | 42         | 42 nt 3′ overhang |
   > | 4   | ← 414–433 `TGTCTAGAGTCTAAGTGCGA` | → 329–348 `CTTCTCGCGTGAGCATCTAA` | 71         | 71 nt 3′ overhang |
   > | 5   | ← 240–259 `ACTCTACTGTAGCGTTGATC` | → 133–152 `GTTGTCGATTTTGCTCGACT` | 93         | 93 nt 3′ overhang |
   >
   > Row 1 is the guides at 388 and 414, whose PAMs face each other (**PAM-in**), and it leaves a 3′ overhang. Row 2 is the guides at 240 and 266, whose PAMs face away from each other (**PAM-out**), and it leaves a 5′ overhang, the arrangement reported to work best with D10A. The pairs are ranked by the distance between the nicks only; flagged guides are in them too.

3. Set **Nicks at most (bp) apart** to `50`.

   > [!NOTE]
   > You see **3 pairs of guides nick within 50 bp of each other, the closest first.** and **3** on **Pairs** in the rail: rows 1, 2 and 3. Make the box empty and it goes back to 100.

4. Click row **2**.

   > [!NOTE]
   > You see the span of both guides, **240–285**, selected in the views, and the two guides drawn as arrows labelled with their PAMs, `AGG` and `TGG`, in place of the others. The line under the table loses **Select one to draw its two guides.** Click the row again, or press `Escape` on it, to clear the selection.

5. Choose **H840A (nicks the PAM strand)** under **Nickase**.

   > [!NOTE]
   > You see the same five pairs at the same distances, **12**, **40**, **42**, **71** and **93**, with the overhangs the other way round: **12 nt 5′ overhang**, **40 nt 3′ overhang**, then 5′ for the rest. A nickase that nicks the other strand turns every 3′ overhang into a 5′ one and the other way round.

**Done when:**

- [ ] The page listed 5 pairs, and 3 with the limit at 50.
- [ ] Row 2 was the 40 nt 5′ overhang, and selecting it drew guides 240 and 266.

PlasmidPop does not score a pair, or check a nick for off-target nicking beyond what each guide's own row shows; see [Paired nickases](../guide/17-crispr.md#paired-nickases).

## Exercise 4 of 4: prime editing

You want to change one base, the first G of the `TGG` PAM of the guide at 388 (base 409), to a C.

1. Click **Prime editing ›** in the tab, or the **Prime** page of the workspace.

   > [!NOTE]
   > You see the page headed **Prime editing** with four boxes, **Edit at**, **Replace (bases)**, **With** and **PBS (nt)** (13), and the text **Give the position of the edit, how many bases it replaces and what goes in. pegRNAs are listed for guides whose nick is up to 30 bases before it.** Nothing is listed until an edit is given.

2. Type `409` in **Edit at**, `1` in **Replace (bases)** and `C` in **With**.

   > [!NOTE]
   > You see **2** on **Prime** in the rail and the line **2 pegRNAs for this edit, the nearest nick first. Select one for its parts to copy.** Under the columns **#**, **Guide**, **Nick**, **Distance**, **PBS**, **PAM changed** and a flag column, two rows:
   >
   > | #   | Guide                          | Nick | Distance | PBS             | PAM changed | (flag) |
   > | --- | ------------------------------ | ---- | -------- | --------------- | ----------- | ------ |
   > | 1   | → `CGTGTGATTCTCACGCACAT` `TGG` | 404  | 4        | `TGCGTGAGAATCA` | yes         |        |
   > | 2   | ← `TGTCTAGAGTCTAAGTGCGA` `TGG` | 416  | 7        | `CACTTAGACTCTA` |             | !      |
   >
   > The first is the guide at 388, whose nick falls after base 404, four bases before the edit; the edit also changes its PAM, which stops the edited site being nicked again. The second is the guide at 414 on the other strand, nicking after 416, seven bases away. Hover its `!`: **The template starts with C, which can pair with the scaffold; Primer binding site GC outside 40-60%.**

3. Click row **1**.

   > [!NOTE]
   > You see the guide's protospacer selected, and under the table **pegRNA for the guide at 388 (forward)**: **Nick** **after base 404, 4 before the edit**, **PAM** **changed by the edit**, and three parts, each with **Copy**: **PBS** `TGCGTGAGAATCA`, **RT template** `GTGCGATGGCGAATG` (the edit plus ten bases of homology) and **3′ extension** `GTGCGATGGCGAATGTGCGTGAGAATCA` (the template followed by the primer binding site). The views carry both guides as arrows and the edit as a tick labelled `C`.

4. Click **Copy spacer and extension**.

   > [!NOTE]
   > You see **Copied the spacer and extension.** On the clipboard are two lines, `CGTGTGATTCTCACGCACAT` and `GTGCGATGGCGAATGTGCGTGAGAATCA`: the two parts to order for the pegRNA. Add them to your scaffold.

5. Set **PBS (nt)** to `10`.

   > [!NOTE]
   > You see the primer binding sites shorten to `TGCGTGAGAA` and `CACTTAGACT`. The range is 8 to 17.

6. Type `560` in **Edit at** and `A` in **With**.

   > [!NOTE]
   > You see the page say **None of the guides found nicks within 30 bases upstream of the edit.** instead of a table: no nick is near enough.

7. Select base **409** in the sequence view, then press **Use the selection**.

   > [!NOTE]
   > You see **Edit at** `409` and **Replace (bases)** `1` again: the button takes the position and length of whatever is selected at that moment, and it is dimmed while nothing is.

**Done when:**

- [ ] The page listed 2 pegRNAs, at nicks 404 and 416.
- [ ] The first said **PAM changed** `yes`, with the PBS `TGCGTGAGAATCA` and the 3′ extension `GTGCGATGGCGAATGTGCGTGAGAATCA`.

PlasmidPop does not rank pegRNAs by predicted efficiency, and does not design the second nick of PE3; see [Prime editing](../guide/17-crispr.md#prime-editing).

Next: back to the [tutorials index](README.md).

## How it works

This is a **synthetic example** (invented sequence), so nothing here is a real target.

`CR-Target` is 600 bp, linear, with one feature, `synthetic target` (231–300). It was made from random sequence with no `GG` and no `CC` in it, so that the only SpCas9 guides are the nine that were written in: `TGG` and `AGG` PAMs at 23, 74 and 329 (the same spacer twice, so each is flagged), 133 (a `TTTT`), 184 (30% GC), 240 on the reverse strand with 266 on the forward (their PAMs face away from each other) and 388 on the forward strand with 414 on the reverse (their PAMs face each other). The other numbers on the page are what the scan, the pairing and the pegRNA design give for them.

Four words:

- **Guide:** a protospacer next to a PAM, on either strand; the **spacer** is its 20 bases for SpCas9, the **PAM** the `NGG` after it.
- **Flag:** a `!` for a known problem (an exact copy elsewhere, TTTT, low or high GC, a run of one base), not an efficiency prediction.
- **Nickase:** Cas9 that nicks one strand. D10A nicks the strand the guide pairs with; H840A the PAM strand.
- **pegRNA:** a guide with a 3′ extension: a template that carries the edit, and a primer binding site (**PBS**) that pairs with the DNA at the nick.
