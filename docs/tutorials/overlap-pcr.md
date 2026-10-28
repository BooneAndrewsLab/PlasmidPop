# Overlap-extension PCR: a promoter, a gene and a tag

Three pieces that come from three different templates are fused into one linear
molecule with nothing but PCR: no enzyme, no site, no vector. The app designs
the six primers, runs every step on the screen and opens the fusion. About nine
steps, then one design whose tag is a base off the frame and what the panel says
about it. About 20 minutes. Read [Before you start](before-you-start.md) first
if the Bench or the sample files are new to you.

**Files for this tutorial** (synthetic, plain downloads):
[OE-Promoter.gb](files/OE-Promoter.gb), [OE-Gene.gb](files/OE-Gene.gb),
[OE-Tag.gb](files/OE-Tag.gb) and [OE-bad-Tag.gb](files/OE-bad-Tag.gb). Every file
is a **synthetic example** (invented sequence), and every number below is
checked by `src/core/cloning/overlapPcrTutorial.test.ts` and
`src/app/components/OverlapPcrTutorial.test.tsx`, which run these same files
through the functions the Overlap PCR panel uses, so the page cannot drift from
the app without the build failing.

### Five words

- **Overlap**: a stretch that the end of one fragment shares with the start of
  the next. After the first round of PCR the two products carry it, and it is
  what lets them find each other. The app grows it until it melts at a chosen
  temperature, taking half from each neighbour.
- **Tail**: the 5′ end of a primer that does not pair with its own template. An
  inner primer's tail is a copy of its neighbour's end, in upper case in the
  panel.
- **Annealing part**: the 3′ end of the primer that does pair with the template
  and starts the copying. The app grows it until it melts at about 60 °C.
- **Outer and inner primers**: the two ends of the fusion are amplified by
  **outer** primers, which have no tail. Every junction in between gets two
  **inner** primers, one for each side, complementary to each other over the
  whole overlap.
- **First-round products**: what each fragment's primer pair makes from its own
  template. Each is a little longer than its fragment, by the tails.

## The three pieces

Each file is a short linear template with the part you want inside it and some
flanking sequence you do not:

| File          | Length | The part to use                                    |
| ------------- | ------ | -------------------------------------------------- |
| `OE-Promoter` | 260 bp | `synthetic promoter`, 160 bp, bases 41 to 200      |
| `OE-Gene`     | 660 bp | `synthGene`, 540 bp, bases 51 to 590               |
| `OE-Tag`      | 169 bp | `synthTag`, 69 bp, bases 41 to 109, ending in stop |

`synthGene` is an open reading frame of 180 codons that starts on an ATG and has
no stop codon, so a tag can follow it. `synthTag` is 23 codons: a start codon, a
glycine-serine linker, six histidines and a stop. The goal is one molecule,
promoter then gene then tag, 160 + 540 + 69 = 769 bp, in which the gene reads
straight into the tag.

In the lab this is three PCRs and a fusion. Each fragment is amplified from its
own template with its own primer pair (F1 and R1 on the promoter, F2 and R2 on
the gene, F3 and R3 on the tag). The three products are mixed with no primers
and cycled, so they anneal at their overlaps and extend into one molecule. Then
the two outer primers, F1 and R3, amplify that. The panel does all of it on the
screen, with the same PCR simulation as the PCR panel, and gives you the
primers to order.

Before you start, close every tab you do not need: the panel lets you choose any
open tab.

## Tutorial 1: three fragments, one fusion

1. **File ▸ Open**, select `OE-Tag.gb`, `OE-Promoter.gb` and `OE-Gene.gb` (or
   drag them onto the window). Close every other tab. Note that the tag is
   deliberately opened first.
   _Why: the order of the tabs must not matter; you choose the order of the
   fragments in the panel._
2. Click the **Bench** tab, then **Overlap PCR** at the top of the middle
   column. The heading reads **Overlap PCR**, with `fuse by PCR, tails that
overlap` beside it. Until you choose fragments it says **Choose a tab, and the
   part of it to use, for every fragment. Open the pieces you want to fuse
   first.**
   _Why: this is the reaction for fragments with no site and no vector, only the
   tails of the primers._
