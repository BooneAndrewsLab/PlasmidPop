# Gateway cloning: a BP reaction, then an LR reaction

A gene flanked by attB sites goes into a donor vector to make an entry clone
(BP), and the entry clone goes into a destination vector to make the expression
clone (LR). No enzyme site and no primer design: the att sites decide what
swaps with what. About ten steps for each reaction, then two designs that fail
and what the panel says about them. About 25 minutes. Read
[Before you start](before-you-start.md) first if the Bench or the sample files
are new to you.

**Files for this tutorial** (synthetic, plain downloads):
[GW-Insert.gb](files/GW-Insert.gb), [GW-pDONR.gb](files/GW-pDONR.gb),
[GW-pDEST.gb](files/GW-pDEST.gb) and
[GW-bad-pDEST.gb](files/GW-bad-pDEST.gb). Every file is a **synthetic
example** (invented sequence), and every number below is checked by
`src/core/cloning/gatewayTutorial.test.ts` and
`src/app/components/GatewayTutorial.test.tsx`, which run these same files
through the functions the Gateway panel uses, so the page cannot drift from the
app without the build failing.

**The att sites in these files are invented.** PlasmidPop carries no att
sequences: it reads the sites a file annotates (`attB1`, `attP2`, `attL1`,
`attR2` and so on) and pairs them by number. Here each site is a 15 base core
with a short arm on each side, so the sizes (25, 55 and 40 bp) are not those of
the real sites, and none of the sequence is. With a real donor, entry or
destination vector, which labels its own sites, the steps are the same. The app
does not design primers that add attB sites to a PCR product, so the insert
here is supplied as the product, with its attB sites already annotated; in the
lab you would put the attB tails on the primers yourself. See
[Background](#background).

### Seven words

- **att site**: a short stretch where the integrase swaps DNA. There are four
  kinds, **attB**, **attP**, **attL** and **attR**, and each carries a number
  (`attB1`, `attB2`).
- **Core**: the bases two partner sites share. The panel finds the core itself
  (the longest stretch the two sites have in common) and crosses over in its
  middle. Here it is 15 bp.
- **BP reaction**: attB substrate × donor vector (attP) gives an **entry clone**
  (attL) and a byproduct (attR).
- **LR reaction**: entry clone (attL) × destination vector (attR) gives an
  **expression clone** (attB) and a byproduct (attP).
- **Numbers pair**: `attB1` recombines only with `attP1`, `attL1` only with
  `attR1`. The two numbers on a molecule are what give the insert its direction.
- **ccdB cassette**: a gene that kills an ordinary _E. coli_ strain. It sits
  between the two sites of a donor and of a destination vector, so it leaves with
  the byproduct and the clone you want is the one that grows.
- **Selection marker**: each vector carries one for its backbone. In a BP the
  clone keeps the donor's, in an LR the destination's, and the other comes away
  on the byproduct.

## The four files

| File           | Length   | What it is                                                                     |
| -------------- | -------- | ------------------------------------------------------------------------------ |
| `GW-Insert`    | 422 bp   | Linear: `attB1` (1–25), `synthGene` (32–391, 120 codons), `attB2` (398–422)    |
| `GW-pDONR`     | 1,390 bp | Circular: `attP1`, `ccdB`, `attP2`, then `KanR` and `ori` stand-ins            |
| `GW-pDEST`     | 1,837 bp | Circular: promoter, `attR1`, `ccdB`, `CmR`, `attR2`, terminator, `AmpR`, `ori` |
| `GW-bad-pDEST` | 1,837 bp | `GW-pDEST` with `attR3` where `attR2` was: used for the design that fails      |

`GW-Insert` is a PCR product, so it is linear. The donor and the destination
carry the ccdB stand-in between their sites; the destination's cassette also
carries a `CmR` stand-in, as real destination vectors do. You never type a
sequence: the panel reads the sites from the annotation.

Before you start, close every tab you do not need.

## Tutorial 1: the BP reaction, an insert into a donor vector

1. **File ▸ Open**, select `GW-Insert.gb`, `GW-pDONR.gb` and `GW-pDEST.gb` (or
   drag them onto the window). Each opens in its own tab. Close every other tab.
   _Why: a recombination needs two whole molecules, and the panel takes both
   from open tabs; the destination is for the second tutorial._
2. Click the **Features** tab with `GW-Insert` in front and find `attB1` and
   `attB2` in the list, one on either side of `synthGene`. Do the same on
   `GW-pDONR`: `attP1` and `attP2` on either side of `ccdB`.
   _Why: the panel reads only what the file calls its sites. A plasmid that does
   not label them gets a message, not a guess._
3. Click the **Bench** tab, then **Gateway** at the top of the middle column. The
   heading reads **Gateway**, with `att sites, no enzyme` beside it. The panel
   opens on **LR**: click **BP**.
   _Why: BP is the first of the two reactions, and the panel remembers the last
   one you used._
4. Until you choose, the panel says: **Choose the attB substrate and the donor
   vector. A BP needs two attB sites on the first and two attP sites on the
   second.** Open the **attB substrate** list. Each tab is listed with the sites
   it annotates: `GW-Insert — attB1, attB2`, `GW-pDONR — attP1, attP2` and
   `GW-pDEST — attR1, attR2`.
   _Why: the second line of each entry is the quickest way to see which tab is
   which kind of molecule._
5. Choose `GW-Insert` as the **attB substrate** and `GW-pDONR` as the **donor
   vector**. **Entry clone:** appears, with **Product: 1,412 bp, circular ·
   synthGene, KanR, ori, attL1, attL2**.
   _Why: the product is described before it is made. The recombinant sites are
   named for what the reaction made of them: a BP makes attL._
6. Read the sentence under it, the only warning: **The ccdB cassette of
   GW-pDONR leaves on the byproduct, so an entry clone that grows in an ordinary
   strain is the one you want; a ccdB-resistant strain (DB3.1) grows both.**
   _Why: this is the selection. The cassette is not in the clone, so a strain
   that ccdB kills grows the clone and not the donor you started with._
7. Look at the buttons. There is **Open clone** and no **Open byproduct**.
   _Why: a linear substrate has no circle to leave behind. Its two ends come away
   as loose pieces, and the panel does not make a document of them._
8. Check the sizes. The insert contributes 397 bp (422 less 12 bp before its
   `attB1` crossover and 13 bp after its `attB2` one); the donor contributes its
   backbone, 1,015 bp (1,390 less the 375 bp cassette). 397 + 1,015 = 1,412.
   _Why: the 400 bp that are not in the clone are the 375 bp cassette and the 25
   bp of the substrate's flanks._
9. Click **Open clone**. A new tab opens, `GW-Insert × GW-pDONR BP`, with the
   **Features** tab in front. Find `attL1` and `attL2` there.
   _Why: the product is a scratch document; **File ▸ Save** if you want to keep
   it. It remembers how it was made, which the **History** tab's **Made from**
   shows._
10. Click the **Bench** tab again (the document stays open), and go on to the
    next tutorial, or close the tabs you are done with.

**Did it work?**

- [ ] Product **1,412 bp**, **circular**.
- [ ] Features: `synthGene`, `KanR`, `ori`, `attL1` and `attL2`, each once, and
      **no `ccdB`** and no `attB` or `attP`.
- [ ] `attL1` and `attL2` are **40 bp** each: half of an attB's bases and half of
      an attP's. They are different sequences (their cores differ), which is
      what keeps the insert's direction.
- [ ] The gene is whole, **360 bp**, `synthGene` at 20–379, between the two
      sites: `attL2` follows it at 386–425, and 6 bp separate `attL1` from it.
- [ ] `KanR` (the donor's marker) is on the clone, on the reverse strand as in
      the donor.
- [ ] No byproduct was offered, because the substrate was linear.

**Looks odd, is right.** The clone is smaller than the donor with an insert
added: 1,390 + 422 = 1,812, and the clone is 1,412, because the cassette and the
flanks left. Nothing was cut and nothing was joined: the two sites on each
molecule swapped the DNA between them. `attL1` starts at base 1,386 and runs 13
bases past the end of the sequence, onto base 1, so the Features tab lists
`attL2` before `attL1` (and the pickers say `attL2, attL1`). The recombination
did not know where the circle starts, and the product opens as the crossover
wrote it; the document is the same circle however it is rotated. And the
warning talks about a byproduct the panel did not give you: it says where the
cassette went, whether or not the reaction made a document of it.

## Tutorial 2: the LR reaction, an entry clone into a destination vector

1. On the **Bench**, **Gateway**, click **LR**. The tabs open are `GW-Insert`,
   `GW-pDONR`, `GW-pDEST` and the entry clone you opened last time.
   _Why: LR is the second reaction, and its inputs are the BP's product and a
   destination vector._
2. Open the **entry clone** list. It has the four tabs with their sites,
   including `GW-Insert × GW-pDONR BP — attL2, attL1`, and `GW-pDEST — attR1,
attR2`.
   _Why: the entry clone is an ordinary tab here, so any entry clone you have
   open, from this panel or from a file, works the same way._
3. Choose `GW-Insert × GW-pDONR BP` as the **entry clone** and `GW-pDEST` as the
   **destination vector**. **Expression clone:** appears, with **Product: 1,551
   bp, circular · synthGene, synthetic promoter, synthetic terminator, AmpR, ori,
   attB1, +1 more**.
   _Why: the panel matched attL1 with attR1 and attL2 with attR2 by number, found
   the 15 bp core of each pair, and swapped the stretch between the sites._
4. Read the warning: **The ccdB cassette of GW-pDEST leaves on the byproduct, so
   an expression clone that grows in an ordinary strain is the one you want; a
   ccdB-resistant strain (DB3.1) grows both.**
   _Why: the same selection as before, now against the destination vector._
5. This time there are two buttons, **Open clone** and **Open byproduct**.
   _Why: the entry clone is a circle, so both circles of the exchange exist._
6. Click **Open byproduct**. A tab opens, `GW-Insert × GW-pDONR BP × GW-pDEST LR
byproduct`, 1,698 bp. Its features are `ccdB`, `CmR`, `KanR`, `ori`, `attP1`
   and `attP2`.
   _Why: the byproduct is what the clone left behind: the destination's cassette
   and the entry clone's backbone, between attP sites._
7. Go back to the **Bench** and click **Open clone** again. A tab opens,
   `GW-Insert × GW-pDONR BP × GW-pDEST LR`, 1,551 bp, with the **Features** tab
   in front.
   _Why: both products are scratch documents. The clone is the one to keep._
8. In the clone's **Features** tab, find `attB1` and `attB2`, the promoter, the
   terminator and `AmpR`. `attB1` is 25 bp: bases 1,540 to 1,551 and, past the
   origin, 1 to 13. The gene is `synthGene` at 20 to 379, 360 bp, ATG to a stop,
   120 codons, in one piece, with the promoter before `attB1` and the terminator
   after `attB2`.
   _Why: LR makes attB, the same kind of site the PCR product started with, and
   the gene went through two reactions without a base changed._
9. Do the sums: 1,412 + 1,837 = 3,249, and 1,551 + 1,698 = 3,249. Every base that
   went into the reaction is in one circle or the other. The clone is the entry
   clone's 397 bp between its sites plus the destination's 1,154 bp outside its
   cassette (1,837 less 683); the byproduct is that 683 bp cassette plus the
   entry clone's 1,015 bp backbone.
   _Why: a recombination exchanges DNA and loses none, unlike a digest and a
   ligation; if the two sizes do not add up, something else was open._
10. Check the markers. The expression clone has `AmpR` and no `KanR`, `CmR` or
    `ccdB`; the byproduct has all three of those and no `AmpR`.
    _Why: this is the swap that the selection uses: ampicillin for the clone,
    and the ccdB and chloramphenicol genes on the circle that does not grow._

**Did it work?**

- [ ] Expression clone **1,551 bp**, **circular**; byproduct **1,698 bp**,
      **circular**; together 3,249 bp, as the two parents.
- [ ] Clone features: `synthGene`, `synthetic promoter`, `synthetic terminator`,
      `AmpR`, `ori`, `attB1`, `attB2`, each once. No `ccdB`.
- [ ] `attB1` and `attB2` are **25 bp** each, the very bases the PCR product
      had. The byproduct's `attP1` and `attP2` are **55 bp**, the very bases the
      donor had.
- [ ] `synthGene` is whole (360 bp), with **6 bp** between `attB1` and its ATG,
      and **12 bp** between `attB2` and the terminator.
- [ ] Byproduct features: `ccdB`, `CmR`, `KanR`, `ori`, `attP1`, `attP2`.

**Looks odd, is right.** The clone is 1,551 bp, bigger than the entry clone and
smaller than the destination vector. The destination loses the 683 bp between
the middles of its two cores (`ccdB`, `CmR` and the spacers) and gains the 397
bp of the entry clone's insert piece, while the entry clone's backbone, with
`KanR` and the origin, goes the other way onto the byproduct. Each new site is
half of each parent's: an attB is half of an attL and half of an attR, which is
why the numbers and not the names say what pairs. And the Product line lists
`synthGene` first, before the promoter, because the document starts where the
crossover wrote it, not at the promoter; along the circle the order is promoter,
`attB1`, `synthGene`, `attB2`, terminator.

## Tutorial 3: what a bad design looks like

Two ways for a reaction to fail before it starts.

1. **File ▸ Open**, select `GW-bad-pDEST.gb`. It is `GW-pDEST` with the second
   site named `attR3`, a core that nothing in the insert shares.
   _Why: a destination vector with the wrong pair of numbers for your entry
   clone, which is what you have if you pick the wrong destination from a
   catalogue._
2. Back on the **Bench**, **Gateway**, **LR**: choose `GW-Insert × GW-pDONR BP`
   as the **entry clone** and `GW-bad-pDEST` as the **destination vector**. In
   red the panel says: **The sites do not pair: GW-Insert × GW-pDONR BP has attL1
   and attL2, GW-bad-pDEST has attR1 and attR3. Each number recombines only with
   its own.** There is no product line and no **Open clone**.
   _Why: `attL2` has no `attR2` to meet. The panel does not guess that attR3 is
   close enough; in the lab it would simply not recombine._
3. Choose `GW-Insert` as the **entry clone** instead, with `GW-pDEST` as the
   **destination vector**. The panel says: **GW-Insert has no attL site annotated.
   A LR needs two, flanking the DNA to move; annotate them, or open a file that
   does.**
   _Why: the PCR product has attB sites, and an LR starts from attL. This is the
   usual mistake of leaving out the BP, or of opening the wrong tab._
4. Click **BP**, with `GW-Insert` as the **attB substrate**
   and `GW-pDEST` as the **donor vector**: **GW-pDEST has no attP site annotated.
   A BP needs two, flanking the cassette they replace.**
   _Why: a destination vector has attR sites, so it is not a donor; the panel
   says which kind it was looking for._
5. Choose `GW-pDONR` as the donor vector again, and the BP is back.

## Background

[Gateway](../guide/12-cloning.md#gateway) on the Bench in the user guide, which
also covers a vector annotated on the other strand, the check against a ccdB
gene on the wrong circle, the frame warning for a tag in the backbone, and why a
multisite reaction is done a fragment at a time. The design note is
item 48 (`docs/design/48-gateway.md`).

PlasmidPop reads the att sites from the annotation and carries no att sequences,
and it does not design attB primers or annotate a PCR product's attB tails. To
use your own gene, make the PCR product in the lab (or add the attB sites to the
sequence yourself) and annotate its two sites `attB1` and `attB2`; see
[Features](../guide/05-features.md). There is no NCBI gene path in this
tutorial: a gene from NCBI would need those sites added by hand first, and
nothing in these pages contains a third-party record.

Back to the [tutorials index](README.md).
