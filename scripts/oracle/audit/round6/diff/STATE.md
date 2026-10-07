# r6-diff STATE
## Done
- Read brief, docs/audit.md, design note 27 (#178/#184/#185 sections), sequenceDiff.equivalentMappings, documentDiff.diffFeatures/sameSegment.
- Code's notion: feature "changed" = location/qualifiers differ from where editor would carry it (internal base edits are marks, not feature changes). MERGE_GAP=8 overwrite reading deliberately accepts an edge <=8 after an insertion stretch (documented cost).
## Plan
- Probe src/__audit__/r6-diff/probe.test.ts: random small docs (repeats at edges), single editor op; E = set of feature results over ALL single replace ops a->b (editor-reachable); verdict for editor result (false-changed) and perturbed locations (false-unchanged); Python O1 = optimal LCS-path consistency.
## Next
- write probe
## Check 1 (done): random probe, 271 cases / 545 editor results / 8897 perturbations (probe.test.ts seed 1, N=300; oracle.py, analyze.py)
- editor results marked changed: 7 (multi-seg merges/deletes mostly; to triage)
- FALSE UNCHANGED: 155 perturbed locations accepted that no single editor replace (any cost) produces AND no optimal LCS alignment supports.
- Mechanism (confirmed in debug.test.ts output dbg.txt): sameSegment takes starts x ends cartesian product (documentDiff.ts:564-590) and each segment independently; equivalentMappings offers each edge under independent readings (indel slid / not, overwrite reading / not, a turn on / not). E.g. lin TACGCGCACACACACATTTTTTTTTC del AC@14 -> feature [10,13) accepted as [8,13) (3bp->5bp). circ GGGCCGACGA +ACG@10: [0,4) accepted as [0,1). lin insert GAG@0: [0,8)->[3,8) accepted (editor [3,11)).
- Also: last base mapped to bLength then +1 gives end past end: circ AGAGTCAGTTTTTTTTTTT ->AGAGTCAGTTTTTTTGCG, [14,19) accepted as [14,19) (wraps 1 extra base); editor [14,18).
## Next: targeted big-magnitude repro (500bp insert before feature start, feature extended to cover it), tandem repeat 30bp copy deletion; then triage editor-changed 7; then perf; then UI wiring.
## Check 2 (done): targeted repros src/__audit__/r6-diff/repro.test.ts -> repro.txt
- CONFIRMED high: B2: rand40+U30+U30+rand40, CDS [55,85), delete [70,100) (one copy). Editor -> [55,70). Diff accepts as unchanged EVERY [s,t) with s in 40..55, t in 55..71 (270 locations) e.g. [40,71). B3 [50,90) -> editor [50,70); accepted s 40..50 x t 60..71.
- E: A20 homopolymer, delete 1 A, [10,20)->[10,19); accepted 9-20 (grew 1bp; impossible under any single alignment).
- C2: circ GGGCCGACGA insert(6,'ACG') -> GGGCCGACGACGA, [0,4) editor [0,4); accepted 0-1 and 0-7 too.
- A/F (start <=8 after an insertion stays put while end follows; 500bp insert absorbed) are REACHABLE by an editor replace (design note 27 #185 deliberate cost) -> design risk, not bug.
## Next: scale B2 to 300bp duplicate; perf; triage 7 editor-changed; UI wiring.
## Check 3 (done): scale + perf (perf.test.ts -> perf.txt)
- S1 CONFIRMED high: rand100+U300+U300+rand100, CDS [350,450), delete copy2 [400,700) -> editor [350,400); diff says [150,401) UNCHANGED (251bp vs 50bp).
- perf: polyA10k 2000 feats 1.7s; 5kb dup deleted, 100 mismatched feats 1.6s (main thread useMemo). <2s, borderline only.
## Check 4 (done): editor results marked changed (3 seeds x400): genuine false-changed only for shortening replaces across origin (head stretch has no insert so not merged; close() pushes only inserts===true) and overwrite-by-shorter text (pure-deletion stretch not read as overwrite). Multi-seg segment loss/merge = legit changed.
- Mapped location shown for changed/removed features (mapped(before), primary map only) differs from editor's location in ~20% (456/2104) — all checked cases are valid optimal drawings in repeats (ambiguity), e.g. circ TTCGTTCGTTCG->TCGTTCGC [0,6): editor [0,5), shown [0,1). low/medium.
## Next: UI wiring (editDiff.ts, HistoryStepDialog, CompareDialog + checksum/align.ts)
## Check 5 (done): UI wiring
- editDiffBetween: identity-keyed one-slot cache over immutable docs (no stale). HistoryStepDialog useMemo(before,after). CompareDialog: alignToDocument(current,file) -> applyAlignment(file) -> diffDocuments(other,current): right pair and direction.
- Repro G: S1 confirmed through save-review flow (delete copy, then updateFeature to [150,401)) -> 0 changed/added/removed; and compare flow with fresh ids (pairByContent uses same sameFeature) -> 0/0/0. Homopolymer [9,20) via review -> 0 changed.
## DONE — final report sent.