3. Under **Fragments to fuse**, set **From** of fragment 1 to `OE-Promoter`. The
   **Part** beside it reads **synthetic promoter (promoter), 41–200, 160 bp**.
   Set **From** of fragment 2 to `OE-Gene`; its **Part** reads **synthGene (CDS),
   51–590, 540 bp**.
   _Why: a fragment is a tab and a part of it, here a feature. The padding
   outside the feature stays out of the fusion; the other choice in the list,
   **All of it**, would take it in._
4. Click **Add fragment**, and set **From** of fragment 3 to `OE-Tag`. Its
   **Part** reads **synthTag (CDS), 41–109, 69 bp**. Leave **Overlap Tm** at
   **60 °C (default)**.
   _Why: the fragments are fused in the order of the list; the arrows beside
   each one move it, and **Remove** drops it (two stay at least)._
5. Read the six primers below the fragment list, in the order to ask for
   them. Each has a name, then its length, strand and how its 5′ end is made:
   - `F1`: **24 nt, forward, outer at 60 °C**. No tail.
   - `R1`: **49 nt, reverse: 19 of the neighbour, 30 annealing at 57 °C**.
   - `F2`: **46 nt, forward: 19 of the neighbour, 27 annealing at 61 °C**.
   - `R2`: **37 nt, reverse: 10 of the neighbour, 27 annealing at 60 °C**.
   - `F3`: **28 nt, forward: 10 of the neighbour, 18 annealing at 67 °C**.
   - `R3`: **21 nt, reverse, outer at 61 °C**.

   Each name starts with the fragments' tab names (`SOE OE-Promoter-OE-Gene-OE-Tag`
   and then `F1`, `R1` and so on) until you name the product in step 7. The
   sequence under each carries the tail in upper case and the annealing part in
   lower case: `R1` begins `CCTCCAAATGATCTATCAT` in upper case, the reverse
   complement of the gene's first 19 bases, then `aggcttctaag` and on.
   _Why: R1 and F2 are the two inner primers of the first junction. R1 belongs
   to the promoter and ends in the start of the gene; F2 belongs to the gene
   and starts with the end of the promoter. Their tails are complementary to
   each other, which is the whole mechanism._

6. Read the lines under the primers:
   - **Junction 1: 38 bp overlap, Tm 61 °C**, with the shared bases, between
     promoter and gene;
   - **Junction 2: 20 bp overlap, Tm 61 °C**, between gene and tag;
   - **First round: 179 bp, 569 bp, 79 bp. Fused: 769 bp.**
   - **Product: 769 bp, linear · synthetic promoter, synthGene, synthTag**.

   No warning appears under the product.
   _Why: this is the thing to check. Both overlaps melt well over 50 °C and are
   over 15 bases, the limits under which the panel warns, and the product is
   the three fragments end to end._

7. Type `Promoter-Gene-Tag` in **Name of the fused product**. The primers are
   renamed `Promoter-Gene-Tag F1` to `Promoter-Gene-Tag R3`, and the product
   will take the same name. Optionally click **Save primers**: **Saved 6
   primers to My primers.** appears, so they are there when you order.
   _Why: a name you recognise is easier to find in My primers and on the
   protocol than a name built from three tab names._
8. Try **Overlap Tm**. At **65 °C**, junction 1 becomes **40 bp overlap,
   Tm 62 °C** (40 is the longest the app will make) and junction 2 **23 bp
   overlap, Tm 65 °C**, and the first round reads **180 bp, 571 bp, 81 bp**. At **52 °C**
   they become **28 bp, Tm 52 °C** and **18 bp, Tm 57 °C**, and the first round
   **174 bp, 563 bp, 78 bp**. Either way **Fused** stays **769 bp**. Put it back
   to **60 °C (default)**.
   _Why: the overlap decides how well the first-round products hold on to each
   other and nothing else; a longer one is a more robust fusion and a longer
   primer to order, but the molecule is the same._
9. Click **Open product**. A new tab opens, `Promoter-Gene-Tag`, with the
   **Features** tab in front. Then open its **ORFs** tab.
   _Why: the product is a scratch document with how it was made recorded;
   **File ▸ Save** if you want to keep it. **Protocol…** under the map lists
   the six primers to order and the fusion as a reaction of its own._

