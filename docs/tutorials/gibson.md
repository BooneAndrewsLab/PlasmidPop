# Gibson assembly: a vector and two inserts

A vector and two inserts that already end in the bases their neighbour starts
with go into one reaction and come out as a circle, with no enzyme site and no
scar. About nine steps, then one design that fails and what the panel says
about it. About 20 minutes. Read [Before you start](before-you-start.md) first
if the Bench or the sample files are new to you.

**Files for this tutorial** (synthetic, plain downloads):
[GB-Vector.gb](files/GB-Vector.gb), [GB-Insert1.gb](files/GB-Insert1.gb),
[GB-Insert2.gb](files/GB-Insert2.gb) and
[GB-bad-Insert2.gb](files/GB-bad-Insert2.gb). Every file is a **synthetic
example** (invented sequence), and every number below is checked by
`src/core/cloning/gibsonTutorial.test.ts` and
`src/app/components/GibsonTutorial.test.tsx`, which run these same files
through the functions the Gibson panel uses, so the page cannot drift from the
app without the build failing.

### Five words

- **Overlap** (homology arm): a stretch of 15 to 40 bases that the end of one
  piece shares with the start of the next. The overlaps decide what joins what
  and in which order; there is nothing else to design.
- **Linearised vector**: the backbone as a linear piece. Its two ends are the
  overlaps with the first and the last insert. Here it is a file; in the lab you
  would cut a plasmid or amplify it by inverse PCR.
- **Exonuclease, polymerase, ligase**: the three enzymes of the mix. The
  exonuclease chews each 5′ end back so the overlaps become single strands that
  anneal; the polymerase fills the gaps and the ligase seals them.
- **Tm of an overlap**: the melting temperature of the shared stretch. The
  reaction is held at 50 °C, so the panel marks a junction under 48 °C.
- **Seamless**: the shared stretch appears once in the product, so there is no
  scar to design around.

## The three pieces

The circle is made of three linear files, each one a few hundred to a thousand
bases:

| File         | Length   | Starts with                            | Ends with                                           |
| ------------ | -------- | -------------------------------------- | --------------------------------------------------- |
| `GB-Vector`  | 1,506 bp | 26 bp that the second insert ends in   | 28 bp that the first insert starts with             |
| `GB-Insert1` | 508 bp   | those 28 bp, then `synthDomainA`       | a 30 bp `linker` that the second insert starts with |
| `GB-Insert2` | 449 bp   | that 30 bp linker, then `synthDomainB` | 26 bp that the vector starts with                   |

The two inserts are two halves of one fused open reading frame: `synthDomainA`
(150 residues, starting on an ATG), the linker (10 residues), `synthDomainB`
(130 residues) and a stop. The vector carries the promoter before the first
insert and the terminator after the second, plus `KanR` and `ori` stand-ins.
You will never type a sequence: the panel finds the overlaps itself.

Before you start, close every tab you do not need: the Gibson panel takes every
open tab into the tube.

## Tutorial 1: one reaction, three pieces

1. **File ▸ Open**, select `GB-Vector.gb`, `GB-Insert2.gb` and `GB-Insert1.gb`
   (or drag them onto the window). Close every other tab. Note that insert 2 is
   deliberately opened before insert 1.
   _Why: the order of the tabs must not matter; the panel works out the order
   from the overlaps._
2. Click the **Bench** tab, then **Gibson** at the top of the middle column. The
   heading reads **Gibson**, with `no enzyme, matching ends` beside it.
   _Why: this is the reaction for pieces that end in each other._
