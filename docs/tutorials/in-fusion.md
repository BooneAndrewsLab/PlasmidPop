# In-Fusion and NEBuilder: one gene into a linearised vector

Put one gene into a vector cut at a site you choose, with the app designing the
two insert primers that carry the vector's ends as 5′ tails, then reading the
circle they would make. About eight steps with a synthetic ORF, then again with
insulin from NCBI. About 20 minutes. In-Fusion (Takara) and NEBuilder HiFi
(NEB) work like the [Gibson assembly](gibson.md) of the previous page, so read
that one first; this page only adds the primers. Read
[Before you start](before-you-start.md) if the Bench or the sample files are new
to you.

**Files for this tutorial** (synthetic, plain downloads):
[pIF-Vector.gb](files/pIF-Vector.gb) and [IF-gene.gb](files/IF-gene.gb). Every
file is a **synthetic example** (invented sequence), and every number below is
checked by `src/core/cloning/inFusionTutorial.test.ts` and
`src/app/components/GibsonTutorial.test.tsx`, which run these same files
through the functions the Cloning tab's digest and the Gibson panel use, so the
page cannot drift from the app without the build failing.

### Five words

- **Linearised vector**: the vector opened at the place the gene will go. Its
  two ends are what the insert has to match.
- **Tail**: the 5′ end of a primer that does not pair with the template. Here a
  tail is a copy of the vector's end, 15 bases for In-Fusion and 20 for NEBuilder
  HiFi.
- **Annealing part**: the 3′ end of the primer that pairs with the template and
  starts the copying. The app grows it until it melts at 60 °C.
- **Blunt end**: a cut that leaves no overhang. EcoRV cuts `GAT^ATC`, straight
  through its site.
- **Seamless**: no site is left at the junction; the gene sits against the cut
  vector's ends.

## The vector, and what the app does

`pIF-Vector.gb` is a circular 1,446 bp vector with a promoter and a terminator
and, between them, one EcoRV site. You cut it there, so the gene will sit
between promoter and terminator. PlasmidPop designs the two primers that add
the vector's ends to the gene, runs the PCR and the assembly on the screen, and
opens the result. You never type a sequence.

In the app this designer sits at the bottom of the **Gibson** panel on the
Bench, as **Design insert primers (In-Fusion, NEBuilder)**, because the reaction
is the Gibson one.

Before you start, close every tab you do not need.

## Tutorial 1: one gene into a vector cut with EcoRV

Choose one path. They are independent.

### Path A: a synthetic ORF

`IF-gene.gb` is a plain 603 bp open reading frame, `synthProt`, ATG to stop,
with no cloning ends and no EcoRV site.

1. **File ▸ Open**, select `pIF-Vector.gb` and `IF-gene.gb` (or drag both onto
   the window). Click the **pIF-Vector** tab so it is in front.
   _Why: the digest works on the document in front._
2. In the **Enzymes** tab, **Hide all**, then find **EcoRV** with the **Filter**
   box and tick it. It cuts once.
   _Why: the Cloning tab's digest uses only the ticked enzymes._
3. Open the **Cloning** tab (picker: **Digest**). Expect one fragment of
   **1,446 bp**, with an `EcoRV` end at each side (blunt). Click **Open** on its
   row. A new tab opens, `pIF-Vector EcoRV fragment`, linear, 1,446 bp.
   _Why: Open makes the cut vector a document of its own, which is what the
   designer asks for. A circle, `pIF-Vector`, has no ends to match._
4. Click the **Bench** tab, then **Gibson** at the top of the middle column.
   Ignore the red line, **Nothing follows pIF-Vector EcoRV fragment: no other
   part starts with its last 15 bases or more. 1 of 2 parts were never
   reached.**, and **1 document left out** (the circular vector): they are the
   assembly above the designer looking at tabs that do not yet share ends.
   _Why: the tube is every open tab. The primers will make the gene join the
   vector; until then the two are two unrelated pieces._
5. At the bottom, open **Design insert primers (In-Fusion, NEBuilder)**. The two kit buttons read **In-Fusion** (selected, 15 bases of homology) and **NEBuilder HiFi**. Set **Linearised vector** to
   `pIF-Vector EcoRV fragment` and **Insert from** to `IF-gene`. **Insert** reads
   `synthProt (CDS), 1–603, 603 bp`.
   _Why: the vector says what the tails are, the template says what to amplify,
   and Insert says which part of it._
6. Read the two primers. Upper case is the vector's end; the rest anneals:
   - **Forward**, **37 nt: 15 of vector, 22 annealing at 60 °C**:
     `ATGACAGCGGCTGATatgtgtagcgagcgtatgcgtt`
   - **Reverse**, **40 nt: 15 of vector, 25 annealing at 60 °C**:
     `GGGCCCCTTGCGGATttatggctgccaactgtatacgcac`

   _Why: the forward tail is the vector's last 15 bases, ending `GAT`; the
   reverse tail is the reverse complement of its first 15, so it also ends
   `GAT`, read from the other strand._

