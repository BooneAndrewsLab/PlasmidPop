# Modular cloning: a transcription unit from level-0 parts

A promoter, a coding part and a terminator, each made for its own position in
the MoClo standard, go into a level-1 destination vector in one reaction. Then
two promoters and two coding parts give four constructs from one plan. About 25
minutes. Do [Golden Gate: one gene into one vector](golden-gate.md) first: the
reaction is the same one, and this page only adds the standard on top of it.
Read [Before you start](before-you-start.md) if the Bench or the sample files
are new to you.

**Files for this tutorial** (synthetic, plain downloads):
[MC-L1-Destination.gb](files/MC-L1-Destination.gb),
[MC-L0-Promoter-A.gb](files/MC-L0-Promoter-A.gb),
[MC-L0-Promoter-B.gb](files/MC-L0-Promoter-B.gb),
[MC-L0-CDS-A.gb](files/MC-L0-CDS-A.gb),
[MC-L0-CDS-B.gb](files/MC-L0-CDS-B.gb),
[MC-L0-Terminator.gb](files/MC-L0-Terminator.gb),
[MC-wrong-position.gb](files/MC-wrong-position.gb). Every file is a
**synthetic example** (invented sequence), and every number below is checked by
`src/core/cloning/modularTutorial.test.ts` and
`src/app/components/ModularTutorial.test.tsx`, which run these same files
through the functions the Modular panel uses.

### Six words

- **Standard**: an agreed list of **positions** (Promoter, CDS, Terminator...),
  each with the two overhangs a part for it is cut with. This page uses the
  **MoClo plant common syntax**, one of the two standards bundled with
  PlasmidPop (the other is the Yeast Toolkit, YTK). The panel carries only the
  overhang sequences, which are published facts; it holds no parts.
- **Level 0 part**: one genetic element (a promoter, a coding sequence, a
  terminator) with the overhangs of its position, released from its plasmid by
  BsaI. Here each part is a small linear file: the part, a BsaI site at each
  end pointing inwards, and a few bases of flank.
- **Level 1**: the reaction that joins level-0 parts, in position order, into
  one transcription unit in a **destination vector**. The destination's two
  BsaI sites sit inside a `lacZ-dropout` and point outwards, so cutting throws
  the dropout away and leaves a backbone whose two ends take the first and the
  last position.
- **Overhang**: the 4 single-stranded bases a cut leaves. Two ends join only
  when their overhangs match.
- **Position**: where a part goes in the unit. The panel reads it from the
  part's own overhangs.
- **Plan**: one slot per position that has a part, plus the destination. Two
  parts in one slot are alternatives, and the plan makes every way of choosing
  one per slot.

## The standard's three positions

MoClo plant common syntax has more positions than this page uses (a split
promoter and 5′UTR, N- and C-terminal parts of a CDS). The three used here, with
the overhangs BsaI leaves on a part for each:

| Position           | Left overhang | Right overhang |
| ------------------ | ------------- | -------------- |
| Promoter + 5′UTR   | `GGAG`        | `AATG`         |
| CDS                | `AATG`        | `GCTT`         |
| 3′UTR + terminator | `GCTT`        | `CGCT`         |

The right overhang of one position is the left overhang of the next, so the
parts can only chain in one order: `GGAG`, promoter, `AATG`, CDS, `GCTT`,
terminator, `CGCT`. The destination's backbone ends are `CGCT` and `GGAG`, which
closes the ring. That is the whole idea of the standard: because every promoter
is cut with `GGAG`...`AATG`, any promoter fits any CDS, and parts made by
different people interchange. A part cut with the wrong overhangs does not
belong at a position, and the panel will not place it there (step 10). The
`ATG` that ends `AATG` is the start codon of the CDS.

Two levels, one tutorial: here the **level-0** parts are joined into a **level-1**
unit. A real kit then joins several level-1 units into a level-2 construct with a
second enzyme (BpiI/BbsI, so that the BsaI sites left in the level-1 vectors are
not cut). The panel plans one level at a time; open the level-1 product, choose
the other enzyme on the Bench, and the same steps do the next level. That is not
done here.

## First half: one transcription unit

The parts, as the files have them (lengths are of the whole file, flanks
included):

