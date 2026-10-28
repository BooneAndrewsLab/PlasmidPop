# Site-directed mutagenesis: a point mutation, a tag, a deletion and a new site

Change one plasmid on purpose: one amino acid, a few residues added or taken
away, and a silent base that makes a new restriction site to check the clone
by. The Cloning tab's **Mutate** designs the two primers and opens the plasmid
they make. About nine steps for each change, then a design the panel says
falls short. About 25 minutes. Read [Before you start](before-you-start.md)
first if the sample files or the enzyme ticks are new to you.

**File for this tutorial** (synthetic, a plain download):
[SDM-Template.gb](files/SDM-Template.gb). It is a **synthetic example**
(invented sequence), and every number below is checked by
`src/core/cloning/mutagenesisTutorial.test.ts` and
`src/app/components/MutagenesisTutorial.test.tsx`, which run this same file
through the functions the Mutate panel uses, so the page cannot drift from the
app without the build failing.

Mutagenesis is not on the Bench: it works on the one document in front of you,
so it is in the **Cloning** tab of the sidebar, beside **Digest** and **PCR**.
There is no NCBI gene path in this tutorial. A gene you fetch from NCBI is
mutated the same way, step for step, but the exercise needs a plasmid whose
primer sites are unique and whose numbers can be asserted, and nothing in these
pages contains a third-party record.

### Seven words

- **Mutagenic primer**: a primer whose bases differ from the template at the
  change. Mutagenesis needs two, one for each strand, and the whole plasmid is
  copied with them.
- **Back to back**: NEB's Q5 site-directed mutagenesis design (the panel's
  default). The two primers point away from each other and meet at the change,
  which rides on the 5′ end of the forward one. They do not overlap. After the
  PCR the linear product is phosphorylated, ligated and the template digested
  (**KLD**).
- **Overlapping**: Agilent's QuikChange design. The two primers are each
  other's reverse complement, with the change in the middle, so they overlap
  along their whole length. The plasmid is copied round and the template is
  digested with **DpnI**.
- **Annealing part**: the 3′ end of a primer that pairs with the template. In
  the panel the new bases are in upper case and the annealing part in lower.
- **Tm**: the melting temperature of the annealing part (nearest neighbour, as
  elsewhere in the app). For back to back the panel grows each annealing part
  until it reaches 60 °C and also shows **NEB Q5**, the Tm NEB's own calculator
  gives for that enzyme, a few degrees higher.
- **Silent change**: a different codon for the same amino acid. The protein is
  untouched, but the DNA is not.
- **Check digest**: cutting the clone with enzymes to see bands that tell the
  mutant from the template. A silent change that makes or breaks a site gives
  you one without sequencing.

## The file