**Did it work?**

- [ ] Product **769 bp**, **linear** (160 + 540 + 69). A fusion is a straight
      piece of DNA, so unlike the Gibson tutorial it does not close into a circle.
- [ ] Features: `synthetic promoter`, `synthGene` and `synthTag`, each once, and
      the primers drawn on the molecule.
- [ ] Each overlap (38 and 20 bp) appears **once** in the product, and the
      three sequences it was made from are all there, in that order.
- [ ] The promoter ends at base 160 and `ATG` is bases 161 to 163: the gene
      starts exactly where the promoter stops.
- [ ] The **ORFs** tab lists one reading frame, forward, bases 161 to 769, **202
      amino acids** (180 of the gene and 22 of the tag) and then the stop.
      Translated, it begins `MIDHLEG` and ends `...MGSGSGSHHHHHHGSARARTRS*`:
      gene, linker, six histidines, stop, in one frame.
- [ ] The Enzymes tab has the default ticks, every enzyme that cuts the product
      once. An overlap PCR has no enzyme of its own to tick.

**Looks odd, is right.** The sizes of the first round add up to more than the
product: 179 + 569 + 79 = 827, but the product is 769. The difference, 58 bp, is
the two overlaps (38 + 20), because each is shared by two products and sits once
in the fusion. Second, `synthGene` and `synthTag` are drawn on the product a
little short: `synthGene` from base 180 rather than 161, and `synthTag` from 711
rather than 701. The part of each that lies in an overlap came from the first
round of its neighbour, which carried it only as a tail, so the annotation
starts after it; the sequence is whole, and the ORFs tab shows the complete
reading frame. And the primers have different lengths and Tm: each annealing
part grows to about 60 °C within 18 and 30 bases, and F3 (**18 annealing at
67 °C**) is the shortest the app makes, on a GC-rich start.

## Tutorial 2: a tag that is a base off

`OE-bad-Tag.gb` is `OE-Tag` with **one extra base** in front of its start
codon. Its `synthTag` feature starts on that base and is marked `/codon_start=2`
(it reads from its second base), which is what you would have if a linker you
designed by hand were one base too long. Nothing about the overlap is wrong:
the pieces fuse perfectly. What goes wrong is the frame.

1. **File ▸ Open**, select `OE-bad-Tag.gb`. Leave the others open.
2. Back on the **Bench**, **Overlap PCR**, set **From** of fragment 3 to
   `OE-bad-Tag`; its **Part** reads **synthTag (CDS), 41–110, 70 bp**.
   _Why: the tag replaces the good one; the rest of the list is as it was._
3. The panel still shows the primers, the junctions and a product, now **770
   bp, linear**, but a warning has appeared under it: **The parts assemble, but
   the tube may also give something else:** and then **synthGene runs into
   synthTag at junction 2 out of frame: the fusion shifts the reading frame of
   synthTag.**
   _Why: the panel checks, at each junction, the frame of each gene on either
   side, and says where they disagree. The fusion would be made, and then the
   tag would be read in the wrong frame._
4. Optional: click **Open product** and open the **ORFs** tab. It lists nothing
   of 75 codons or more. The reading that starts at the gene's ATG does not
   meet a stop where the tag should end it: the stop is now out of frame, and
   the molecule runs out first.
   _Why: this is the check on the product itself, and what you would have
   found in the lab as a protein with no tag._
5. Set **From** of fragment 3 back to `OE-Tag`. The warning is gone.

A deletion made with two pieces of the same tab gets a warning of the same kind
when what is left out is not a multiple of three bases. As here, the fix is in
the design (the bases between the two parts), not in a setting of the panel.

## Background

[Overlap PCR](../guide/12-cloning.md#overlap-pcr) on the Bench, including the
warnings it adds (a short or non-unique overlap, a primer that melts well below
its target) and how a deletion is made with the same tab twice. The primers are
the ones the PCR panel simulates; for the reaction that joins pieces with an
enzyme mix instead, see [Gibson](gibson.md).

Back to the [tutorials index](README.md).
