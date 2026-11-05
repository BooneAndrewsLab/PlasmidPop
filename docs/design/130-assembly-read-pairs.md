# 130. Read pairs in assembly (#347)

**Asked:** #347 left one case open after 1.21.0: reads that all lie inside a
repeat copy cannot say which copy they are from, and neither a better join
rule nor the reference button (item 123, "A way out of a repeat warning")
settles a read wholly inside one copy. Its title names the way out: use read
pairing, names and insert size, to resolve repeats. Code:
`src/core/assembly/pairing.ts` (new), `assemble.ts`, and the Assemble page
(`AlignWorkspace.tsx`, `AssemblyResult.tsx`, `alignRun.ts`).

**What a pair gives.** The two Sanger reads of one template (a forward and a
reverse primer on one clone) lie on opposite strands, facing each other, one
insert size apart. A read inside a copy of a repeat has a mate somewhere, and
if the mate is in unique sequence it says which copy; a contig that has lost
the stretch between two copies puts mates too close. Both are one test:
where the mates are, and how far apart.

## Decisions (the issue left these open)

- **Pairs come from names, nothing else.** A file has no pairing field (AB1,
  FASTA and a FASTQ without an interleave all lack one). Two names are mates
  when they are equal but for a trailing mate token: forward `F fwd for
forward FP 1`, reverse `R rev reverse rvs RP 2`, after `_ . - / space`, or
  joined to a digit (`M13F`, `clone5R`); extension and case ignored; an
  Illumina header's ` 1:N:0:...` / ` 2:...` too. Why joined only to a digit:
  `BAR`, `STAR`, `SHELF` must not lose a letter and invent a stem. A stem with
  anything other than exactly one forward and one reverse read is **not
  guessed at** and is listed as not paired: three reads, two `F`s, a `_F`
  beside a `_2` (letters and numbers are separate families), and a numbered
  series (`clone_1`, `clone_2`, `clone_3`: a number past 2 marks the stem a
  series, so `_1`/`_2` are not taken for mates). A wrong pair costs more than
  a missed one, because it would put a read at a place by a mate that is not
  its mate. Pairing is by the record's own name, not its file's; multiple files
  of one run with the same names are an edge not handled.
