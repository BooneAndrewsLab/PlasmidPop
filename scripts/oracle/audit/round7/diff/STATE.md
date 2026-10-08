# r7-diff STATE

## Done

- Read ROUND7.md, BRIEF.md, docs/audit.md Running/Conventions, design note 27 (#178-#196), r6 STATE/oracle/probe.

## Next

- Check 1: probe at HEAD seeds 1-20 (runner probe20.sh), classify false-unchanged.

## Check 1 (done): r6 probe at HEAD, seeds 1-24 (probe.sh head 1..24; classify.py)

- FU per seed 1-23: 2,1,0,0,0,1,2,2,3,0,0,1,0,2,2,1,0,5,3,2,1,1,2 (+3 on 24). Seeds 1-3 match brief (2/1/0).
- Classes: WHOLE (start-0 whole circle, #194 by design) ~15; LIN two-edit drawn (s6,s7,s19: by design) 3;
  CIRC non-zero-start whole circle after insertion, accepted at old length (class A) ~11;
  CIRC feature collapsed at end of b accepted as whole new circle (class B): s14, s18.

## Check 2 (done): repro.test.ts -> repro.txt

- CLASS B CONFIRMED HIGH: documentDiff.ts sameRange fits(): `(e > s ? e - turn : e)` — a reading placing a range
  at [Lb,Lb) (collapsed at origin) fits after=[0,Lb). 1000bp circle, X [900,1000), delete those bases, X=[0,900)
  -> UNCHANGED; compare with fresh ids -> 0 added/removed/changed. Multi-seg too. B5: 200 rand + CG*150, X[400,500),
  delete [250,350): editor [300,400); [0,400) also UNCHANGED.
- CLASS A: whole circle with start!=0 (isWholeCircle needs start 0): insertion <=8 before junction, any length,
  accepted excluding inserted bases ([306,1306) for 300bp ins). #185 documented edge cost variant; editor never
  produces it (insert at junction is included). Rate medium.

## Next: check 3 history probe (src/**audit**/r7-diff/history.test.ts, PROBE env in probe.sh), then #189-196 repros, perf.

## Check 3 (done): multi-op history probe (history.test.ts + multi.ts, oracle2.py; excuse = O1 or single replace or <=3 disjoint replaces cost<=D+16)

- seeds 1-8 x300: editor results marked changed ~27% (2-3 op histories; low, expected). FU residual 0,0,0,1,1,3,3,3.
- LIN residuals (3) all reachable with slack 40 (check.test.ts) -> clean/by design.
- editor.test.ts: editor ALWAYS keeps a whole-circle feature whole (any insert/replace, start 0 or not). So any
  accepted non-whole location for a whole-circle feature is unreachable by any history.
- CLASS C CONFIRMED HIGH: start-0 whole circle (e.g. source) + insertion slidable onto origin: 1000bp circle a[0]=G,
  insert 'T'*299+'G' at 1 -> editor [0,1300); diff accepts [300,1300) (misses 300bp) as UNCHANGED. Mechanism: slide
  reading moves start past insertion but not the end (end = a.length), sameRange fits(start,end) accepts directly.
  r6 probe s8 WHOLE (dlen -3) and history s5/s6/s7/s8 WHOLE0 (dlen 3-4) are this.
- Class A (non-zero-start whole circle) same family -> upgrade to HIGH (no history excuses it).

## Next: #189-#196 original repros + near variants; perf; UI.

## Check 4 (done): fixes.test.ts -> fixes.txt (#189-#196 originals + variants)

- #189 S1 (300bp dup) lin/rev/circ/circ-over-origin/multi-seg: [150,401),[100,400) CHANGED. homopolymer [9,20)-type CHANGED. OK.
- #190 (4 shapes), #191 ([6,17) chg), #192 (both), #195 (both), #196 ([1,7) chg) editor results unchanged: OK.
- #193 editor result [2,3) unchanged OK ([1,3) still accepted = drawn reading).
- #194 repro AACCAAAAACC: [2,15) UNCH (by design) but ALSO [2,13) UNCH = 11bp of 13bp circle -> class C.
- tiny circ ACGA, [3,4), delete [2,4): editor drops feature; [0,2) whole circle UNCH -> class B.
- 'edge ins@0 circ' [6,12) accepted: single replace [0,7)->9 bases gives it; by design.

## Next: perf (few kb, many features), UI consumers.

## Check 5 (done): perf.test.ts -> perf.txt: 5-8 kb, 601 features (incl. whole-circle source, joins, origin-spanning), circ+lin,

ins near origin / replace over origin / edit every 5 bp (coarse) / 20 random edits: all <=134 ms. OK.

## Check 6 (done): invariants on mapped "was" locations (history probe, 4 seeds x300): only finding = removed/changed

feature collapsed at the end of a circle shown as empty [Lb,Lb) (start == length): low/cosmetic.

## Check 7 (done): src/app unchanged since a2734eb; UI consumers (HistoryStepDialog, CompareDialog, SaveReviewDialog via

editDiffBetween, featureChanges.ts) use featuresChanged/isUnchanged directly -> classes B/C reach the UI (B2: compare 0/0/0).

## DONE - final report sent.
