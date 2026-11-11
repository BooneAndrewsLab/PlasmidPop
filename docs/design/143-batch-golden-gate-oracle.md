# 143. The Batch page's Golden Gate constructs against pydna and Biopython

Issue #430, 2026-11-08. The Batch page (item 141) designs tailed primers for
many inserts and builds the construct of each. `assembly.json` (item 37)
checks Golden Gate from given parts and `cloningEnds.json` (item 108) the
restriction ends; nothing checked the batch's own output end to end. This area
does, in the shape of item 122: PlasmidPop's side is exported first and the
Python oracle then judges it.

Code: `src/test/oracle/batchGoldenGate.test.ts` (the seeded cases, the
exporter and the gate), `scripts/oracle/batchgoldengate.py` (the judge),
`src/test/oracle/batchGoldenGate.json` (data). `scripts/oracle/run.sh
batch-golden-gate` regenerates it: the export test runs the batch and writes
every primer, amplicon and construct to a temporary file, then the Python reads
that and writes the JSON. It is not part of `run.sh generate`, which cannot run
the TypeScript batch, and the export is not committed (the constructs are in
the JSON as length, SHA-256 and first 60 bases, as `cloningEnds.json` does).

## Cases

15 destinations with 46 rows, all run with the default settings and the real
designer (`runCloningBatch`, as `batchTutorial.test.ts` drives it, through the
table reader and `validateBatch`):

- the tutorial's three rows (`gene_full`, `gene_head`, `mini`) into
  `pGG-Destination` (Exercise 4 of `batch-primers.md`);
- 6 random BsaI or BsmBI destinations with a template each and forward,
  reverse, whole-template and bare-sequence rows; the destination is turned to
  start anywhere, and read from the other strand in 3 cases in 10;
- 4 circular templates, a region across the origin on either strand;
- 3 destinations with the overhangs `AATG` and `GCTT`, and a CDS of 60-130
  codons with `include_start` and `include_stop` set each way and on the
  reverse strand, so the overhang spells the part's start codon or stop codon;
- one where the part itself begins with the left overhang and ends with the
  right (`overlapAtStart` and `overlapAtEnd`).

Seed 20261108. Random bodies carry no site of either enzyme on either strand,
so what is tested is the junctions, not an internal site. Destinations are the
layout of `assembly.py`: overhang, spacer, reversed site, dropout, site,
spacer, overhang, backbone.

## What is judged, and by what

For each row, without our code: pydna `amplify.pcr` runs the tailed PCR with
PlasmidPop's two primers (one product, equal to the designer's amplicon).
Route B, pydna: `Dseqrecord.cut` on destination and amplicon, the one piece of
each with no site left, joined by `+` (which refuses ends that do not fit) and
`looped()`. Route C, Biopython only: `Bio.Restriction.search` gives the cuts;
the dropout is the stretch between the destination's cuts that holds both
sites; the circle is the destination with it replaced by the amplicon from its
left overhang to its right overhang, the overhangs read off the sequence. The
construct must be each circle up to rotation and strand; `search` on the
construct must find no site, and none within a site's length of a junction; the
overhangs at the amplicon's cuts must be the destination's; each primer must
read, through `search`, one site with PlasmidPop's padding before it and the
overhang after the spacer.

pydna's `Assembly` was tried for the ligation and not used: it joins on shared
sequence and does not finish on 4-base overhangs (`assemble_circular` runs
into its time limit), so `+` and `looped()` are pydna's way to ligate sticky
ends.

A row for which the batch builds nothing, because the part carries a site of the
enzyme (a random overhang and the body spelled one: 1 of the 46), is confirmed
when Biopython finds more than the two tail sites on the amplicon. It stays in
the data as a row that is refused for the right reason.

## Negative control

The generator judges, with the same function, a construct made wrong on purpose
from the tutorial's `gene_head`: one base changed, one deleted, one added, 60
bases turned round, and a BsaI site planted at a junction. Each must be
refused, the planted one by the site check itself and not only by the circle
comparison, and the correct construct rotated and read from the other strand
must be accepted. The outcomes and the reasons are in the JSON (`controls`) and
the generator stops when one is not as it must be. A row on which any check
fails is never written: the generator prints it and exits, so a disagreement is
reported, not recorded as a pass.

## Result

All 46 rows agree: the oracle's circle is PlasmidPop's construct in every one
of the 45 that are built. 11 designs carry no warning; 33 carry only the
designer's `annealing` caution (random template ends often have no primer that
meets every criterion), one that and a primer-dimer caution, and one the
internal site above. The tails and the junctions of the cautioned rows are as
the oracle reads them. Versions: the JSON is stamped with the
Biopython and pydna that wrote it, pinned in `requirements.txt` (1.85 and
5.5.7), which the Validation page checks.

## Not done

Item 145 did what is listed here.

The restriction-sites and homology-ends recipes of the same batch are not
checked this way. Restriction ends need an enzyme pair, a region of the vector
and a per-recipe orientation convention; homology ends need the kit's tails and
`Assembly` on the overlaps. They are better filed as follow-ups than squeezed in
here. Rows with a second enzyme in the tube, a per-row `enzyme`, `left` and
`right` and `extra5`/`extra3` are not exercised either.