7. Read the **Product** line, **2,049 bp, circular**, with `KanR`, `ori`,
   `synthetic promoter`, `synthetic terminator` and `synthProt`. Under it the
   panel says **The parts assemble, but the tube may also give something else:**
   and gives one note: **In-Fusion asks for 15 bases of homology, which both
   tails carry**.
   _Why: the design is run, not promised: the panel amplifies the insert with
   these primers and assembles the amplicon with the vector, and shows the
   circle._
8. Click **Open product**. A new tab opens,
   `pIF-Vector EcoRV fragment+IF-gene PCR product assembly`. Open its **Features**
   tab and its **Enzymes** tab and tick through the checklist.
   _Why: the product is a scratch document; **File ▸ Save** if you want to keep
   it._
9. Optional: back on the Bench, click **NEBuilder HiFi** beside **In-Fusion**. The
   tails grow to 20 bases: **Forward** reads **42 nt: 20 of vector, 22 annealing**
   and **Reverse** **45 nt: 20 of vector, 25 annealing**, the annealing parts
   are the same, and the product is still 2,049 bp.
   _Why: the two kits differ here only in how much homology they ask for._

**Did it work?**

- [ ] Product **2,049 bp** (1,446 + 603), **circular**.
- [ ] Features: `KanR`, `ori`, `synthetic promoter`, `synthProt`,
      `synthetic terminator`, and the two primers, `Forward` and `Reverse`.
- [ ] **EcoRV** has **0 sites** in the product (the vector had 1): the gene
      sits at the cut, and no site is rebuilt at either junction.
- [ ] The promoter side reads `GAT` then the gene's own `ATG`, and the stop codon
      is followed by `ATC`: the two halves of the old EcoRV site, now with the
      gene between them.
- [ ] `synthProt` is one open reading frame of **200 residues** and a stop.
- [ ] The Enzymes tab has the default ticks, every enzyme that cuts the product
      once. An In-Fusion design has no enzyme of its own to tick.

**Two things that look odd and are right.** First, the product's map starts at the fragment's first base, `ATC`,
after the cut, so the gene begins at base 1,447 rather than near the origin:
the circle is the same, only the numbering starts elsewhere. And the two
annealing parts are different lengths (22 and 25 bases) because each grows until
it melts at 60 °C.

### Path B: a gene from NCBI (human insulin, NM_000207)

The record is third-party data, so you fetch it; nothing in this folder
contains it. It needs a network connection, and only the accession you type
leaves the browser.

1. Do steps 1 to 3 of Path A with `pIF-Vector.gb` only: open it, tick **EcoRV**
   alone, **Open** the fragment in the Cloning tab. Close any other tab.
2. **File ▸ Open from NCBI…**, type `NM_000207` and click **Open**. The record
   opens as a tab of its own, `NM_000207`.
   _Why: a gene off NCBI has no cloning ends, so the primers will add them._
3. Click the **Bench** tab and **Gibson**. In **Design insert primers**, set
   **Linearised vector** to `pIF-Vector EcoRV fragment` and **Insert from** to
   `NM_000207`. In **Insert**, choose `insulin preproprotein (CDS), 60–392,
333 bp`.
   _Why: the CDS is the part to amplify, not the whole mRNA record._
4. Read the primers:
   - **Forward**, **33 nt: 15 of vector, 18 annealing at 61 °C**:
     `ATGACAGCGGCTGATatggccctgtggatgcgc`
   - **Reverse**, **41 nt: 15 of vector, 26 annealing at 61 °C**:
     `GGGCCCCTTGCGGATctagttgcagtagttctccagctggt`

   The **Product** line reads **1,779 bp, circular**, followed by the notes of
   Path A.

5. Click **Open product**. The tab is
   `pIF-Vector EcoRV fragment+NM_000207 PCR product assembly`.

**Did it work?**

- [ ] Product **1,779 bp** (1,446 + 333), **circular**.
- [ ] Features: `KanR`, `ori`, `synthetic promoter`, `synthetic terminator`,
      `INS` with the insulin chain features, and the two primers.
- [ ] **EcoRV** has **0 sites** in the product.
- [ ] Translating from the insulin start codon reads
      `MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN*`:
      preproinsulin, one frame, one stop; `GAT` sits just before the `ATG`.
- [ ] With **NEBuilder HiFi** the tails are 20 bases and the product is the same
      1,779 bp.

(The oligos depend on the template, the kit and the annealing rule, so a
different gene gives different ones. What does not depend on the oligos is the
vector and the insert length: the product is always the vector plus the insert.)

## Background

[In-Fusion and NEBuilder: designing the insert primers](../guide/12-cloning.md#in-fusion-and-nebuilder-designing-the-insert-primers),
and [Gibson](../guide/12-cloning.md#gibson) for the reaction. To linearise a
vector by PCR instead of by a digest, see
[PCR](../guide/12-cloning.md#pcr) (inverse PCR).

Back to the [tutorials index](README.md).
