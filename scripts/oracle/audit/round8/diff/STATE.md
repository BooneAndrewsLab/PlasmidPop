# r8-diff STATE (area 1, audit 8, baseline d2a4a50)

## Done
- Read BRIEF, audit.md Running/Conventions, note 27 (#197/#198 sections), r7 STATE/oracle2/probe, git show 62b62e4 31b57b6.
- Editor carry rules read (range.ts shiftRangeForInsert/Delete, seqDocument.replace = substitute prefix, then insert/delete at pivot).

## Plan
- probe.test.ts (src/__audit__/r8-diff): random circ/lin, tiny circles, whole-circle feats with any start, feats at Lb, origin edits; emits diff verdicts for editor result + perturbations + whole-circle rotations + candidates for removed feats.
- oracle.py: independent identity model of the editor (all single replace ops a->b), FU/FC classification.

## Next
- write probe.test.ts + oracle.py

## Check 1 (done): random probe (probe.test.ts; probe.sh tags m 1-6, tiny 1-3, org 1-3; oracle.py identity model, model_bad=0 vs editor on all cases)
- FU raw: LIN 28, CIRC 26 non-rotation, CIRC_rot 77, WHOLE_rot_WA 25. classify.py: rot = op + change of origin (#185 small rotation).
- Non-rot FU are overwhelmingly drawn two-edit histories (insert+overwrite at a feature edge, etc.) = by design (#194/#196 "diff as drawn").
- was_bad ~40/seed: linear insertion at a feature's exclusive end -> renamed feature's "was" includes the insertion. TODO check.

## Check 2 (done): sweeps vs pre-fix snapshots (src/__audit__/r8-diff/old/pre197.ts, pre198.ts = git show 62b62e4^ / 62b62e4)
- sweep.test.ts SWEEP=whole (whole circles, start 0/rand/L-1) seeds 1-4 x400; SWEEP=tail seeds 1-4 x400. exhaustive.test.ts (L 3-9, every feature, ~all ops) seeds 1-2.
- NO regression: no editor result changed at HEAD that pre197/pre198 kept; 411 editor results newly unchanged (whole circles w/ nonzero start, #198).
- P1: no whole-circle feature accepted at a non-whole length. P2: removed features accepted only in drawn 2-edit cases (o1), costly replaces.
- Newly accepted (HEAD unchanged, pre changed) only 3, all whole circles, start shifted by a drawn insertion/replace at the feature's start = #194 family (lengthening/any replace at a nonzero start). Note as known-family.
- Whole-circle editor false "changed" all pre-existing, pathological (circle cut to 1 base, or most of a tiny circle replaced).

## Check 3 (done): "was" location (mapFeature/mappedRange) - CONFIRMED BUG
- mappedRange uses map(seg.end); an insertion right after a feature is put inside the "was".
  linear ACGTACGTAC, insert TT at 6, feature [2,6) renamed -> was [2,8) -> review says "moved"; removed -> "- 3..8" and ghost [2,8).
  circ, 10 bp inserted at 6 -> removed feature's was [2,16). append at linear end: [6,10) -> [6,12). pre-existing (mappedRange end line unchanged by 62b62e4/31b57b6).

## Check 4 (done): fixed repros (fixed.json/fixed3.json via chk.sh, check.test.ts prints HEAD/pre197/pre198)
- #197: [900,1000) deleted -> [0,900) CHANGED, was [0,0); [950,1000) same; multi-seg same; with 500 bp inserted elsewhere [0,1400) CHANGED. OK.
- #198: [6,1006)+300@0 -> [306,1306) CHANGED, [306,1606) unch; [0,1000)->[300,1300) CHANGED. OK. whole [0,1000) wrap-delete 10+10 -> [0,980) unch, [10,990) CHANGED. OK.
- whole/non-whole feature with a 20 bp deletion over its start accepts starts 500..505: all single-replace reachable ([500,520+k) -> a[520..520+k)). OK.
## Check 5 (done): was_bad categories: end-grown 288 (the bug), start-differs/other = repeat drawings (convention) and whole-circle #184 slides; [0,0) "was" for a present feature collapsed by a slid deletion at the end (cosmetic).
## Check 6 (done): r7 perf.test at HEAD: all <=148 ms.
## DONE - report.