- **The insert size is typed, never estimated.** An estimate from the pairs
  in the first assembly (a median) would be corrupted by the very collapse it
  is meant to find, and libraries with several template sizes (primer walks,
  clones of different inserts in one assembly) would be flagged at random.
  So: blank means "check facing and strand only, say nothing of distance", and
  the result lists the distances the facing mates are at ("976 to 988 bp
  apart; enter the insert size") so the number is easy to get. A typed
  value under 50 or over a million is ignored, and the page says so.
- **Tolerance: a tenth of the insert size, at least 100 bases.** The distance
  is measured between the kept ends of the two reads (trimmed), so it
  undershoots the template by the trimmed tails; 100 bases covers a Sanger
  read's usual head and tail. Measured on the simulated pairs below, 986 and
  976 against an insert of 1000. A boundary is exact: 1111 allows 111 for a
  template of 1000, 1112 does not.
- **What pairs are allowed to change: ties, and verdicts.** They do not
  decide which reads join (a pair is not evidence that two reads overlap),
  they do not refuse a join, and they do not alter the thresholds. They are
  used in two places:
  1. _Where a read goes when it fits the contig at two places._ The
     assembler already found the second place (`fitsElsewhere`, item 123, to
     warn); it now returns it. If the read's mate is in the layout, each
     place is judged against the mate by the same function that judges a
     finished contig (`judgePair`); exactly one of them fitting settles it,
     and that read goes in as one that fits one place, with no warning. Both or
     neither fitting leaves it as before (the best, with the warning). No
     further alignment is done, so there is no speed cost.
  2. _After assembly,_ every pair is judged in its contig (`checkPairs`), and
     the contigs a pair divides between are linked.
- **Facing, strand, distance.** Mates must be on opposite strands, the
  forward-strand mate on the left (FR, "innie"); distance is the outer end of
  one to the outer end of the other, 0-based half-open, so a read of bases
  1-100 and one of 201-300 are 300 apart. Names do not matter after pairing:
  a pair is judged the same whichever mate is called first and whichever
  way the contig is laid (the seed, the longest read, sets the orientation,
  which is arbitrary; both are property-tested). Verdicts: consistent;
  `too-short`; `too-long`; `same-strand` (warned with or without an insert
  size: the mates are not the ends of one template as laid out); `facing-away`
  (warned only with an insert size, see next).
- **Circular templates.** The assembler is linear. A pair on a circular
  molecule that spans the origin shows as mates facing away. With an insert
  size, facing-away mates whose distance round the contig's ends
  (`length - forward.start + reverse.end`) fits the insert size are
  `spans-ends`: consistent, not warned. Without an insert size a facing-away
  pair is reported but not warned, since it could be exactly that. The long
  way round a circle is not tried for mates that face each other (a pair
  1000 bp apart is 1000 bp apart); the same loci read from the other strands
  are another template, tested as such.
- **The warnings** (`ContigWarning`): `pair-distance` for too short (the
  message gives the distance, and about how much may be missing) and too long
  (a stretch may be doubled, or the mates are not from one template);
  `pair-orientation` for same strand and facing away. `read` is the forward
  mate; the stretch is from the first mate's start to the last one's end. The
  Assemble page words them apart from repeat warnings ("Read pairs do not fit
  this layout" against "A repeat may have fooled the assembly"), marks the
  picker option "read pair warning", and the slim panel's line adds "read
  pairs do not fit N contigs". "Align these reads to <document>" is offered
  for either kind.
- **Links.** A pair with a mate in each of two contigs says they follow one
  another: contig A turned so the first mate reads forward, contig B so the
  second reads backward, template from A into B. An arrangement has one
  spelling (the lower contig first, by taking the reverse complement of the
  whole thing when needed) so the pairs from either side agree; the gap, with
  an insert size, is insert minus the bases of the template inside each contig
  (median over the pairs; negative is an overlap, which is what a repeat both
  contigs contain looks like). Two arrangements that put each contig after the
  other are a repeat's signature and are listed separately. The contigs are
  **not** joined and no scaffold document is made: a gap of unknown sequence
  has no honest consensus, and `N` runs in a saved consensus would be mistaken
  for sequence.
- **The options are optional.** `pairs` and `insertSize` on `AssemblyOptions`;
  without pairs (or an empty list) nothing changes and `Assembly.pairing` is
  absent. The oracle (item 123) has no pairs and is untouched; its known
  deviation for reads wholly inside a copy with no mate is still true and now
  has this way out only for data that has mates.

## What it does, measured

All with `pairing.assemble.test.ts` (the `src/core` test; the simulator is
the oracle's, `sangerSim.ts`).

- Reads from a 1200 bp construct with copies at 300-500 and 700-900: a whole
  contig and a read from inside the second copy (750-850) with a mate in the
  unique stretch after it (1000-1100). Without the pair the read is laid on the
  first copy (350) with an ambiguous-join warning; with it and an insert size
  of 350 it is at 750, no warning, the consensus equal to the construct. The
  same for a read in the first copy, for a reverse read whose mate is before
  it, and for an inverted copy with no insert size (facing alone: without the pair the read ends at the right place by the best score but with an ambiguous-join warning; with it, none).
  With no insert size and two copies on one strand the facing is the same at
  both, so the warning stays: stated, and tested.
- Mates whose template 100-1160 runs through a collapsed repeat are 6xx bp
  apart in a contig where the insert is 1060: a `pair-distance` warning with
  "about 4xx bp between them may be missing". With no insert size nothing is
  said, and the result lists the one distance.
- Simulated Sanger pairs (clean quality profile, 500 bp reads, insert 1000,
  four templates at 0, 350, 700, 1100) of the issue's 2.1 kb construct with
  400 bp copies, seeds 1-8, truth known per read. A contig is _faithful_ when
  every read in it lies where it was cut from (one offset to within 25
  bases, on one strand). 14 contigs: 8 faithful, 6 not (a read on the wrong
  copy, or copies laid on one). **No faithful contig is warned (0 of 8)** and
  no pair-orientation warning appears anywhere. Of the 6 unfaithful, 2 are
  flagged by a pair (those that hold both mates of a pair laid apart wrongly);
  in the other 4 no pair lies wholly inside the contig, or a pair fits by
  chance. That is the honest limit: pairs flag what they span, and the other
  contigs are the ones the repeat warnings and the links speak to. One seed
  gave a contig of 1690 bp that holds a read from the second copy laid on the
  first: the mates of the template at 0 were 1690 apart for an insert of 1000,
  and the warning is right.
- The same simulation shows the limit of resolving a read by its mate: in
  seeds where the mates are in the other contig (seeds 1, 2 and 5: two
  contigs) the read stays ambiguous and the pairs are reported as links
  instead: a gap of -297 in seed 1 (the repeat both contigs contain) and, in
  seed 5, two arrangements of -971 and -970 that put each contig after the
  other, which is the signature of a repeat.

## Left out, on purpose

- **Using pairs to decide a join** or to move a read already placed. Reads
  are placed greedily one at a time, and a mate that lands in a contig built
  later cannot be consulted; resolving it would take a second pass over the
  ambiguous reads once all the contigs exist. Worth doing if users have
  mates that fall apart in this way (seed 5 above is one).
- **Estimating the insert size**, **several insert sizes** (a size for each
  pair or library), and **mate-pair libraries** (outies, same-strand). Sanger
  pairs are FR.
- **A scaffold or a saved consensus with gaps**, as above.
- **A name field to pair by hand.** The rule is documented; a pair that does
  not pair is renamed. If it turns out to be needed it is a separate issue.
- **Using a record's file name** when its own name carries no token.

## Tests

`pairing.test.ts`: the naming table (18 conventions, order, case, nothing
found, ambiguous, a lone mate, words ending in F or R, differing rests,
series), a property for random stems in four styles and any order, the
distance function (0-based half-open, symmetric, tolerance boundaries,
overlapping and nested mates, equal starts, spanning ends, a property over
random templates, flips and translation), the link arrangement (orientation,
gap, one spelling, median, conflicting arrangements, a property that swapping
the mates changes nothing). `pairing.assemble.test.ts`: the repeat cases
above, inconsistent insert sizes (too short, too long, wrong for every
pair, unknown), same strand, facing away and the circle (and the contig laid
the other way), a mate left out, linked contigs with the gap, no change with no
pairs, and the simulated run. UI: `AssemblyResult.test.tsx`,
`alignSummary.test.ts` and `AlignPanel.test.tsx` (the insert size field, a pair
found and reported, not-paired names).
