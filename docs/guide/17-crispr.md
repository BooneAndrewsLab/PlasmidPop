# CRISPR guides

The **CRISPR** tab finds guide RNA target sites: every protospacer next to a
PAM, on both strands, including sites that cross the origin of a circular
sequence. The scan runs in the background and follows the document, so an
edit gives a new list without asking.

Each row shows the strand (→ forward, ← reverse), the spacer with its PAM
run on in grey, the GC content, and the off-target counts. A row with a `!`
has something worth a look — hover it for what. Clicking a row selects the
protospacer in the views and opens its details below.

While the tab is open, every guide listed is drawn on the map and in the
sequence view as an arrow on its own strand labelled with its PAM (see
[Previews](03-viewing.md#previews)); clicking one there opens it here. Past
200 guides none are drawn and only the first 200 are listed — narrow the
scan to a selection to see the rest.

## What it cannot tell you

**Off-targets are counted in the open documents only.** PlasmidPop has no
genome and makes no network request to search one, so the counts say where
else a guide would cut _this plasmid_ — which is what matters when the guide
has to leave the backbone alone — and nothing whatever about specificity in
a cell. Check a guide against the host genome with a genome-wide tool
(CRISPOR, CHOPCHOP, Benchling) before ordering it.

There is no on-target efficiency score. The published scores are trained
models, and PlasmidPop ships a number only when it can be checked against
the implementation it came from; until then the flags below are what it
will stand behind.

## Nucleases

**Nuclease** picks what to look for:

| Nuclease | PAM      | Spacer | Cut                                             |
| -------- | -------- | ------ | ----------------------------------------------- |
| SpCas9   | `NGG`    | 20 nt  | blunt, 3 bp from the PAM                        |
| SaCas9   | `NNGRRT` | 21 nt  | blunt, 3 bp from the PAM                        |
| AsCas12a | `TTTV`   | 23 nt  | staggered, 5-base 5′ overhang, PAM 5′ of spacer |

**Custom PAM…** takes a PAM written in IUPAC codes — `N` any
base, `R` A or G, `V` not T, and so on — and a spacer length of 15–30. A custom PAM is taken to sit 3′ of
the spacer and to cut bluntly three bases in from it, which is what the
engineered Cas9 variants do (`NG` for Cas9-NG, `NRN` for SpRY, `NNNRRT` for
SaCas9-KKH). A nuclease with another geometry needs a preset.

An ambiguous base in the document never makes a guide: a PAM has to be
certain and a spacer has to be plain `ACGT`, so an `N` in a sequencing gap
cannot be mistaken for a target. The same `N` does still count _against_ a
guide as a possible off-target, so an ambiguity never hides one.

## Off-targets

**Off-targets to _n_ mismatches** sets how different another site may be and
still be counted, from 0 to 4. The counts in a row read exact, then one
mismatch, then two, and so on: `1 · 0 · 2 · 0` is one exact second site and
two sites differing in two bases. Only places with a real PAM are counted —
a near-match with no PAM is not a target.

**Count off-targets in the other open documents too** adds every other open
nucleotide document to the search, which is how to check that a guide for an
insert does not also cut the vector it is going into. The selected guide's
**Other sites** list says which document each hit is in, and **Show** jumps
to the ones in this one.

**Sort by** orders the list along the molecule, or worst-first by
off-targets — fewest exact hits, then fewest near ones.

## Flags

A guide is flagged for the things that are known to go wrong, none of which
are efficiency predictions:

- **Binds somewhere else exactly** — the spacer occurs at another PAM site
  in what was searched.
- **TTTT ends a U6 transcript** — four T's in a row terminate Pol III, so a
  guide expressed from a U6 promoter is cut short.
- **Low or high GC** — outside 40–80%.
- **A run of one base** — five or more of the same base in a row.

## Narrowing the scan

**Only cuts in the selection** keeps the guides whose cut falls inside the
selected range — select a feature in the feature list, or a stretch in
either view, to get the guides that cut there. The cut, not the protospacer,
is what has to be in the range, so a guide reading into the region from
outside it still counts if it cuts inside. For AsCas12a, whose two strands
are cut five bases apart, it is the break on the PAM strand that counts.

The region is taken when you tick the box, and the panel shows it under the
box. Clicking a guide afterwards selects that guide without narrowing the
list to it. To narrow to a different stretch, select it and press **Use the
selection now**, or untick and tick the box again.

## Ordering and annotating a guide

The selected guide's panel gives its protospacer range, spacer, PAM, where
both strands are cut, GC and flags.

**Oligos to order** writes the two oligos to anneal and clone, 5′→3′.
**pX330 / lentiCRISPRv2** adds the `CACC` and `AAAC` overhangs those vectors'
BbsI and BsmBI sites take, and a `G` in front of a spacer that has not got
one, since the U6 promoter starts with G. These are Cas9 sgRNA vectors, so
the choice is offered for SpCas9, SaCas9 and custom PAMs but not for
AsCas12a, whose crRNA vectors take other overhangs. **No overhangs** gives
the bare spacer and its reverse complement, for any nuclease. **Copy oligos** puts both on the
clipboard; **Save oligos to My primers** puts them in
[My primers](10-primers.md#my-primers), where they can be exported with the
rest of an order.

**Add as feature** annotates the protospacer on the document as a
`misc_feature` on its strand, with the PAM in a note, and takes you to the
feature list to name it. It is an ordinary edit, so undo takes it back.
