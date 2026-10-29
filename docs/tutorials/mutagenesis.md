# Site-directed mutagenesis: a point mutation, a tag, a deletion and a new site

- **You will end with:** a point mutation, a tag, a deletion and a silent EcoRV site, each as primers plus the plasmid they make (the silent one is a 1,241 bp circle that a BamHI + EcoRV digest cuts into 965 and 276 bp), then a change the primers cannot reach and what the panel says about it.
- **Time:** about 25 minutes.
- **Files:** [SDM-Template.gb](files/SDM-Template.gb) (synthetic, a plain download).
- **Before this:** nothing; [Before you start](before-you-start.md) helps if the sample files or the enzyme ticks are new to you.

Mutagenesis works on the one document in front of you, so it is in the **Cloning** tab of the sidebar, beside **Digest** and **PCR**, not on the Bench. Each exercise starts from the template, not from the last mutant: close the mutants you open and keep `SDM-Template` as the tab to work in.

## Exercise 1 of 4: one amino acid, K14R

1. Choose **File ▸ Open** and select `SDM-Template.gb`. Close every other tab.

   > [!NOTE]
   > You see `SDM-Template`, **1,241 bp**, circular, as the only tab.

   > [!TIP]
   > The panel designs primers for the document in front of you, so the template must be the tab that is showing.

2. Open the **Enzymes** tab and click **Hide all**.
3. Type `BamHI` in **Filter** and tick it.

   > [!TIP]
   > You will see at the end that the mutant opens with the template's ticks, not with every enzyme that happens to cut it once.

4. Press `Ctrl+F`, type `AAGAACAGC` and press `Enter`.

   > [!NOTE]
   > You see both views scroll to the match, at bases 178 to 186, and select it.

5. Press `Esc` to close the bar.
6. In the sequence view, in the line of amino acids under the bases, click the **K** at the left of the match. If there is no amino-acid line, switch on **Translations** in the **Format** menu.

   > [!NOTE]
   > You see the status bar start `3 bp selected, 178 to 180`.

   > [!TIP]
   > Clicking an amino acid selects that residue's three bases and nothing else, which is what a change to one residue needs.

7. Click the **Cloning** tab and pick **Mutate** under **Reaction**.

   > [!NOTE]
   > You see **Change 3 bp at 178 (AAG).** and, under **Change a residue**, the heading note `synthORF K14 (AAG)`.

8. Under **To**, choose **R — Arginine** (the **Host** stays **E. coli**).

   > [!NOTE]
   > You see six codons: `CGC 40 % ★`, `CGT 38 %`, `CGG 10 %`, `CGA 6 %`, `AGA 4 %` and `AGG 2 %`.

9. Hover `AGG`, then click it. It changes 1 base; `CGC` changes 3.

   > [!TIP]
   > The star is the host's commonest arginine codon. AGG is the rarest in E. coli, but it keeps the change to a single base, the cleanest first example; for protein you mean to express you would choose CGC.

