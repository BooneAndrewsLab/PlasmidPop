# Digest and PCR basics: cut a plasmid, copy a gene

The two operations every other tutorial builds on, in the **Cloning** tab of
the sidebar. Part 1 cuts a plasmid with restriction enzymes, reads the
fragments, the ends the enzymes leave and the gel they would make, blunts an
end and puts pieces on the shelf. Part 2 amplifies a gene with a primer pair,
adds restriction sites with 5′ tails, shelves the product, cuts it, and shows
what the panel says when the primers cannot work. Nine steps in Part 1 and ten in
Part 2, about 30 minutes. Read [Before you start](before-you-start.md) first if
the sample files or the enzyme ticks are new to you.

**Files for this tutorial** (synthetic, plain downloads):
[pLig-Vector.gb](files/pLig-Vector.gb) for the digest and
[SDM-Template.gb](files/SDM-Template.gb) for the PCR. Both are **synthetic
examples** (invented sequences) that other tutorials use too, and every number
below is checked by `src/core/cloning/digestPcrTutorial.test.ts` and
`src/app/components/DigestPcrTutorial.test.tsx`, which run these same files
through the functions the Digest and PCR panels use, so the page cannot drift
from the app without the build failing.

Nothing on this page joins anything: joining is the **Bench**, and the
[tutorials](README.md) after this one use it. What these two panels give the
Bench is the **shelf**, the parts you collect here. There is no NCBI gene path
in this tutorial: a gene fetched from NCBI is digested and amplified the same
way, step for step, but these exercises need plasmids whose sites and primer
positions are known, and nothing in these pages contains a third-party record.

### Eight words

- **Digest**: cutting DNA with restriction enzymes. The panel cuts the document
  with the enzymes **ticked in the Enzymes tab**, all at once and completely,
  and lists the pieces.
- **Fragment**: one piece of a digest. A circle cut once is **one** fragment,
  opened up; a circle cut n times gives n; a linear molecule cut n times gives
  n + 1.
- **Sticky end**: an end where one strand sticks out past the other. EcoRI
  leaves a 5′ overhang, `AATT`. Two sticky ends with the same overhang can
  pair; that is what ligation uses.
- **Blunt end**: both strands stop together, as EcoRV leaves them. A PCR product
  from a proofreading polymerase is blunt at both ends.
- **Blunting**: turning a sticky end into a blunt one. **Fill in** (Klenow or T4
  DNA polymerase) copies a 5′ overhang into base pairs; **trim** (mung bean
  nuclease) removes an overhang.
- **Shelf**: the parts you collect for the Bench. It lives in the browser, so a
  part stays until you remove it.
- **Primer**: a short oligo written 5′ to 3′ as you would order it. Only its 3′
  end has to match the template; the rest is a **tail**, and it is copied into
  the product all the same.
- **Tm**: the melting temperature of the part that anneals. A primer with a tail
  has two, one on the template and a higher one once the product carries the
  whole oligo.

## The files

