# region-copy audit (round 4) STATE
## Done
- Read BRIEF, audit.md conventions, extract.ts, codonStart.ts, translateCds, note 66.
- Seed 2 (2-base partial codon CG->R): BY DESIGN (note 66, #142): NCBI convention, only at 3'-partial end, verified on 6295 NCBI CDS. Not a bug.
- Seed 1 (stale /translation on clipped CDS): FeatureList flags it (isStaleTranslation + Update button), GenBank writer exports it as stored. No SnapGene writer. Inconsistent w/ split stretches (dropped). Low.
## Suspects from reading
- extract.ts:81-82 partial flags: part boundary at origin (s==part.start where part.start==0, or e==part.end==L) not marked partial when feature wraps origin and region keeps only one side.
## Next
- fuzz harness src/__audit__/region-copy/dump.test.ts -> out.json; python oracle check.py
## Fuzz (dump.test.ts -> out.json, check.py base-identity oracle), 4000 cases
- bases/order/strand/codon_start/protein: 0 failures (2955 non-empty cases, 309 split, 1412 clipped CDS)
- BUG A (medium): missing partial flag when a whole join segment, or the part of a wrapping segment past the origin, is outside region (extract.ts:81-82 only marks s>part.start / e<part.end). 181 3'-flag, 44 5'-flag (5' only non-CDS; CDS 5' rescued by advanceCodonStart). Repro R1/R2 in repro.test.ts: linear join(1..9,13..33) CDS extract [0,11) -> "1..9" (should 1..>9); circular L40 misc [35,45) extract [30,40)->6..10 (should 6..>10), [0,10)->1..5 (should <1..5).
- BUG B (high): whole-circle region (single-cutter digest) keeps a join across the linear ends with interior partials join(56..>60,<1..25); ligating an insert into that site keeps the join SKIPPING the insert -> protein shown = original intact (MRIPKLFAW*) although the construct is disrupted. pydna drops the feature (pydna_r3.py). 134/134 interior-partial cases are whole-circle. Design note 10 says "A whole-circle region drops nothing" -> design decision but outcome wrong.
## Next
- seqDocument delete/replace codonStart neighbours (3' analog? reverse-strand delete of start)
- Seed 3: NOT a bug: all flag failures are missing flags; 0 spurious flags in 113 cases with flagged wrapping src segments.
- Seed 4 (#169 split): 309 split cases clean on bases/order/codon_start/protein/cut-side partials/qualifiers (except Bug A when a whole segment is dropped).
- Delete fuzz (dumpdel.test.ts, checkdel.py): 4000 cases, 1763 prefix/suffix CDS deletes: bases, codon_start, 5' flag all clean. Low: deleting the 3' end of a 3'-partial CDS loses its `>` (89 cases); delete never marks 3' partial (convention).
- R4: transl_except copied to the split stretch that lacks its codon -> unusedExceptions warning (low).
## DONE - report sent