10. Read the panel. **Change to** now holds `AGG`, and the panel names the change in bold: **AAG178–180AGG** · `synthORF K14R`. The primers, written 5′ to 3′ as you would order them, are listed under **Forward** and **Reverse**:

    | Primer  | Sequence (upper case is new)    | Length | Tm               | NEB Q5 |
    | ------- | ------------------------------- | ------ | ---------------- | ------ |
    | Forward | `AGGaacagcctacgcctggcc`         | 21 nt  | 60 °C, 18 anneal | 71 °C  |
    | Reverse | `cggatttctagatatgttccacagacgcc` | 29 nt  | 61 °C, 29 anneal | 70 °C  |

    > [!NOTE]
    > You see a note under them: amplify the whole plasmid, **annealing at 71.3 °C (NEB's for Q5)**, then phosphorylate, ligate and digest the template (KLD).

    > [!TIP]
    > The forward primer begins with the new codon and anneals just after it; the reverse anneals to the bases just before it. They point away from each other and share no base, so the change is the join between them.

11. Click **Overlapping**.

    > [!NOTE]
    > You see the primers `catatctagaaatccgAGGaacagcctacgcctg` and `caggcgtaggctgttCCTcggatttctagatatg`, **34 nt, Tm 79 °C (Agilent)** each.

    The note says to copy the plasmid round, digest the template with DpnI and transform. Each primer is the reverse complement of the other, so they overlap along their whole 34 bases, with the new codon (and its complement, `CCT`) in the middle and 16 and 15 template bases either side.

12. Click **Back to back** to return.
13. Click **Open mutant**.

    > [!NOTE]
    > You see a new tab, `SDM-Template AAG178–180AGG`, with the **Features** tab in front.

14. Open the **Enzymes** tab.

    > [!NOTE]
    > You see only `BamHI` ticked, as on the template.

15. Press `Ctrl+Z` once, then `Ctrl+Shift+Z`.

    > [!NOTE]
    > You see the template's base come back, then the change again.

    > [!TIP]
    > The mutant is the template with the change as its one edit, so undo works, and it keeps the ticks you had: that is what lets the check digest in Exercise 3 start from enzymes you chose.

- [ ] The mutant is **1,241 bp**, circular, with a forward primer of **21 nt** and a reverse of **29 nt**.

> [!WARNING]
> If not: check that the K is selected (**Change 3 bp at 178 (AAG).**) and that `AGG` is in **Change to**.

> [!TIP]
> The change is called `AAG178–180AGG`, three bases to three bases, though only the middle base differs (179, A to G): the panel names what you selected, not what changed. With **Edits** on in the toolbar the changed base is marked. And the two designs disagree about Tm (60 and 61 against 79) because they measure different things: the annealing part against the template by nearest neighbour, and the whole primer by Agilent's formula. Neither is wrong, and the two numbers are not to be compared.

## Exercise 2 of 4: a short insertion and a deletion

Two changes, one after the other, each made on the template. Close the mutant from Exercise 1 first, and make `SDM-Template` the tab showing.

### An insertion: a His tag before the stop codon

1. Press `Ctrl+F`, type `CTGGTGGAAGTA` and press `Enter`.

   > [!NOTE]
   > You see the match run from base 427 to 438, the last residue (V, number 100) being its last three bases.

2. Press `Esc`, then the `→` key.

   > [!NOTE]
   > You see the status bar read `Cursor after base 438`.

   > [!TIP]
   > The arrow collapses the selection to a cursor at its right end, which is where the tag goes: after the last residue, in front of the stop.

3. In the **Cloning** tab, with **Mutate** picked, read the panel.

   > [!NOTE]
   > You see **Insert after base 438.** and the box now labelled **Bases to insert**.

4. Type `CACCACCACCACCACCAC` (six CAC codons) in **Bases to insert**.

   > [!NOTE]
   > You see the change named **+CACCACCACCACCACCAC after 438** · `synthORF 101 (none) → HHHHHH`.

   > [!TIP]
   > Every codon is CAC, histidine, and 18 is a multiple of three, so the insertion stays in frame. Residue 101 was the stop and held no amino acid, which is why the gain reads `101 (none) → HHHHHH`.

5. Read the back-to-back primers:

   | Primer  | Sequence (upper case is new)             | Length | Tm               | NEB Q5 |
   | ------- | ---------------------------------------- | ------ | ---------------- | ------ |
   | Forward | `CACCACCACCACCACCACtaaggatgcggtcccctggt` | 38 nt  | 60 °C, 20 anneal | 71 °C  |
   | Reverse | `tacttccaccagaagacggtaactgc`             | 26 nt  | 61 °C, 26 anneal | 70 °C  |

   > [!NOTE]
   > You see the note give **annealing at 71.1 °C**.

   > [!TIP]
   > The whole tag rides on the forward primer's 5′ tail (an insert over 20 bases would be split between the two). The 18 new bases are not part of the annealing Tm.

6. Click **Open mutant**.

   > [!NOTE]
   > You see a tab `SDM-Template +CACCACCACCACCACCAC after 438`, **1,259 bp** (1,241 + 18).

7. Open its **Features** tab.

   > [!NOTE]
   > You see `synthORF` now run 139 to 459, and the terminator follow it at 460 to 539.

- [ ] The mutant is **1,259 bp**, circular, and the translation ends `…LLVEV` then **HHHHHH** then the stop: **106** residues, where the template has 100.

> [!WARNING]
> If not: check that the cursor was after base 438 and that all 18 bases are in **Bases to insert**.

### A deletion: one residue gone

1. Close the mutant, and make `SDM-Template` the tab showing.
2. Press `Ctrl+F`, type `AGTTGTGAAATG`, press `Enter`, then `Esc`.

   > [!NOTE]
   > You see the match, bases 310 to 321, the codons for S, C, E and M.

3. Click the **E** on the amino-acid line.

   > [!NOTE]
   > You see the three bases at 316 to 318 selected and the panel say **Change 3 bp at 316 (GAA).**

4. Do not type anything: **Change to** reads `leave empty to delete`.

   > [!NOTE]
   > You see the deletion already designed: **Δ316–318** · `synthORF 60 E → (none)`.

   > [!TIP]
   > An empty box is the change. It is also why a selection you have not decided about already shows primers: they are for deleting it.

5. Read the primers: `atgtttatgtctctctgtggtaagtggcc` (29 nt, Tm 61 °C, NEB Q5 70 °C, all 29 anneal) and `acaactcatgaaaagctgggtagctttt` (28 nt, 60 °C, 68 °C, all 28 anneal), **annealing at 69.5 °C**.

   > [!NOTE]
   > You see both in lower case: a deletion puts no new base into either primer.

6. Click **Open mutant**.

   > [!NOTE]
   > You see a tab `SDM-Template Δ316–318`, **1,238 bp**.

- [ ] The mutant is **1,238 bp**, circular, and `synthORF` runs **139 to 438**, 300 bases.

> [!WARNING]
> If not: check that only the E (316 to 318) was selected and **Change to** is empty.

## Exercise 3 of 4: a silent change that makes a site

A change that costs the protein nothing and gives the DNA a restriction site, so that a miniprep digest tells the mutant from the template.

1. Close the mutants. With `SDM-Template` showing, press `Ctrl+F`, type `GATATTCAG`, press `Enter`, then `Esc`.

   > [!NOTE]
   > You see bases 256 to 264 selected, the codons for D, I and Q.

2. In the **Enzymes** tab type `EcoRV` in **Filter** and tick it.

   > [!NOTE]
   > You see no EcoRV cut: the template has no EcoRV site.

   > [!TIP]
   > EcoRV cuts `GAT^ATC`, and the template reads `GATATT`, one base from it.

3. Click the **I** on the amino-acid line, the second of the three.
4. In the **Cloning** tab, under **Mutate**, read the panel.

   > [!NOTE]
   > You see **Change 3 bp at 259 (ATT)** and the heading note `synthORF I41 (ATT)`.

5. Under **To**, choose **I — Isoleucine (as now)**.
6. Click `ATC`, the codon that changes one base.

   > [!TIP]
   > ATT and ATC both code for isoleucine, and the T to C turns `GATATT` into `GATATC`.

7. Read the panel.

   > [!NOTE]
   > You see the change named **ATT259–261ATC** · `synthORF no change (silent)`.

8. Read the primers: forward `ATCcagtggctttcttacgtttatttacgaaaagc` (35 nt, Tm 60 °C, NEB Q5 68 °C, 32 anneal) and reverse `atcacaggggaccatccggt` (20 nt, Tm 60 °C, NEB Q5 71 °C, 20 anneal), **annealing at 68.6 °C**.

   > [!TIP]
   > The forward primer is longer than in Exercise 1 and its annealing part is 32 bases, not 18: the panel keeps adding bases until the annealing part reaches 60 °C, and the bases here are less GC-rich.

9. Click **Open mutant**.

   > [!NOTE]
   > You see `SDM-Template ATT259–261ATC`, 1,241 bp, with `BamHI` and `EcoRV` ticked in the **Enzymes** tab.

10. Look at the map and the sequence view.

    > [!NOTE]
    > You see `EcoRV` once, at 256 to 261, and `BamHI` once, at 534 to 539.

11. Click the **Cloning** tab and pick **Digest**.

    > [!NOTE]
    > You see **2 fragments**, largest first: **965 bp** and **276 bp**.

    > [!WARNING]
    > If the digest lists more enzymes than these two, others are ticked: only `BamHI` and `EcoRV` should be. A template you open fresh has every enzyme that cuts it once ticked; Exercise 1 cleared them and ticked `BamHI`.

12. Switch to the template's tab.

    > [!NOTE]
    > You see the same digest say **1 fragment**, 1,241 bp, because only BamHI cuts it.

    > [!TIP]
    > This is the check. A circle cut twice gives two bands (EcoRV cuts between 258 and 259, BamHI between 534 and 535, and 276 is the stretch between them); one cut gives one band the size of the whole plasmid.

13. In the mutant, untick `BamHI`.

    > [!NOTE]
    > You see one fragment of 1,241 bp, from the EcoRV cut alone.

- [ ] The mutant is **1,241 bp**, circular, with `GATATC` at **256 to 261**, and BamHI + EcoRV give **965 and 276 bp**.

> [!WARNING]
> If not: check that `ATC` (not `ATT`) is in **Change to** and that both enzymes are ticked.

> [!TIP]
> The panel calls the change **silent** and yet the plasmid is not the template: protein is the one thing that did not change. One base differs from the template, at 261 (T to C), and the translation is identical, residue 41 still I.

## Exercise 4 of 4: a change the primers cannot reach

The panel always gives a design, and says so when it falls short.

1. Close the mutants. With `SDM-Template` showing, press `Ctrl+F`, type `AAATATAAAATA`, press `Enter`, then `Esc`.

   > [!NOTE]
   > You see the match, inside the AT-rich spacer (90 bases with no G or C).

2. Press `→`.

   > [!NOTE]
   > You see the status bar read `Cursor after base 590`.

3. Hold `Shift` and press `→` once.

   > [!NOTE]
   > You see one base selected, the **A** at 591, and the panel say **Change 1 bp at 591 (A).**

4. Type `G` in **Change to**.

   > [!NOTE]
   > You see the change named **A591G**, and, as it is not in a coding region, no protein change after it.

5. Read both primers: a forward of **61 nt** and a reverse of **60 nt**, Tm **55** and **57 °C** (NEB Q5 **60** and **63 °C**), every annealing base from the template.

   > [!NOTE]
   > You see a warning line: **The template next to the change is too AT-rich to reach 60 °C within 60 bases.**

   > [!TIP]
   > The longest primer the panel will write is 60 bases of annealing part, and in a stretch of only A and T that is not enough to reach 60 °C. The design is shown rather than refused, so you can see how far short it is.

6. Click **Overlapping**.

   > [!NOTE]
   > You see a warning line again: **The primers reach only 69 °C at 60 bases, short of the 78 °C QuikChange asks for.**

7. Select the codon at 178 to 180 as in Exercise 1 and type `AGG`, then look at **Back to back** and **Overlapping**.

   > [!NOTE]
   > You see the same two designs with no red line.

   > [!TIP]
   > The failure is where the change is, not the method.

- [ ] Both designs at base 591 carry a warning, and neither does at the codon 178 to 180.

> [!WARNING]
> If not: check that **Change to** holds `G` and that the **A** at 591 is the one base selected.

The way out is to move the change if you can, or to accept a lower annealing temperature and say so in the lab; the panel does not decide that for you. And when the box has a character that is not a base, a note under it says what was left out (_Left out, not bases: “#”._), so a change that came out shorter than you typed says why.

**Done when:**

- [ ] Each mutant opens as `SDM-Template` with its one edit (1,241, 1,259, 1,238 and 1,241 bp, circular).
- [ ] The silent mutant's digest with BamHI + EcoRV gives **965 and 276 bp**, where the template gives one 1,241 bp band.

Next: back to the [tutorials index](README.md).

## How it works

This is a **synthetic example** (invented sequence). PlasmidPop designs the primers and shows the plasmid they make; it does not simulate the PCR, the KLD or the DpnI step. There is no NCBI gene path in this tutorial: a gene you fetch from NCBI is mutated the same way, step for step.

`SDM-Template` is 1,241 bp, circular: `synthetic promoter` (1–120), `synthORF` (139–441, 100 codons and a stop), `synthetic terminator`, `AT-rich spacer` (552–641), `AmpR` and `ori` stand-ins. `synthORF` starts `MARGRLWNISRNPK` (residue 14 is a lysine, AAG at 178–180) and ends `…LLVEV`, then the stop. Residue 41 is an isoleucine, `GATATT` (bases 256–261) is a hair from an EcoRV site, and a BamHI site sits at 534–539, after the terminator. The spacer is 90 bases of only A and T, which is what the last exercise is about. There is no EcoRV site anywhere in the template.

Seven words:

- **Mutagenic primer**: a primer whose bases differ from the template at the change. Mutagenesis needs two, one for each strand, and the whole plasmid is copied with them.
- **Back to back**: NEB's Q5 site-directed mutagenesis design (the panel's default). The two primers point away from each other and meet at the change, which rides on the 5′ end of the forward one. They do not overlap. After the PCR the linear product is phosphorylated, ligated and the template digested (**KLD**).
- **Overlapping**: Agilent's QuikChange design. The two primers are each other's reverse complement, with the change in the middle, so they overlap along their whole length. The plasmid is copied round and the template is digested with **DpnI**.
- **Annealing part**: the 3′ end of a primer that pairs with the template. In the panel the new bases are in upper case and the annealing part in lower.
- **Tm**: the melting temperature of the annealing part (nearest neighbour, as elsewhere in the app). For back to back the panel grows each annealing part until it reaches 60 °C and also shows **NEB Q5**, the Tm NEB's own calculator gives for that enzyme, a few degrees higher.
- **Silent change**: a different codon for the same amino acid. The protein is untouched, but the DNA is not.
- **Check digest**: cutting the clone with enzymes to see bands that tell the mutant from the template. A silent change that makes or breaks a site gives you one without sequencing.

[Site-directed mutagenesis](../guide/12-cloning.md#site-directed-mutagenesis) in the user guide also covers a library at a codon (**NNK**, **NNS**, **NNN**, **NDT**), a change at the end of a linear sequence, and a change across the origin of a circle. The design note is item 47 (`docs/design/47-mutagenesis.md`).