| File              | Document name        | Length   | Overhangs       | Feature                       |
| ----------------- | -------------------- | -------- | --------------- | ----------------------------- |
| MC-L1-Destination | `pMC-L1-Destination` | 1,572 bp | `CGCT`...`GGAG` | `AmpR`, `ori`, `lacZ-dropout` |
| MC-L0-Promoter-A  | `MC-L0-PromA`        | 96 bp    | `GGAG`...`AATG` | `synthetic promoter A`        |
| MC-L0-CDS-A       | `MC-L0-CdsA`         | 326 bp   | `AATG`...`GCTT` | `synthCDS A`                  |
| MC-L0-Terminator  | `MC-L0-Term`         | 92 bp    | `GCTT`...`CGCT` | `synthetic terminator`        |

The destination is circular and the parts are linear. BsaI cuts the destination
twice and every part twice; no other Type IIS enzyme in the bundled set cuts any
file.

1. **File ▸ Open**, select `MC-L1-Destination.gb`, `MC-L0-Promoter-A.gb`,
   `MC-L0-CDS-A.gb` and `MC-L0-Terminator.gb` (or drag them onto the window).
   Close every other tab.
   _Why: the Modular panel puts every open document in the plan._
2. Click the **Bench** tab, then **Modular** at the top of the middle column.
   The heading reads **Modular cloning**, with `a standard, a plan` beside it.
   _Why: this is the Golden Gate reaction with positions._
3. **Standard: MoClo plant common syntax**. Under it the paper it comes from is
   named (Weber et al. 2011; Patron et al. 2015). **Enzyme** reads **BsaI**,
   which the standard starts it on, and **and** stays **no other**.
   _Why: the parts were cut for BsaI; the enzyme must be the one that makes
   their overhangs._
4. The parts list under the enzyme pickers shows the four documents, each with
   its tick box ticked.
5. Under **Positions**, each document has a menu that opens on what the panel
   found:
   - `pMC-L1-Destination`: **Detected: Destination**
   - `MC-L0-PromA`: **Detected: Promoter + 5′UTR**
   - `MC-L0-CdsA`: **Detected: CDS**
   - `MC-L0-Term`: **Detected: 3′UTR + terminator**

   _Why: the panel digests each document and reads the overhangs of the piece
   BsaI releases. You never tag a part by hand unless it cannot find one._

6. Below that, the plan lists four slots, destination first, then in position
   order:
   - **Destination** `CGCT-GGAG · pMC-L1-Destination`
   - **Promoter + 5′UTR** `GGAG-AATG · MC-L0-PromA`
   - **CDS** `AATG-GCTT · MC-L0-CdsA`
   - **3′UTR + terminator** `GCTT-CGCT · MC-L0-Term`

   _Why: each slot's right overhang meets the next slot's left one, and the
   last meets the destination's first. A slot that met nothing would be
   reported here, before the reaction._

7. The summary line above the products reads **1 combination: 1 assemble.** The one product is
   named `pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term` and its
   detail line reads **1,702 bp circle**. No overhang warning appears.
8. Click **Assemble** beside it.
   _Why: it opens the product as a new tab, with the parts it was made from in
   its history._
9. The new tab is `pMC-L1-Destination+MC-L0-PromA+MC-L0-CdsA+MC-L0-Term assembly`.
   Open its **Features** tab and its **Enzymes** tab and tick through the
   checklist below.

**Did it work?**

- [ ] Product **1,702 bp**, **circular**.
- [ ] Features: `AmpR`, `ori`, `synthetic promoter A`, `synthCDS A`,
      `synthetic terminator`, and **no** `lacZ-dropout` and no `BsaI site`.
- [ ] **BsaI** is ticked in the Enzymes tab (the Bench's enzyme, as the product
      opens), but it has **0 sites** in the product, so nothing is marked: the
      vector had 2, and the cut threw them away with the dropout.
- [ ] The three parts run in order on the strand: promoter, then `synthCDS A`,
      then terminator.
- [ ] `synthCDS A` is one open reading frame of **100 residues** and a stop
      (303 bp), starting on the `ATG` of the `AATG` junction.

**Looks odd, is right.** The sizes add up less than you might expect: the
backbone BsaI leaves is 1,254 bp, the parts 74, 304 and 70 bp, and
1,254 + 74 + 304 + 70 = 1,702. Each junction's four overhang bases are in the
product once, not twice, one from each neighbour. On the map, one base, the `A`
of `AATG`, lies between the end of `synthetic promoter A` and the start of
`synthCDS A`, which begins on the `ATG`. And `GCTT` follows the stop codon
directly and starts `synthetic terminator`: the four bases are the junction, not
extra sequence.

