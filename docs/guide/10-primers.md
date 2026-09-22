# Primers

The **Primers** tab designs PCR primer pairs for a selected region and
checks primers you already have.

Melting temperatures use the nearest-neighbour method (SantaLucia 1998,
unified parameters) at 500 nM oligo and 50 mM monovalent salt. They are
good to about ±2 °C for ordinary PCR primers; adjust for your buffer.

## Designing primers for a region

1. Select the region to amplify in either view. It can be a feature (click
   it in the Features tab) or any range.
2. Open **Primers** and click **Design primers**.
3. Up to ten pairs are listed, best first. Each shows the forward and
   reverse primer with its Tm and GC content, the product size and the Tm
   difference between the two.
4. **Show** draws that pair in both views without touching the document:
   the two sites as dashed arrows pointing the way each primer reads, and
   the product between them as a bracket (see
   [Previews](03-viewing.md#previews)). It also selects the product, so the
   views scroll to it and the status bar gives its length. **Hide** takes
   both away again, the drawing and the selection, as does leaving the tab;
   if you have selected something else in the meantime that selection is
   yours and is left alone. Hovering a pair shows it for as long as the
   pointer is there — so three candidates can be compared without annotating
   anything.
5. **Add both as features** annotates the pair as `primer_bind` features
   (the primer sequence goes in a `/note`), so the sites are on the map and
   saved with the file. Unlike **Show**, this is an edit: it goes into the
   History and can be undone.

Candidates are 18–27 nt long with a Tm of 55–65 °C and no more than 3 °C
apart, and may start up to 200 bp outside the selection so the product
covers it with some margin. Pairs are ranked by a penalty that favours
a Tm near 60 °C, balanced GC, a GC clamp, little self-complementarity, a
length near 21 nt and a small Tm difference. If nothing qualifies, select more flanking sequence or
a different region.

## Checking a primer

Paste a sequence under **Check a primer**. You get its length, Tm, GC
content and whether it ends in a GC clamp, plus warnings for the usual
problems: shorter than 18 or longer than 30 bases, Tm below 52 or above
65 °C, GC outside 40–60 %, a run of five or more identical bases, a
self-complementary stretch of six or more, or no GC clamp.

With eight or more bases, the tab also searches the document for **binding
sites** on both strands: the 3′ end must match exactly and up to two
mismatches are allowed elsewhere. Every site found is previewed in both
views at once, so off-target binding is visible at a glance. Each site also
shows its strand, position and mismatch count in the list; click one to
select it, or **Add sites as primer_bind** to annotate them all.

Use this to check a primer from a paper or an old order against the plasmid
you have, and to spot off-target binding.

Note that this search asks whether the **whole** oligo matches, which is the
right question for "is this primer specific to my plasmid" and the wrong one
for a cloning primer with a 5′ tail — a restriction site or a Gibson homology
arm matches the template nowhere. To amplify with such a primer, use
[Cloning ▸ PCR](12-cloning.md#pcr), which anneals by the 3′ end and reports
the rest as a tail.
