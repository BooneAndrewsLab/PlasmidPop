# circ-reads STATE

Started. Next: read fixes 06135fc 6e7e426 289e976 15744ab.

## Check 1 DONE: #175 circular read mapping vs Biopython (local EDNAFULL -10/-0.5)

302 cases (random 4k/12k, tandem-repeat refs 3.5k/13k; reads 600/1500 at offsets L-25..L+5, L-m/2 etc; F/R; muts at/near origin; indel/sub exactly at origin; reads covering circle +0/+5/+40).
Single path (alignEitherStrand wrap) and batch path (runReadBatch fast:true) both: 0 score mismatches vs Biopython on doubled ref, 0 position mismatches vs Biopython on rotated ref. Files: gen_reads.py, check_reads.py, src/**audit**/round5-circ-reads/reads.test.ts
Next: dense sweep near origin (gen_sweep), then alignmentStack twin columns (#177), then diff (#178), then hover (#180).
Check 1b DONE: dense sweep 640 cases (offsets L-1..L-40, sub last base before origin, 15-mer breakers, 2-bp del before origin, tandem 9-mer across origin, F/R): 0 score/pos mismatches. cases saved reads_cases.json (sweep), _1 = first set.

## Check 2 DONE: #177 stack twin columns (src/**audit**/round5-circ-reads/stack.test.ts -> stack_ts.json)

L=1200, insertion (1-3 bp, unique bases) at boundaries 0,1,2,3,5,L-1,L-2,L-4; 5 reads (2 wrapping, 2 ending/starting at origin, 1 control), mixed strands, differing ins lengths. Invariants: ref char per column, twin symmetric with refIndex diff L (or both inserted), row bases == alignedB: 0 problems. Same insertion seen high+low -> one difference, agreement called. Oddities only where the read-end placement is genuinely ambiguous (local optimum uses 3 matches + 4-gap at read start; scores validated in check 1) -> not bugs. Padding cols appear at column 0 before base 0 when high copy has an insertion at boundary L (cosmetic, by design).
Next: #178 documentDiff / sequenceDiff.

## Check 3 DONE: #178 documentDiff vs base-identity model (docdiff.test.ts -> docdiff_ts.json; triage_diff.py; diffrepro.test.ts)

3000 trials (random / homopolymer / dinucleotide seqs, linear+circular, 8 feature shapes incl. wrap, wrap1, whole, join, 1-bp; ins/del/rep/setOrigin at feature boundaries + origin).
Oracle semantics: editor-carried feature must be 'unchanged' (diff says changed only if differs from mapped old self). Editor-removed -> removed: all OK.
#178 original repros D1-D3 pass. 94 unique residual false-'changed', ALL explained by ambiguous placement in repeats (triage: ins 45, rep 29+1, del 19) -> near-variants NOT covered by fix (equivalentMappings handles only deletions at a segment START):
LOW-1 repro: seq 'GCATCAAAAG'+R linear, f=[0,8), delete [5,6) -> editor [0,7), diff CHANGED (maps to [0,8)).
LOW-2 repro: same seq, f=[7,30), insert 'A' at 5 -> editor [8,31), diff CHANGED (maps to [7,31)); circular same.
setOrigin -> all features 'changed': documented (sequenceDiff.ts:103 wholesale change) -> not a bug.
Next: #180 hover slop invariants (renderCircular.ts), then final report.

## Check 4 DONE: #180 hover (hover.test.ts): angle<->base round trip OK; tiny segment of join at 0, N-1, wrapping [N-1,N+1), 1, 5000 gets same 41/41 drawn-arc hits as a tiny solo feature; adjacent long neighbour in same lane never stolen (0/50 x5). Clean.

AlignPanel wiring reviewed: wrap passed in single run (local, whole circular doc / circular record when doc is read) and batch (runReadBatch drops wrap for non-local rows). OK.
ALL CHECKS DONE -> final report.
