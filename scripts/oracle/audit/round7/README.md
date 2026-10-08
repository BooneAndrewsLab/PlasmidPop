# Seventh audit (2026-10-07): scripts

The oracle scripts of the two scoped seventh-round areas (commit `bb8ecd7`),
with each area's `STATE.md`. As for round 6, their paths point at a session
scratchpad that no longer exists, and the Vitest probes (`src/__audit__/r7-*`,
untracked) and generated data are not kept: read them rather than running them.

- `diff/`: the document diff after #189 (`oracle2.py`, `classify*.py`, the
  `probe.sh`/`chk.sh`/`dbg.sh` drivers). Found #197 (a range collapsed to
  `[Lb,Lb)` read as the whole circle `[0,Lb)`; an empty "was" location) and
  #198 (a whole-circle feature accepted at its old length after an insertion;
  `isWholeCircle` required start 0; a slide onto the origin). Fixed in
  `62b62e4` and `31b57b6`.
- `provenance/`: `featureOrigin` (`gen.py`, `check.py`). No highs; #199
  (`trimTip`/`bluntEnds` trims and a PCR primer mismatch kept a stale
  `/translation`), fixed in `f276cca`.

After the fixes the round-6 probe (seeds 1-24 x 400) false-unchanged fell
32 -> 18, all by design (15 #194 whole-circle shifts at the new length, 3
linear two-replace histories); the history probe (seeds 1-8) whole-circle
false-unchanged fell to 0. Round 7 found highs, so it failed the stopping
rule: another round is due before 1.11.2.
