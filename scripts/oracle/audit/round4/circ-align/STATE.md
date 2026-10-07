# circ-align audit STATE (4th round, scoped 5b324ba..HEAD)
## Done
- Read brief, audit.md conventions, diffs of strands/pairwise/banded/readAlignment/stack/disagreement/verdict/differences/residues.
- Theory review of banded check (gapBound/boundBand/regionScore): sound on paper.
## Observations so far
- banded.test.ts 20% guard recomputes region from FINAL score; alignBanded uses FIRST band score. Differ only if first band suboptimal. Also exact=true already implies region<=25M (~22.7% of 110M) so guard adds little.
- Insertion columns have no twin: same insertion in wrapping + non-wrapping read -> 2 differences, no agreement (to test).
## Next
- A: read mapping vs Biopython; B: banded adversarial; C: residues; D: documentDiff
## FINDING 1 (check A done, 120 cases x {fast,full})
- fast:true (Align all) local on doubled ref: read starting x=1..3 bases before origin with a mismatch at the junction
  -> placed on copy at 0 (non-wrapping), x bases + mismatch dropped; score 1-11 below Biopython; 18/60 edge_mm cases. full path clean.
  Mechanism: anchors tie between copy A (L-x..) and copy B (0..); LIS picks B; boundBand local region = chain diags +-G, G~0 for clean read, other copy not in region; exact=true claimed.
- all other kinds (indel within 5 of origin, half, whole+overlap, tiny, tandem at origin) clean in both modes.
- Finding 1 confirmed also NON-fast single read on plasmids >~12.5 kb (doubled ref x read > 25M cells -> banded): 19/20 cases x<=6 with junction mismatch. Repro src/__audit__/circ-align/repro1.test.ts (L=15000, read=ref[L-4:L-1]+mut(ref[L-1])+ref[:900] -> score 4500 at startA 0, optimum 4511).
## Check B (banded adversarial, linear) : 160 cases x2 modes vs Biopython full: all exact, none below. (seed 21)
## Check B2: 320 more banded cases x2 modes (seed 99): all exact, none below Biopython.
## Check C done: 684 substitutions near origin/intron edges, CDS join across origin fwd/rev, multi-segment (4 exons), codon_start 1/2/3, transl_table 11; GenBank written by Biopython, parsed by PlasmidPop. Wrapping read fwd+rc: 1368/1368 effect text == Biopython translate (p.X{n}Y numbering). Non-wrapping reads: only conventions (read's terminal base no mismatch; straddling codon blank).
## Next: D documentDiff origin
## Check D done (400 trials x 8 feature shapes, edits near origin; base-identity oracle). whole/wrap/endL/start0 clean. Findings (all LOW, repro src/__audit__/circ-align/docdiff3.test.ts):
- D1 same-length substitution straddling a feature boundary -> feature 'changed' (positionMapper maps deleted span to bStart; R1 linear replace [3,6) NNN, f [5,30) -> mapped [3,30)). general, not origin.
- D2 circle: delete the last bases where a feature wraps origin -> mapped start = new length (44) not 0 -> 'changed' (R2).
- D3 deletion ambiguous within a homopolymer at feature START -> 'changed'; ends accept 2 answers, starts only 1 (sameSegment) (R3).
## Next: insertion columns twin (agreement across origin), then report
## Check E done: insertion carried by wrapping + non-wrapping read at wrapped pos 5 -> two rows (5:1,5:1), verdict 4 diffs, agreed 0; same insertion at 1490 -> one row, agreed 2. sub/del fine. (src/__audit__/circ-align/indelTwin.test.ts)
- Read longer than circle: aligned span capped at 2L-1 (overlap beyond dropped) - low/edge.
## STATUS: all checks done; report written.
