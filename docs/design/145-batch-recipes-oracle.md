# 145. The Batch page's restriction-sites, homology-ends and Golden Gate extras against pydna and Biopython

Issue #431, 2026-11-11. Item 143 checked the Batch page's Golden Gate
constructs end to end and left the other two recipes, and some Golden Gate
columns, to a follow-up. This area is that follow-up, in the same shape:
PlasmidPop's side is exported first (the batch runs on seeded inputs with the
real designers, through the table reader and `validateBatch`), and a Python
oracle then judges it without our code.

Code: `src/test/oracle/batchRecipes.test.ts` (seeded cases, exporter, gate),
`scripts/oracle/batchrecipes.py` (judge, which imports the Golden Gate judge of
`batchgoldengate.py`), `src/test/oracle/batchRecipes.json` (data).
`scripts/oracle/run.sh batch-recipes` regenerates it; it is not part of
`run.sh generate`.

## Cases

Seed 20261111; 25 vectors, 121 rows (109 with a construct).

- **Restriction sites** (9 batches, 56 rows). The tutorial's Exercise 5
  (`pLig-Vector`, EcoRI/BamHI, cloning site 233..262) with extra rows: a Kozak
  sequence in `left` and a stop codon in `right`, a per-row pair `PstI/BamHI`
  (a 3-prime overhang), `BamHI/EcoRI` (the pair the other way round) and a
  reverse-strand region. Eight random vectors, each a cloning site of four
  enzymes from a panel of nine with one overhang family each (EcoRI, BamHI,
  HindIII, NcoI, XhoI, KpnI, PstI, NdeI, NotI), 8-12 bases apart, between two
  random flanks free of every panel site; turned to start anywhere, in two cases
  with the origin inside the cloning site (the region then runs past the end of
  the sequence) and in two read from the other strand. Rows: forward, reverse,
  whole-template, bare-sequence and, on circular templates, regions across the
  origin on either strand; the batch's pair, a per-row `enzyme` pair in either
  order, per-row `left`/`right` (extra5/extra3) and the batch's own
  extra5/extra3.
- **Homology ends** (9 batches, 30 rows). The tutorial's `GB-Vector` with
  In-Fusion and one row per other kit (`kit` column); then In-Fusion,
  NEBuilder HiFi, yeast at the default 40 bases and at 30 and 60, on random
  linear vectors of 500-900 bases and linear and circular templates (regions
  across the origin included), with a random `kit` cell on 3 batches.
- **Golden Gate extras** (7 batches, 35 rows), the destination layout of item
  143: BsaI with BsmBI and BsmBI with BsaI in the tube (`secondEnzyme`), a
  part clean of both and one carrying a site of the second; a destination with a
  BsaI cassette and a BsmBI one and rows that name `enzyme` BsaI, BsmBI or both
  (two cassettes with both enzymes in the tube); extra5/extra3 on the batch and
  `left`/`right` on the rows: the destination's own overhangs spelled out, a
  pair no destination takes, the pair swapped, and one overhang alone.

Random bodies carry no site of the enzymes in play, so the junctions are what is
tested, not an internal site (the one deliberate exception is above).

## What is judged, and by what

Every row: pydna `amplify.pcr` with PlasmidPop's two primers must give one
product, the designer's amplicon. The insert is then read from the table and the
template by the oracle's own parser, never from the design.

Restriction sites. The amplicon must read padding, the forward enzyme's site
(read by `Bio.Restriction.search` on the primer), extra5, the insert, extra3,
the reverse site and padding, and each primer's 3-prime end must be the insert's
end. Route B, pydna: the vector cut with the pair (two pieces, the shorter being
the stretch the insert replaces), the amplicon cut with the pair, the piece with
a sticky end each side joined to the backbone with `+` (which refuses ends that
do not fit) one way round or the other, `looped()`. Route C, Biopython only: the
cuts of each enzyme from `search`, the replaced stretch the shorter way round
between them, the amplicon taken the way round that puts each enzyme's end at its
own cut, and the single-stranded ends compared. Both circles must equal the
construct up to rotation and strand and agree about which way round the insert
goes, which must be the `orientation` PlasmidPop reports. The construct's panel
sites must be those of the backbone and of the insert piece plus the two the
junctions rebuild, and each of those two within a site's reach of a junction, so a
site made where tail and vector or insert meet is found.

Homology ends. The amplicon must be the vector's last `overlap` bases, the insert
and the vector's first `overlap` bases, with `overlap` the kit's published
homology as the oracle states it (15, 20 and 40, or the batch's for yeast), and
each primer must begin with its tail. `pydna.assembly.Assembly` on the linear
vector and the amplicon at that overlap must close into a circle (it makes both
strands) equal to the construct and to the vector followed by the insert.

Golden Gate extras. The judge of item 143 (pydna cut and join, a splice from
Biopython's cuts, no site at a junction, the overhangs the destination's, each
primer padding, site, spacer and overhang) and, for a tube with two enzymes, a
third route: pydna with both enzymes cutting amplicon and destination must give
one backbone and one insert and the same circle, and the amplicon must carry no
site of the second enzyme. The construct must contain left overhang, extra5, the
part, extra3 and right overhang as the table gives them (the designer leaves a
stop codon at the end of a region out unless `include_stop` keeps it; the
oracle accepts the region with or without it and records which in
`stopLeftOut`). A row with no construct is confirmed by a reason of the oracle's:
pydna with the tube's enzymes cannot find one backbone and one insert (the part's
site of the second enzyme splits it; two opened cassettes leave two backbone
pieces), or the Biopython splice fails because the overhangs on the primers,
which the oracle checks are those the row names, are not the destination's.

## Negative controls

On the first row of each of restriction and homology: one base changed, one
deleted, one added, 60 bases turned round and, for restriction, a site of a
panel enzyme the pair does not use planted at a junction (refused by the site
check itself, not only the circle comparison) must each be refused, and the
right construct rotated and read from the other strand accepted. 11 controls in
the JSON; the generator stops when one is not as it must be, and writes nothing
when any row disagrees.

## Result

All 121 rows agree: the oracle's circle is PlasmidPop's construct in each of the
109 that are built, 56 restriction rows (35 with the insert along the vector's
top strand, 21 against it), 30 homology rows and 23 Golden Gate rows. The 12
rows with no construct are refused for the reasons above (2 parts with a site of
the second enzyme, 4 with two cassettes opened, 6 with overhangs that are not
the destination's). The tutorial's counts are reproduced (3,348, 2,946 and 2,766
bp for restriction; 2,208, 1,806 and 1,626 for In-Fusion). No discrepancy was
found, so none was filed. Versions: the JSON is stamped with Biopython 1.85 and
pydna 5.5.7.

## Not done

- The `flipped` setting of the restriction and homology recipes is not
  exercised: a given enzyme pair fixes the orientation (it only chooses among
  suggested pairs), and the oracle checks the orientation that results.
- Bundled enzymes beyond the panel (blunt cutters, which the designer refuses,
  Type IIS enzymes as a restriction pair) are not covered.
- Linear vectors with sticky ends for homology, and a restriction vector with
  no cloning site (the whole molecule is the region), are not judged.