3. Under **Overlap**, leave **15 bp or more** and leave **Circular product**
   ticked. The list under them has your three documents, each ticked:
   `GB-Vector` 1,506 bp, `GB-Insert2` 449 bp, `GB-Insert1` 508 bp.
   _Why: Overlap is the shortest homology the panel accepts at a junction (15 bp
   is what NEB's protocol asks for); it still reports the longest it finds._
4. Read the line above the order: **3 parts join into a 2,379 bp circle, in this
   order:**. Under it the panel lists the parts in the order it found, not the
   order of your tabs: `GB-Vector`, `GB-Insert1`, `GB-Insert2`.
   _Why: homology allows only one order, so the panel follows the chain from the
   first tab._
5. Read the three junction lines, each with a tick:
   - **28 bp overlap, Tm 61 °C** between `GB-Vector` and `GB-Insert1`;
   - **30 bp overlap, Tm 65 °C** between `GB-Insert1` and `GB-Insert2`;
   - **closes: 26 bp overlap, Tm 65 °C** between `GB-Insert2` and `GB-Vector`,
     which shuts the circle.

   Hover a junction to see the shared bases (**Shared:** and the sequence).
   _Why: this is the thing to check. All three are well over 48 °C, so none is
   marked as weak._

6. Read the **Product** line: **2,379 bp, circular**, with the features
   `synthetic terminator`, `KanR`, `ori`, `synthetic promoter`, `synthDomainA`,
   `linker`, and one more. No warning appears under it.
   _Why: the product is described before it is made._
7. Click **Assemble**. A new tab opens, `GB-Vector+GB-Insert1+GB-Insert2
assembly`, with the **Features** tab in front. Open its **Enzymes** tab too
   and tick through the checklist.
   _Why: the product is a scratch document; **File ▸ Save** if you want to keep
   it._

**Did it work?**

- [ ] Product **2,379 bp**, **circular**.
- [ ] Features: `synthetic terminator`, `KanR`, `ori`, `synthetic promoter`,
      `synthDomainA`, `linker` and `synthDomainB`, each once.
- [ ] Each overlap (28, 30 and 26 bp) appears **once** in the product.
- [ ] The Enzymes tab has the default ticks, every enzyme that cuts the product
      once. A Gibson has no enzyme to pick, so unlike Golden Gate and ligation
      there is none ticked for the reaction. Use **Hide all** if the map is
      crowded.
- [ ] `synthDomainA` runs on, through the linker and `synthDomainB`, to the stop:
      one open reading frame of **290 residues** (150 + 10 + 130), starting on
      the ATG of `synthDomainA`.

**Looks odd, is right.** The sizes add up to less than the parts:
1,506 + 508 + 449 = 2,463, but the product is 2,379. The difference is 84 bp,
the three overlaps (28 + 30 + 26), because each shared stretch is in the product
**once**, not once from each neighbour. There is also no scar and no junction
feature: the linker is a feature of insert 1 and appears once, where the two
inserts meet. And the tab order was not the circle's order, which is the point.

## Tutorial 2: what a bad design looks like

`GB-bad-Insert2.gb` is `GB-Insert2` with **one base** of its 30 bp overlap
changed (the 14th). To the eye the ends look alike; to the panel they are
different, because an overlap has to match exactly.

1. **File ▸ Open**, select `GB-bad-Insert2.gb`. Close the assembly tab first if
   you want a clean list; if you leave it, the panel says **1 document left
   out**, because a circle has no ends to join by.
   _Why: the product you made is a circular document, and the Gibson takes only
   linear pieces._
2. Back on the **Bench**, **Gibson**: untick `GB-Insert2` so the bad one replaces
   it. The tube is `GB-Vector`, `GB-Insert1`, `GB-bad-Insert2`.
   _Why: the parts that are ticked are the ones in the reaction._
3. Where the order used to be, the panel now shows, in red: **Nothing follows
   GB-Insert1: no other part starts with its last 15 bases or more. 1 of 3 parts
   were never reached.** There is no Product line and no **Assemble** button.
   _Why: the panel says where the chain breaks and how many parts it never
   reached, instead of guessing._
4. Set **Overlap** to **12 bp or more**. The message is the same, with 12 where
   it said 15.
   _Why: lowering the threshold does not rescue a mismatched overlap. The two
   ends no longer match along their whole length, and a junction needs that; the
   fix is in the design, not in the setting._
5. Set **Overlap** back to **15 bp or more** and tick `GB-Insert2` again (untick
   the bad one). The assembly is back.

## Background

[Gibson](../guide/12-cloning.md#gibson) on the Bench, including the warnings it
adds (homology found elsewhere, a short part, short overlaps for the number of
pieces). To make the primers that put the overlaps on a piece, see
[In-Fusion and NEBuilder](in-fusion.md).

Back to the [tutorials index](README.md).