| File           | Length   | What it is                                                                                                                                                          |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SDM-Template` | 1,241 bp | Circular: `synthetic promoter` (1–120), `synthORF` (139–441, 100 codons and a stop), `synthetic terminator`, `AT-rich spacer` (552–641), `AmpR` and `ori` stand-ins |

`synthORF` starts `MARGRLWNISRNPK` (residue 14 is a lysine, AAG at 177–179)
and ends `…LLVEV`, then the stop. Residue 41 is an isoleucine, `GATATT`
(bases 256–261) is a hair from an EcoRV site, and a BamHI site sits at 534–539,
after the terminator. The spacer is 90 bases of only A and T, which is what the
last exercise is about. There is no EcoRV site anywhere in the template.

Each exercise starts from the template, not from the last mutant, so close the
mutants you open and keep `SDM-Template` as the tab to work in.

## Tutorial 1: one amino acid, K14R

1. **File ▸ Open**, select `SDM-Template.gb`. Close every other tab.
   _Why: the panel designs primers for the document in front of you, so the
   template must be the tab that is showing._
2. Open the **Enzymes** tab and click **Hide all**, then type `BamHI` in
   **Filter** and tick it.
   _Why: you will see in step 9 that the mutant opens with the template's ticks
   and not with every enzyme that happens to cut it once._
3. Press `Ctrl+F`, type `AAGAACAGC` and press `Enter`. Both views scroll to the
   match, at bases 178 to 186, and select it. Press `Esc` to close the bar.
   _Why: this brings you to the codon without counting. The nine bases are the
   codons for K, N and S, the first three amino acids of the stretch you want._
4. In the sequence view, in the line of amino acids under the bases, click the
   **K** at the left of the match (if there is no amino-acid line, switch on
   **Translations** in the **Format** menu). The status bar
   starts `3 bp selected, 178 to 180`.
   _Why: clicking an amino acid selects that residue's three bases and nothing
   else, which is what a change to one residue needs._
5. Click the **Cloning** tab and pick **Mutate** under **Reaction**. The panel
   says **Change 3 bp at 178 (AAG).** Under **Change a residue** the heading
   note reads `synthORF K14 (AAG)`.
   _Why: the panel read the codon through the CDS's own frame and strand, so
   you can name the amino acid you want and let it supply the bases._
6. Under **To**, choose **R — Arginine** (the **Host** stays **E. coli**).
   Six codons appear: `CGC 40 % ★`, `CGT 38 %`, `CGG 10 %`, `CGA 6 %`, `AGA 4 %`
   and `AGG 2 %`. Hover `AGG`: it changes 1 base; `CGC` changes 3. Click `AGG`.
   _Why: the star is the host's commonest arginine codon, and the others are
   ordered after it. AGG is the rarest in E. coli, but it keeps the change to a
   single base, which is the cleanest first example; for protein you mean to
   express you would choose CGC._
7. **Change to** now holds `AGG`, and the panel names the change in bold:
   **AAG178–180AGG** · `synthORF K14R`. The primers, written 5′ to 3′ as you
   would order them, are listed under **Forward** and **Reverse**:

   | Primer  | Sequence (upper case is new)    | Length | Tm               | NEB Q5 |
   | ------- | ------------------------------- | ------ | ---------------- | ------ |
   | Forward | `AGGaacagcctacgcctggcc`         | 21 nt  | 60 °C, 18 anneal | 71 °C  |
   | Reverse | `cggatttctagatatgttccacagacgcc` | 29 nt  | 61 °C, 29 anneal | 70 °C  |

   The note under them says to amplify the whole plasmid, **annealing at 71.3
   °C (NEB's for Q5)**, then phosphorylate, ligate and digest the template
   (KLD).
   _Why: the forward primer begins with the new codon and anneals just after
   it; the reverse anneals to the bases just before it. They point away from
   each other and share no base, so the change is the join between them._

8. Click **Overlapping**. The primers become `catatctagaaatccgAGGaacagcctacgcctg`
   and `caggcgtaggctgttCCTcggatttctagatatg`, **34 nt, Tm 79 °C (Agilent)** each,
   and the note says to copy the plasmid round, digest the template with DpnI
   and transform. Click **Back to back** again to return.
   _Why: these are the same change in the other design. Each primer is the
   reverse complement of the other, so they overlap along their whole 34 bases,
   with the new codon (and its complement, `CCT`) in the middle and 16 and 15
   template bases either side._
9. Click **Open mutant**. A tab opens, `SDM-Template AAG178–180AGG`, with the
   **Features** tab in front. Look at the **Enzymes** tab: only `BamHI` is
   ticked. Press `Ctrl+Z` once to see the template's base come back, and
   `Ctrl+Shift+Z` to put the change back.
   _Why: the mutant is the template with the change as its one edit, so undo
   works, and it keeps the ticks you had, which is what lets the check digest in
   Tutorial 3 start from enzymes you chose._

**Did it work?**

- [ ] Product **1,241 bp**, **circular**: the same length as the template.
- [ ] The base at **179** is **G** where the template has **A**, and that is the
      **only** difference: 1,240 of 1,241 bases are the template's.
- [ ] In the translation, residue **14** is **R** (was K) and every other
      residue is as it was; `synthORF` is still 139 to 441.
- [ ] The forward primer is **21 nt** and the reverse **29 nt**, Tm **60** and
      **61 °C**, anneal at **71.3 °C**; in the overlapping design, two
      complementary **34 nt** primers, Tm **79 °C**.
- [ ] Only `BamHI` is ticked on the mutant, as it was on the template.

**Looks odd, is right.** The change is called `AAG178–180AGG`, three bases to
three bases, though only the middle base differs: you selected the whole codon,
and the panel names what you selected, not what changed. The product differs
from the template at one base (179, A to G). The mutant is not a new sequence
either: it opens as the template renamed with the change as its one edit,
which is why **Undo** gives the template back, and why with **Edits** on in
the toolbar the changed base is marked. And the two designs disagree about
Tm (60 and 61 against 79) because they measure different things: the annealing
part against the template by nearest neighbour, and the whole primer by Agilent's
formula. Neither is wrong, and the two numbers are not to be compared.

## Tutorial 2: a short insertion and a deletion

Two changes, one after the other, each made on the template. Close the mutant
from Tutorial 1 first, and make `SDM-Template` the tab showing.

**An insertion: a His tag before the stop codon**

1. Press `Ctrl+F`, type `CTGGTGGAAGTA` and press `Enter`. The match runs from
   base 427 to 438, the last residue (V, number 100) being its last three bases.
   Press `Esc`, then the `→` key.
   _Why: the arrow collapses the selection to a cursor at its right end, which
   is where the tag goes: after the last residue, in front of the stop._
2. The status bar reads `Cursor after base 438`. In the **Cloning** tab, with
   **Mutate** picked, the panel says **Insert after base 438.** and the box is
   now labelled **Bases to insert**.
   _Why: a cursor and some bases is an insertion; a selection and nothing is a
   deletion; a selection and some bases is a substitution. It is one box and
   three kinds of change._
3. Type `CACCACCACCACCACCAC` (six CAC codons) in **Bases to insert**.
   _Why: every codon is CAC, histidine, and 18 is a multiple of three, so the
   insertion stays in frame._
4. The panel names the change **+CACCACCACCACCACCAC after 438** · `synthORF 101
(none) → HHHHHH`.
   _Why: it translated the ORF before and after. Position 101 was the stop and
   held no amino acid; after the insertion it holds six histidines._
5. The back-to-back primers are:

   | Primer  | Sequence (upper case is new)             | Length | Tm               | NEB Q5 |
   | ------- | ---------------------------------------- | ------ | ---------------- | ------ |
   | Forward | `CACCACCACCACCACCACtaaggatgcggtcccctggt` | 38 nt  | 60 °C, 20 anneal | 71 °C  |
   | Reverse | `tacttccaccagaagacggtaactgc`             | 26 nt  | 61 °C, 26 anneal | 70 °C  |

   with **annealing at 71.1 °C**.
   _Why: the whole tag rides on the forward primer's 5′ tail (an insert over 20
   bases would be split between the two); neither primer is long. The 18 new
   bases are not part of the annealing Tm._

6. Click **Open mutant**. A tab opens, `SDM-Template +CACCACCACCACCACCAC after
438`, **1,259 bp**.
   _Why: 1,241 + 18._
7. In its **Features** tab, `synthORF` now runs 139 to 459, and the terminator
   follows it at 460 to 539.
   _Why: the insertion is inside the ORF, so the ORF grows and everything after
   it moves 18 bases along._

**Did it work?** (insertion)

- [ ] **1,259 bp**, circular; the new bases are at **439 to 456**, and the
      sequence either side is the template's, unchanged.
- [ ] The translation ends `…LLVEV` then **HHHHHH** then the stop: **106**
      residues, where the template has 100.
- [ ] `synthORF` **139 to 459**, `synthetic terminator` **460 to 539**.
- [ ] Forward **38 nt**, reverse **26 nt**, anneal at **71.1 °C**.

**A deletion: one residue gone**

1. Close the mutant, and make `SDM-Template` the tab showing. Press `Ctrl+F`,
   type `AGTTGTGAAATG`, press `Enter` and `Esc`. The match is bases 310 to 321,
   the codons for S, C, E and M.
2. Click the **E** on the amino-acid line: the three bases at 316 to 318. The
   panel says **Change 3 bp at 316 (GAA).**
   _Why: residue 60 is the one to remove._
3. Do not type anything. **Change to** reads `leave empty to delete`, and the
   panel has already designed the deletion: **Δ316–318** ·
   `synthORF 60 E → (none)`.
   _Why: an empty box is the change. It is also why a selection you have not
   decided about already shows primers: they are for deleting it._
4. The primers are `atgtttatgtctctctgtggtaagtggcc` (29 nt, Tm 61 °C, NEB Q5
   70 °C, all 29 anneal) and `acaactcatgaaaagctgggtagctttt` (28 nt, 60 °C, 68
   °C, all 28 anneal), **annealing at 69.5 °C**. Both are lower case: a deletion
   puts no new base into either primer.
   _Why: the primers are the two sides of the gap, joined at the cut. Nothing in
   them is new._
5. Click **Open mutant**: `SDM-Template Δ316–318`, **1,238 bp**.

**Did it work?** (deletion)

- [ ] **1,238 bp**, circular: the template less the three bases `GAA`.
- [ ] The translation has **100** characters, 99 residues and the stop; residue
      60 (E) is gone and every other residue is the template's, in order.
- [ ] `synthORF` **139 to 438**, 300 bases.
- [ ] Forward **29 nt**, reverse **28 nt**, anneal at **69.5 °C**.

**Looks odd, is right.** The insertion's protein change says `101 (none) →
HHHHHH`, which reads like a fault: it is how a gain is named. Residue 101 was
the stop, so there was nothing at that number, and after the insertion the six
histidines take 101 to 106 and the stop moves to 107. Neither mutant is a new
sequence in the sense of a new file: each is the template with its one edit, so
`synthORF` and every feature after the change moved with the bases, as they do
when you type into a sequence yourself. The deletion's primers have no upper
case at all: the deleted codon is in neither.

## Tutorial 3: a silent change that makes a site

A change that costs the protein nothing and gives the DNA a restriction site,
so that a miniprep digest tells the mutant from the template.

1. Close the mutants. With `SDM-Template` showing, press `Ctrl+F`, type
   `GATATTCAG`, press `Enter` and `Esc`: bases 256 to 264, the codons for D, I
   and Q. In the **Enzymes** tab type `EcoRV` in **Filter** and tick it.
   _Why: EcoRV cuts `GAT^ATC`, and the template reads `GATATT`, one base from
   it. The tick shows no cut: the template has no EcoRV site._
2. Click the **I** on the amino-acid line, the second of the three. In the
   **Cloning** tab, under **Mutate**, the panel says **Change 3 bp at 259
   (ATT)** and the heading note `synthORF I41 (ATT)`.
   _Why: residue 41 is the one whose codon can change without the protein
   changing._
3. Under **To**, choose **I — Isoleucine (as now)**. Click `ATC`, the codon
   that changes one base.
   _Why: ATT and ATC both code for isoleucine, and the T to C turns `GATATT`
   into `GATATC`._
4. The panel names it **ATT259–261ATC** · `synthORF no change (silent)`.
   _Why: it translated the ORF before and after and found the same protein._
5. The primers: forward `ATCcagtggctttcttacgtttatttacgaaaagc` (35 nt, Tm 60
   °C, NEB Q5 68 °C, 32 anneal) and reverse `atcacaggggaccatccggt` (20 nt, Tm 60
   °C, NEB Q5 71 °C, 20 anneal), **annealing at 68.6 °C**.
   _Why: the lower Q5 Tm (68) plus one._
6. Click **Open mutant**: `SDM-Template ATT259–261ATC`, 1,241 bp. In the
   **Enzymes** tab the ticks are the template's: `BamHI` and `EcoRV`, both
   ticked.
   _Why: a mutant keeps the template's ticks, so an enzyme you ticked to check
   it is already ticked when it opens._
7. The map and the sequence view now show `EcoRV` once, at 256 to 261, and
   `BamHI` once, at 534 to 539.
   _Why: GATATC exists now._
8. Click the **Cloning** tab and pick **Digest**. It says **2 fragments**,
   largest first: **965 bp** and **276 bp**. Switch to the template's tab: the
   same digest says **1 fragment**, 1,241 bp, because only BamHI cuts it.
   _Why: this is the check. A circle cut twice gives two bands (EcoRV cuts
   between 258 and 259, BamHI between 534 and 535, and 276 is the stretch
   between them); one cut gives one band the size of the whole plasmid._
9. In the mutant, untick `BamHI`: one fragment of 1,241 bp, from the EcoRV cut
   alone.
   _Why: with a single enzyme a circle gives one band, so the second enzyme is
   what turns the site into a test._

**Did it work?**

- [ ] **1,241 bp**, circular; one base differs from the template, at **261**
      (T to C).
- [ ] The translation is identical to the template's, residue for residue: 41 is
      still I.
- [ ] `GATATC` is at **256 to 261** in the mutant and nowhere in the template.
- [ ] BamHI + EcoRV on the mutant: **965 and 276 bp**; on the template, one
      band, 1,241 bp.
- [ ] `BamHI` and `EcoRV` are ticked on the mutant because they were on the
      template.
- [ ] Forward **35 nt**, reverse **20 nt**, anneal at **68.6 °C**.

**Looks odd, is right.** The forward primer is 35 nt, longer than the 21 of
Tutorial 1, and its annealing part is 32 bases, not 18: the panel keeps adding
bases until the annealing part reaches 60 °C, and the bases here are less
GC-rich. The panel says the change is **silent** and yet the plasmid is not the
template: protein is the one thing that did not change. And only BamHI
and EcoRV are ticked because you cleared the ticks in Tutorial 1 and chose
them: a template you open fresh has every enzyme that cuts it once ticked, and
the digest would have listed all of them.

## Tutorial 4: a change the primers cannot reach

The panel always gives a design, and says so when it falls short.

1. Close the mutants. With `SDM-Template` showing, press `Ctrl+F`, type
   `AAATATAAAATA`, press `Enter` and `Esc`, then press `→`. The status bar
   reads `Cursor after base 590`.
   _Why: this is in the AT-rich spacer, 90 bases with no G or C._
2. Hold `Shift` and press `→` once. One base is selected, the **A** at 591: the
   panel says **Change 1 bp at 591 (A).**
3. Type `G` in **Change to**. The change is named **A591G** and, as it is not
   in a coding region, with nothing after it.
4. The panel shows both primers, a forward of **61 nt** and a reverse of **60
   nt**, Tm **55** and **57 °C** (NEB Q5 **60** and **63 °C**), every annealing
   base from the template, and in a warning line says: **The template next to the change is
   too AT-rich to reach 60 °C within 60 bases.**
   _Why: the longest primer the panel will write is 60 bases of annealing part,
   and in a stretch of only A and T that is not enough to reach 60 °C. The
   design is shown rather than refused, so you can see how far short it is._
5. Click **Overlapping**. A warning line again: **The primers reach only 69 °C at 60 bases,
   short of the 78 °C QuikChange asks for.**
   _Why: the same stretch fails the other design's rule too, by a larger margin
   (69 against 78)._
6. Select the codon at 178 to 180 as in Tutorial 1 and type `AGG`: the same two
   designs have no red line.
   _Why: the failure is where the change is, not the method._

The way out is to move the change if you can, or to accept a lower annealing
temperature and say so in the lab; the panel does not decide that for you. And
when the box has a character that is not a base, a note under it says what was
left out (_Left out, not bases: “#”._), so a change that came out shorter than
you typed says why.

## Background

[Site-directed mutagenesis](../guide/12-cloning.md#site-directed-mutagenesis)
in the user guide, which also covers a library at a codon (**NNK**, **NNS**,
**NNN**, **NDT**), a change at the end of a linear sequence, and a change across
the origin of a circle. The design note is item 47
(`docs/design/47-mutagenesis.md`).

PlasmidPop designs the primers and shows the plasmid they make; it does not
simulate the PCR, the KLD or the DpnI step,. To
mutate your own plasmid, open its file, select the base or codon, and follow the
same steps. Back to the [tutorials index](README.md).