### One part at the wrong position

`MC-wrong-position.gb` (document `MC-L0-YTK-Type3`, 106 bp) is a part cut for
position Type 3 of the Yeast Toolkit: overhangs `TATG`...`ATCC`. It is valid in
YTK, and has no place in MoClo plant syntax.

10. Open `MC-wrong-position.gb` as well. In the panel, its menu under
    **Positions** reads **Detected: none found**, and a note says **Not placed:
    MC-L0-YTK-Type3. Their ends match no position of MoClo plant common syntax
    with BsaI; set one by hand, or leave them out.** the summary line still reads
    **1 combination: 1 assemble.**: an unplaced part is not in the plan, so it
    cannot break it.
    _Why: the panel only places a part whose two overhangs are one position's.
    Anything else, a part from another kit or one with a typo in an overhang,
    stays out and is named._

    Now force it. Open that menu and choose **CDS AATG-GCTT**. The slot **CDS**
    now lists both coding parts and the summary line reads **2 combinations: 1
    assemble, 1 cannot form.** Cannot-form rows come first. Its line reads
    `pMC-L1-Destination + MC-L0-PromA + MC-L0-YTK-Type3 + MC-L0-Term`, and its
    detail line, where the size would be, reads **No part starts with the
    overhang BsaI 5′ AATG left by MC-L0-PromA. 2 of 4 parts were never reached.**
    That has no **Assemble** button.
    _Why: the reaction is the real one. The promoter hands on `AATG` and this
    part starts with `TATG`, so nothing can join it. This is what a position
    guarantees: if the overhangs fit, it assembles._

    Choose **Detected: none found** again (or close the tab) before the second
    half.

## Second half: two promoters by two coding parts

A combinatorial plan: put two alternatives in a slot and the panel runs every
combination.

1. Close `MC-wrong-position`. With the first half's four documents open, add
   `MC-L0-Promoter-B.gb` (`MC-L0-PromB`, 116 bp, `synthetic promoter B`) and
   `MC-L0-CDS-B.gb` (`MC-L0-CdsB`, 386 bp, `synthCDS B`).
   _Why: they are cut for the same positions as the first two, so they are
   alternatives to them._
2. **Positions** shows **Detected: Promoter + 5′UTR** for both promoters and
   **Detected: CDS** for both coding parts.
3. The plan's slots now read `GGAG-AATG · MC-L0-PromA, MC-L0-PromB` and
   `AATG-GCTT · MC-L0-CdsA, MC-L0-CdsB`; the destination and terminator slots
   are as before.
4. The summary line reads **4 combinations: 4 assemble.** Four rows, in this
   order:

   | Product                                                      | Detail          |
   | ------------------------------------------------------------ | --------------- |
   | `pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsA + MC-L0-Term` | 1,702 bp circle |
   | `pMC-L1-Destination + MC-L0-PromA + MC-L0-CdsB + MC-L0-Term` | 1,762 bp circle |
   | `pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsA + MC-L0-Term` | 1,722 bp circle |
   | `pMC-L1-Destination + MC-L0-PromB + MC-L0-CdsB + MC-L0-Term` | 1,782 bp circle |

   _Why: 2 x 2 x 1 x 1. The lengths differ by the parts: promoter B is 20 bp
   longer than A, CDS B is 60 bp longer than CDS A._

5. Click **Assemble all 4**.
   _Why: it opens every product that forms, one tab each (up to 24 at a time;
   a plan runs at most 500 combinations, so untick parts of a bigger one)._
6. Each tab is named like the first one, for example
   `pMC-L1-Destination+MC-L0-PromB+MC-L0-CdsA+MC-L0-Term assembly`.

**Did it work?**

- [ ] Four new tabs, each **circular**, at **1,702, 1,762, 1,722 and 1,782 bp**,
      in that order.
- [ ] Every product has `AmpR`, `ori`, one promoter (A or B), one coding part
      (A or B) and `synthetic terminator`, and never both promoters or both
      coding parts.
- [ ] **BsaI** is ticked in each product's Enzymes tab, with 0 sites.
- [ ] No overhang warning in the panel: `GGAG`, `AATG`, `GCTT` and `CGCT` are
      four distinct overhangs, none one base from another.

Back to the [tutorials index](README.md). Numbers off? See [If a number does not match](before-you-start.md#if-a-number-does-not-match).