| File           | Length   | What it is                                                                                                                                                                  |
| -------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pLig-Vector`  | 2,664 bp | Circular: `synthetic promoter`, `MCS` (EcoRI, PstI, BamHI), `synthetic terminator`, `AmpR` (reverse strand), `ori`. EcoRI, PstI, BamHI and EcoRV cut it once; XhoI twice.   |
| `SDM-Template` | 1,241 bp | Circular: `synthetic promoter`, `synthORF` (139–441, 100 codons and a stop), `synthetic terminator`, `AT-rich spacer`, `AmpR` and `ori` stand-ins. One EcoRI and one BamHI. |

The enzymes' positions are all you need for Part 1: EcoRI cuts `pLig-Vector` at
233 and XhoI at 653 and 1,928, EcoRV at 1,067 (blunt). The EcoRI and BamHI
sites of `SDM-Template` are outside `synthORF`, so a PCR that copies only the
gene has neither, and the tails in Part 2 add them.

## Part 1: the digest

1. **File ▸ Open**, select `pLig-Vector.gb`. Close every other tab. Open the
   **Enzymes** tab and click **Hide all**, then type `EcoRI` in **Filter** and
   tick it. Under **Fragments from ticked enzymes** the list reads `2,664 bp`
   and the note says **On a gel: 1 band, 2,664 bp.**
   _Why: the digest follows the ticks and nothing else. A file you open opens
   with every single cutter ticked, so clear them and tick only what the step
   says._
2. Click the **Cloning** tab and pick **Digest** under **Reaction**. The
   heading reads **Digest with ticked enzymes** with `EcoRI` beside it, and the
   note **1 fragment, largest first.** There is one row: **2,664 bp**, range
   `234–233`, ends `EcoRI 5′ AATT` on both sides, and the features it carries:
   `synthetic promoter, MCS, synthetic terminator, AmpR, +1 more`.
   _Why: one cut opens a circle. The same 2,664 bases are now a linear piece
   that starts just after the cut and runs round the old origin to end just
   before it, which is why its range wraps._
3. Go back to the **Enzymes** tab, type `XhoI` in **Filter** and tick it as
   well, so `EcoRI` and `XhoI` are ticked. **Fragments from ticked enzymes**
   now draws a lane for the double digest, a lane for each enzyme alone, and a
   ladder; the sizes read `1,275, 969, 420 bp` and the note **On a gel: 3
   bands, 1,275 + 969 + 420 bp.** In the **Cloning** tab there are three rows:

   | Fragment | Range     | Left end        | Right end       |
   | -------- | --------- | --------------- | --------------- |
   | 1,275 bp | 654–1,928 | `XhoI 5′ TCGA`  | `XhoI 5′ TCGA`  |
   | 969 bp   | 1,929–233 | `XhoI 5′ TCGA`  | `EcoRI 5′ AATT` |
   | 420 bp   | 234–653   | `EcoRI 5′ AATT` | `XhoI 5′ TCGA`  |

   _Why: three cuts on a circle, three pieces, and each end names the enzyme
   that made it, so you can see which will pair with which._

4. Hover the **969 bp** row: the map and the sequence view draw that piece as a
   solid arrow while the others stay dashed. Click its length to select it in
   the views. Click a band in the gel in the Enzymes tab: the piece it stands
   for is selected too.
   _Why: the sizes alone cannot tell you where a piece is. The hover tells you
   which one is the backbone and which is a stretch you could cut out._
5. In the **Enzymes** tab, untick `EcoRI`, leaving only `XhoI`. The sizes read
   `1,389, 1,275 bp` and the note, now in the warning colour, reads **On a gel:
   1,389 ×2 bp — one band, so there is nothing to tell apart; 1,389 and 1,275
   run together.**
   _Why: two fragments are two pieces of DNA however they look on a gel. The
   gel is a rule of thumb: two bands within about 15 % of each other are called
   one, and these are less than 10 % apart._
6. Click **Hide all**, then tick `EcoRI` and `EcoRV` (use **Filter** for each).
   The **Cloning** tab lists two fragments:

   | Fragment | Range     | Left end        | Right end       |
   | -------- | --------- | --------------- | --------------- |
   | 1,830 bp | 1,068–233 | `EcoRV` blunt   | `EcoRI 5′ AATT` |
   | 834 bp   | 234–1,067 | `EcoRI 5′ AATT` | `EcoRV` blunt   |

   _Why: this is a sticky end beside a blunt one. EcoRV cuts in the middle of
   `GATATC` and leaves nothing sticking out, so its end says only `blunt`; hover
   an end and the tooltip describes it in words._

7. Click **Add** on the **834 bp** row. The button reads **Added ✓** for a
   moment and then **Add again**, the row says **On shelf**, and the last line of
   the tab reads **The shelf holds 1 part, 834 bp.**
   _Why: the shelf is where a fragment waits for the Bench. It is a copy, with
   its ends and features, so it stays when you close the tab._
8. Click **Open** on the **1,830 bp** row. A tab opens, `pLig-Vector EcoRV-EcoRI
fragment`, with the **Features** tab in front. The toolbar names the ends
   beside the length, `1,830 bp, linear · EcoRV blunt / EcoRI 5′ AATT`, and at
   the EcoRI end of the sequence view the other strand's four bases are drawn
   just outside the last column. In the edit bar click **Blunt (fill in)**. The toolbar
   now says `1,834 bp` and `EcoRV blunt / EcoRI blunt`: the four bases of the
   overhang `AATT` were copied into base pairs. Press `Ctrl+Z` once to see the
   sticky end come back, and `Ctrl+Shift+Z` to blunt it again.
   _Why: a blunt end joins any other blunt end, so this is how an EcoRI end is
   made to meet an EcoRV one. **Blunt (trim)** is the other way: it removes the
   overhang instead, and here leaves the length at 1,830, because the top
   strand of this end already stops at the cut._
9. Open the **Enzymes** tab, click **Hide all**, then the **Cloning** tab. The
   panel says **No enzyme is ticked**, and the molecule is still listed as one
   fragment, **1,834 bp**, with the ends it has. Click **Add**. The shelf line
   now reads **The shelf holds 2 parts, 2,668 bp.**
   _Why: an uncut linear molecule is one fragment with its own ends, which is how
   a piece you blunted or opened is put on the shelf._

**Did it work?**

- [ ] EcoRI alone: **1 fragment, 2,664 bp**, range `234–233`, both ends
      `EcoRI 5′ AATT`.
- [ ] EcoRI and XhoI: **1,275, 969 and 420 bp**, three bands; XhoI alone:
      **1,389 and 1,275 bp**, which run as one band.
- [ ] EcoRI and EcoRV: **1,830 and 834 bp**, one sticky end and one blunt end
      each.
- [ ] The opened 1,830 bp piece reads `EcoRV blunt / EcoRI 5′ AATT`, and after
      **Blunt (fill in)** `1,834 bp` with `EcoRV blunt / EcoRI blunt`.
- [ ] The shelf holds **2 parts, 2,668 bp** (834 and 1,834).

## Part 2: the PCR

Clear the shelf first, so the counts below start at none: open the **Bench**
(the link at the bottom of the Cloning tab) and press **Clear shelf**. Then
**File ▸ Open** `SDM-Template.gb`, close the other tabs, and make `SDM-Template`
the tab in front.

1. In the **Cloning** tab pick **PCR** under **Reaction**. The heading reads
   **PCR** with `two primers, one template` beside it, and the panel says to
   paste the two oligos. Under **Template** there is a choice only when another
   tab is open.
   _Why: the template is the document in front of you. Nothing else is asked,
   because everything you decided is in the two sequences._
2. Paste into **Forward primer**:
   `ATGGCAAGGGGGCGTCTGTG`
   and into **Reverse primer**, written 5′ to 3′ as you would order it:
   `TTATACTTCCACCAGAAGACGGTAACTG`.
   Under the first box the panel says **20 nt, Tm 63 °C · → 139–158**, and under
   the second **28 nt, Tm 59 °C · ← 414–441**.
   _Why: the arrow is the strand the primer copies and the numbers are where it
   lands. The forward primer is the start of `synthORF` and the reverse one is
   the reverse complement of its last 28 bases, ending at the stop codon. The
   reverse is longer because the end of the gene is AT-rich, and it takes 28
   bases to reach a melting temperature near the forward's._
3. The panel says **One product:** and lists **303 bp**, `139–441`, **exact
   match**, with **Show**, **Shelve** and **Open**. Under it a gel draws one
   band in a lane labelled **PCR**. Set **Polymerase** to **Taq**: the product
   is **304 bp**, one base longer, because Taq adds an A to each 3′ end (the
   panel's note says **One 3′ A on each end, for TA cloning**). Set it back to
   **Proofreading**.
   _Why: 303 bp is the whole gene, 139 to 441, from the start codon to the stop.
   A proofreading polymerase leaves blunt ends; a length counts the A a
   Taq product carries._
4. Click **Show**. The map and the sequence view draw the product as a span with
   the two primers as arrows on it, and the button reads **Hide**. Click **Hide**
   to take them off.
   _Why: seeing where the pair lands on the plasmid is how you notice a primer
   that also binds somewhere you did not mean. With more than one product the
   panel lists them all, cleanest and shortest first._
5. Replace the primers with ones that carry a restriction site on a tail. Forward:
   `GGGAATTCTTATGGCAAGGGGGCGTCTGTG`
   and reverse:
   `GCGGATCCTTTTATACTTCCACCAGAAGACGGTAACTG`.
   Under them the panel says **30 nt, 10 of them a 5′ tail, Tm 63 °C on the
   template, 67 °C once the product carries it · → 139–158** and **38 nt, 10 of
   them a 5′ tail, Tm 59 °C on the template, 66 °C once the product carries it ·
   ← 414–441**. The product is **323 bp**, `139–441`, **exact match, 20 bp of
   tail**.
   _Why: the tail is `GGG` + `GAATTC` (EcoRI) + `TT` on the forward and `GCG` +
   `GGATCC` (BamHI) + `TT` on the reverse. The bases outside the site are a
   clamp, because an enzyme cuts poorly at the very end of a molecule. The
   positions stay 139–441 because a tail pairs with nothing, yet the product is
   20 bp longer because it carries both tails. The two temperatures are why a
   tailed pair is cycled first at the lower Tm and then at the higher._
6. Click **Shelve**. The last line of the tab reads **The shelf holds 1 part,
   323 bp.** The part is the whole product, blunt at both ends, with its two
   primers as features, and marked dephosphorylated, because oligos are made
   without a 5′ phosphate unless you order them with one.
   _Why: a shelved product can go on the Bench, but it still has to be cut: its
   sites are not exposed until an enzyme has cut them._
7. Click **Open**. A tab opens, `SDM-Template PCR product`, linear, 323 bp, with
   `synthORF` and a `Forward` and a `Reverse` primer feature on it. In its
   **Enzymes** tab click **Hide all**, then tick `EcoRI` and `BamHI`, and in the
   **Cloning** tab (**Digest**) read the three fragments:

   | Fragment | Left end        | Right end       |
   | -------- | --------------- | --------------- |
   | 313 bp   | `EcoRI 5′ AATT` | `BamHI 5′ GATC` |
   | 7 bp     | `BamHI 5′ GATC` | plain blunt end |
   | 3 bp     | plain blunt end | `EcoRI 5′ AATT` |

   The 313 bp row is `4–316`. Click **Add** on it. The shelf now holds 2 parts,
   636 bp.
   _Why: the clamps are what is left over. The 313 bp piece is the gene with an
   EcoRI end and a BamHI end, the same two enzymes in the same order as the
   `MCS` of `pLig-Vector`, so it is ready for [Ligation](ligation.md), which is
   where this tutorial hands over._

8. Look at the sequence of the `SDM-Template PCR product` tab: its first ten
   and last ten bases are in capitals and the gene between them in lower case.
   _Why: upper case in a product means "not from the template", the way a primer
   is written out in a paper. What is left in capitals is the 5′ tails and any
   mismatch._
9. Back in the `SDM-Template` tab, try the first wrong pair. Forward:
   `ATGGCAAGGGGGCGTCTGTG`
   and reverse, pasted as it stands in the gene and not reverse-complemented:
   `CAGTTACCGTCTTCTGGTGGAAGTATAA`.
   The panel shows no product and says: **Both primers anneal to the same strand
   of SDM-Template, so they both copy the same way and nothing is amplified.
   One of them wants reverse-complementing.**
   _Why: a reverse primer is the reverse complement of the template's end. A
   primer pasted straight from the sequence copies the same strand as the
   forward one, so the two never meet._
10. Now a primer that matches nothing. Forward: `ACGTACGTACGTACGTACGTAC`, with
    the good reverse from step 2. Under the forward box the panel says **22 nt —
    no 3′ end long enough to prime. The last 5 bases have to match exactly.**
    and, in red, **Forward does not anneal to SDM-Template, so there is nothing
    for the other primer to meet.** No **Shelve** button appears.
    _Why: a polymerase extends from the 3′ end, so the last five bases must
    match whatever the rest of the oligo does; up to two mismatches further back
    are allowed, and are carried into the product._

**Did it work?**

- [ ] The plain pair: **303 bp**, `139–441`, forward **20 nt, Tm 63 °C**,
      reverse **28 nt, Tm 59 °C**; with Taq **304 bp**.
- [ ] The tailed pair: **323 bp**, **20 bp of tail**, Tm **63** and **59 °C** on
      the template, **67** and **66 °C** with the tails.
- [ ] The shelf took the product (**323 bp**) and then the **313 bp** EcoRI–BamHI
      piece cut from it: **2 parts, 636 bp**.
- [ ] The product's digest with `EcoRI` and `BamHI` has **three** fragments,
      **313, 7 and 3 bp**.
- [ ] A reverse primer that is not reverse-complemented gives the **same
      strand** message; a primer that does not match gives **does not anneal**.

## Odd-looking, and right

- **One cut, one fragment.** A circular plasmid cut once is not two pieces: it
  opens into one linear molecule of the same length, 2,664 bp, and the Cloning
  tab lists it, because that molecule is what you would clone into. An uncut
  circle gives nothing to work with.
- **Two fragments, one band.** XhoI cuts `pLig-Vector` into 1,389 and 1,275 bp,
  and the gel draws one band, because two sizes within about 15 % are called
  one. The panel says so rather than showing two fragments you could not tell
  apart. A different second enzyme, as in step 3, separates them.
- **Pointing away is not wrong on a plasmid.** Paste forward
  `CAGTTACCGTCTTCTGGTGGAAGTATAA` and reverse `CACAGACGCCCCCTTGCCAT`, the two
  ends of `synthORF` each pointing out of the gene. The panel does not call it
  an error: on a circle that is the long way round, and it lists **986 bp**,
  `414–158, over the origin`. That is inverse PCR, how a vector is linearised.
  On a linear template the same pair would say that the primers point away from
  each other.
- **Methylation.** Some enzymes will not cut a site that dam or dcm methylation
  covers. None of the sites in these two files is in such a context, so the
  numbers above do not depend on it; when one is, the Cloning tab says how many
  sites it left out and why. See
  [Where the DNA was grown](../guide/07-enzymes.md#where-the-dna-was-grown).

## Where to next

Back to the [tutorials index](README.md). [Ligation](ligation.md) takes the
pieces you shelved here and joins them on the Bench, and the guide's
[Digest](../guide/12-cloning.md#digest), [Sticky ends on a
document](../guide/12-cloning.md#sticky-ends-on-a-document),
[PCR](../guide/12-cloning.md#pcr) and [The shelf](../guide/12-cloning.md#the-shelf)
are the reference for what you did here.
