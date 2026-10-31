# 123. Sanger read assembly against a known construct

Issue #335, 2026-10-30. Item 76's assembly was covered by unit tests built
from reads cut from a known sequence, with perfect or hand-placed errors.
This item asks how it does on reads whose errors follow their own Phred
qualities, over layouts that include repeats and noisy ends, and whether the
reported consensus qualities mean what they say.

Code: `src/test/oracle/sangerSim.ts` (the simulator), `src/test/oracle/
sangerAssemblyHarness.ts` (scenarios, gate, report; run by `sangerAssembly1-4.test.ts`, #353). No data file is committed
and no reference assembler was used: the truth is the construct the reads
were cut from, so the comparison is exact. `ORACLE_REPORT=1 npx vitest run
src/test/oracle/sangerAssembly` prints the report below as JSON.

## Simulated reads are less realistic than real ones

A read is cut from a seeded synthetic construct (xorshift32; nothing from a
real genome) and every base is miscalled with probability 10^(-Q/10)
(capped at 0.75) from the read's own quality. Errors are 84 % substitutions
and 8 % each of deleted and inserted bases (35 % each in the homopolymer
scenario); a base under Q2 is an N a third of the time. This leaves out peak
overlap, dye blobs, compression and context-dependent errors, and makes
errors independent given the quality, so qualities are perfectly calibrated
by construction. A pass is a floor, not proof on real chromatograms.

Quality profiles come from two sources.

- **Parametric (committed):** a poor ramp over the first 35-50 bases, a
  plateau (Q45 clean, Q32 noisy) with random dips of 5-15 bases at Q6-14, and
  a decaying tail of 150-250 bases. Not derived from any file.
- **Real (local only):** the base qualities of the AB1 files in
  `fixtures/local/abif/` that have any (2 of 4 here; the 310 file holds only
  zeros), used as the quality shape of simulated reads. Those files are not
  redistributable, so nothing from them is committed, the test loads them in
  `beforeAll`, and that one test is skipped without them (run and passed
  once with the directory moved away).

The committed AB1 fixtures under `src/io/fixtures/abif/` are synthetic
format fixtures (item 49), not reads of any construct, and were not used.

## Scenarios

Each is run 8 times with different seeds (deterministic). Construct: 2400 bp
random, 2000 bp homopolymer-rich (runs of 5-9 every ~60 bp), or 2100 bp with
a 400 bp direct repeat (unique 500, repeat, unique 300, repeat, unique 500).
Reads are 650-850 bp. Identity is measured by aligning the consensus
locally to the truth and counting, over the consensus bases that at least
two reads cover, those that differ from the truth, are inserted, or have a
truth base missing after them. An ambiguity code that contains the truth
base is right. A stretch of 20 or more truth bases missing from the
consensus counts as a collapse.

| Scenario                                    | Reads | Contigs (8 reps) | Identity, depth 2+, mean (min) | Identity, all bases, mean | Result                     |
| ------------------------------------------- | ----: | ---------------- | ------------------------------ | ------------------------: | -------------------------- |
| Tiling, forward, clean, 300 bp step         |     7 | 1 in 8           | 100 % (100 %)                  |                    99.91% | pass                       |
| Tiling, alternating strands, clean          |     7 | 1 in 8           | 100 % (100 %)                  |                    99.85% | pass                       |
| Tiling, alternating strands, noisy, 250 bp  |     8 | 1 in 8           | 99.94 % (99.84 %)              |                    99.53% | pass                       |
| Noisy, 400 bp step (thin overlaps)          |     5 | 1 in 6, 2 in 2   | 99.89 % (99.70 %)              |                    98.96% | known, #349                |
| Deep, 14 reads, jittered, both strands      |    14 | 1 in 8           | 100 % (100 %)                  |                    99.97% | pass                       |
| Homopolymer-rich, indel-heavy, noisy        |     5 | 1 in 8           | 99.71 % (99.42 %)              |                    99.03% | 7 pass, 1 known, #350      |
| Repeat, dense spanning reads (200 bp step)  |     8 | 1 in 7, 2 in 1   | 95.18 % (61.5 %)               |                    95.75% | 7 pass, 1 known, #347      |
| Repeat, sparse spanning reads               |     4 | 2 in 8           | 99.97 % (99.73 %)              |                    99.77% | known, #348                |
| Repeat, reads inside a copy plus flanks     |     4 | 1 in 8           | 99.96 % (99.71 %)              |                    59.94% | collapse in 8, known, #347 |
| Walking primers, 2.2 kb, real quality shape |     8 | 1 in 8           | 100 % (100 %)                  |                    99.99% | pass                       |

Read order along the consensus and the relative orientation of every read
(both checked wherever reads are spaced for it) were right in every
replicate of every scenario, including the ones that split or collapsed.

The all-bases column is lower because the construct's two ends and the read
tails are covered by one read only, where a Q8 base is wrong one time in
six: that is the quality model working, and the consensus there says so in
its qualities. The collapsed scenario's 59.94 % is the 700 missing bases;
its depth-2 identity ignores them, which is why the collapse is a separate
check.

## Calibration (report only, not gated)

Reported Phred of each consensus base against whether it was wrong
(different, or inserted), over every scenario that was colinear with the
truth (the collapsed ones are left out). "Expected" is the sum of
10^(-Q/10) over the bin. Truth bases the consensus lacks are not in the
table.

| Reported Q |   Bases | Wrong | Expected |
| ---------- | ------: | ----: | -------: |
| 0-9        |   1,626 |   255 |    279.5 |
| 10-19      |   3,762 |   144 |    186.1 |
| 20-29      |   7,176 |    14 |     22.1 |
| 30-39      |  12,350 |     3 |      5.1 |
| 40-49      |  14,096 |     3 |      0.6 |
| 50-60      | 111,522 |     0 |      0.2 |

Split by depth, where one read covers the base (depth 1) the table is the
same shape: 247 wrong against 272.7 expected at Q0-9, 132 against 172.3 at
Q10-19. Where two or more cover it, 8 against 6.8 (Q0-9, 46 bases), 12
against 13.8 (Q10-19), 2 against 3.2 (Q20-29), 2 against 0.5 (Q30-39), 1
against 0.1 (Q40-49), 0 of 109,001 above Q50.

Reading it: below Q30 the reported quality is slightly conservative (about
10-30 % fewer errors than stated). At Q30-49 there are 6 errors where 5.7 are
expected, too few to tell. These qualities were put in by construction as
calibrated, so what the table shows is that the consensus model does not
lose that calibration, not that an instrument's qualities are right; it
cannot show that, and it says nothing about the model's treatment of
gaps (a gap's quality is the lower of its neighbours', item 76), which is
what #350 may come from.

## The gate

Per scenario and replicate: one contig, consensus identity over the
depth-2 bases at least 99.5 %, no collapse (20 or more truth bases missing in
one stretch), read order and relative strand as built. The calibration is not
gated. A scenario that has a known deviation may fail in at most the
replicates measured (2, 1, 1, 8 and 8 above) and no more, so a failure class
cannot grow unnoticed; if the assembler is improved, lower or remove the
allowance in the same commit.

## Disagreements

| Issue | Class                                                                                    | Count                                        |
| ----- | ---------------------------------------------------------------------------------------- | -------------------------------------------- |
| #347  | Reads are joined through a repeat; the contig silently lacks the unique stretch between  | 8 of 8 (reads inside a copy); 1 of 8 (dense) |
| #348  | A repeat copy takes the read's best local alignment, so the true overlap is never tried  | 8 of 8 (sparse): 2 contigs, each correct     |
| #349  | Reads whose overlap is thin and noisy on both sides fail the 90 % over 25 bases test     | 2 of 8                                       |
| #350  | The consensus lacks a base in a homopolymer that two reads cover (suspected gap quality) | 1 of 8 below 99.5 %; 1 to 2 bases in most    |

That is the state when the oracle was built; the fixes for #347 and #348 are
in "Result of the repeat fixes" below, which supersedes the allowances and
counts above for those two rows. No algorithm, threshold or heuristic was
changed in the first part. The repeat ambiguity is
stated in item 76 ("no repeat resolution"); what these show is the outcome:
the assembler does not stop at a repeat, it either joins across it
without a flag (#347) or fails to join through it (#348).

## Result of the repeat fixes (#347, #348)

Maintainer decision 2026-10-30: fix both in 1.21.0. Code:
`src/core/assembly/assemble.ts`. The thresholds (90 % identity over 25
bases, Q17 trim, the 0.8 consensus call) were not touched.

### What changed

- **Best overlap first, not first that fits.** Each round aligns every read
  not yet placed to the consensus and the read with the best-scoring valid
  overlap joins. Before, reads were tried longest first and the first that
  fit went in, so a read starting in the second copy of a repeat could take
  a join through the first copy (a 300-base overlap that is all repeat)
  before the reads whose overlap with the contig is in unique sequence had
  grown it. Once the contig reaches the second copy the same read finds its
  own place. (#347, dense spanning reads: the misjoin in 1 of 8.)
- **The overlap a copy shadows is tried (#348).** A read that spans a repeat
  aligns best to a copy of it inside the contig, which is no overlap, and the
  shorter true overlap was never looked at. If the best local alignment is
  not an overlap, each end of the read (300 bases) is also aligned to each
  end of the consensus (300 bases): an end is too short for a copy deeper in
  to shadow what is at its edge. Placement alignments use a gap that costs 4
  to extend instead of 0.5, because with the default a local alignment ran on
  past a repeat through unrelated sequence at 57 to 67 % identity and hid a
  short true overlap beside it; where the best alignment is below the
  identity floor, its stretch above 90 % is used.
- **A read that fits at two places waits.** After the best valid placement of
  each read is found, one whose whole-read alignment also fits what is left of
  the consensus either side (it lies in a sequence the contig has twice, so it
  could be in either copy) goes in only after one that fits one place; if all
  fit two, the best goes in and the contig gets an `ambiguous-join` warning
  naming the read.
- **A pile-up is a `possible-repeat-collapse` warning.** A stretch of 100 or
  more bases at depth 3 or more, reaching 4, with a mean depth of 3 times the
  contig's median, in a contig of four or more reads. Reads from the two
  copies of a repeat laid on one give exactly this; it cannot be told from
  deliberate extra reads over one region (four or more on one stretch where
  the rest has one), which is the false-alarm class. It was measured on all
  ten scenarios: no warning anywhere but the collapsed one (the reads-inside-
  a-copy scenario, 8 of 8).
- **Speed.** A read that fits nothing in the contig is not aligned again
  until a read that joins overlaps it (a rough test: it is aligned to that
  read). 32 reads of a 5 kb region plus 8 unrelated: 7.7 s before, 13.7 s now
  (the repeat search and the per-round re-ranking cost about 1.8 times).
  The oracle suite takes about 50 s where it took 20.

Warnings are on each `Contig` (`warnings`: kind, stretch, message, read), and
the contig view shows them (guide, "Assembling reads into a contig").

### Numbers, before and after (8 replicates each)

| Scenario                                   | Contigs before         | Contigs after          | Depth-2 identity, mean (min) before | after             | Warnings after                   |
| ------------------------------------------ | ---------------------- | ---------------------- | ----------------------------------- | ----------------- | -------------------------------- |
| Repeat, dense spanning reads (200 bp step) | 1 in 7, 2 in 1         | 1 in 8                 | 95.18 % (61.5 %)                    | 99.99 % (99.94 %) | 0                                |
| Repeat, sparse spanning reads              | 2 in 8                 | 1 in 8                 | 99.97 % (99.73 %)                   | 99.97 % (99.75 %) | 0                                |
| Repeat, reads inside a copy plus flanks    | 1 in 8, collapsed in 8 | 1 in 8, collapsed in 8 | 99.96 % (99.71 %)                   | 99.96 % (99.71 %) | 8 of 8: possible-repeat-collapse |

The other seven scenarios: contig counts as before except two that moved
by chance of the placement search (noisy thin overlaps: 2 contigs in 1 of 8
where it was 2; homopolymer-rich: 1 contig in 8 and every replicate at
99.5 % or better where one was 99.42 %), identities within 0.05 points of
before (tiling clean 100 / 99.99 %, noisy 99.92 %, deep 100 %, walking
primers 100 %), no warnings, order and orientation right everywhere. #349
stays open (thin noisy overlaps, 1 of 8 now); #350 does not reproduce in
these seeds but its cause (a gap's quality) was not changed, so it stays
open.

Everything the sparse and dense scenarios said was wrong is gone: 8 of 8
one contig of about 2.1 kb at 99.7 % or better, no collapse. Calibration is
as before (Q0-9: 272 wrong against 297 expected; Q10-19: 154 against 197;
Q20-29: 16 against 22; Q30-49: 6 against 6.2).

### What cannot be fixed, and why

Reads from inside one copy of a repeat plus a flank each (the reads-inside
scenario): the contig is 1050 bp where the construct is 2100, in 8 of 8, and
stays so. The four reads are `[unique, first copy]`, `[second copy, unique]`
and two reads wholly inside a copy. Their overlaps are every one of them a
true overlap of the sequence as written: nothing in them distinguishes the
copies, so the right layout is not recoverable from the reads, only
detectable as suspect. The contig now says so in all 8 (a stretch of 190 to
270 bases at depth 3 to 4 where the rest of the contig has 1). Read pairs
or a longer read are what would resolve it; the assembler cannot. #347 stays
open for this and the oracle gates it: a collapse must carry the warning,
and the known allowance stays at 8 of 8.

### Tests that changed because of the fix

- `assemble.test.ts` "asks the aligner for a fast local alignment, and tries
  reads again after a join" pinned the exact order of aligner calls, which
  is the first-fit loop itself; it now checks that every read is tried, that
  a read that fits nothing is not re-aligned to the grown consensus, and the
  alignment options (the new gap cost).
- `sangerAssembly.test.ts`: the known-deviation allowances for the dense (1)
  and sparse (8) repeat scenarios and for the homopolymer one (1) are gone;
  the thin-overlap one is 1 (was 2). Every collapse must carry the warning;
  every other scenario must have no warning (also the local real-quality one).

## Result of the thin-overlap and gap fixes (#349, #350)

Maintainer decision 2026-10-30: fix both in 1.21.0. Code:
`src/core/assembly/assemble.ts`. The 90 % over 25 bases floor, the Q17 trim
and the 0.8 consensus call were not touched.

### #349: why the true overlap was rejected

The oracle's failing replicate was a miss of a different kind from the one
the issue describes. Sweeping 200 replicates of the thin-overlap scenario
(more than the oracle's 8), 9 gave two contigs, and for each the adjacent
pair that failed was looked at after Mott trimming, against the truth:

- **5 of 9: the trimmed reads do not overlap.** Their poor tails overlapped
  untrimmed; at Q17 the trimmed ends stop 34 bases apart, or share 9 bases,
  fewer than the 25 an overlap needs. The oracle's own failing replicate (3)
  is one of these. Nothing about identity can join them; only keeping more
  of the tails could, and the trim is kept. These are now the whole of the
  oracle's known deviation for #349 (1 of 8), and 5 in 200 is the rate of
  the class.
- **2 of 9: identity just under 90 % because both ends were poor** (88.7 %
  over 71 bases; 88.8 % over 289). This is the issue as written, and is fixed.
- **1 of 9: the alignment stopped 9 bases short of a read's end** (the slack
  is 8), where the last bases of both reads are poor and the consensus there
  is Q7-14. An attempt to pair those bases off with a gap-allowed extension
  failed (6 of 10 differed against about 1.6 expected), so it is not fixed.
- **1 of 9: a true overlap of 25 bases**, found in the wrong place. Not fixed.

The fix is quality-aware, not a lower floor. An overlap below 90 % identity
passes when its identity is at least 80 % and the columns that differ are no
more than the two bases' stated error rates lead to expect (each column's
chance is the sum of the two bases' error chances, a gap column's the chance of
the base that is there; allowed is that sum plus three standard deviations and
one). Over the true overlaps of the sweep, mismatches were 0.93 times the
expected number overall, so the stated qualities are good enough to
use as the model; three standard deviations of a Poisson count leave well under 1 %
of true overlaps rejected on their numbers. Reads that are good where they differ (the copies
of a diverged repeat: 8 differences in 60 bases at Q40) have next to nothing
expected and still need 90 %; below 80 % nothing joins, however poor the
bases. Plain-sequence reads without qualities assume Q20, so for them
nothing changes in practice.

False joins: 4500 pairs of unrelated 700-850 base reads (random, homopolymer-
rich and AT-rich constructs; the noisy and clean profiles and flat Q10, Q14
and Q20; forward and reverse) gave 0 joins. The oracle's repeat scenarios
(which have to refuse a join) are unchanged, and the diverged-repeat unit
test is in `assemble.test.ts`.

| 200 replicates, thin overlaps (400 bp step) | Two contigs before | after |
| ------------------------------------------- | ------------------ | ----- |
| Trimmed reads do not overlap                | 5                  | 5     |
| Identity just under 90 % (fixed)            | 2                  | 0     |
| Alignment stops over 8 bases short          | 1                  | 1     |
| True overlap of 25 bases                    | 1                  | 1     |
| Total                                       | 9                  | 7     |

The oracle's thin-overlap scenario is still 1 of 8 (its replicate is the
no-overlap kind), so its allowance stays at 1, and #349 is not closed by this
change: what is left is the trim, which is the maintainer's call.

### #350: the cause was the gap's quality, confirmed

The failure reproduced: not in the oracle's 8 seeds, but in 1 of 120
replicates of the homopolymer scenario (99.48 %). Over those 120, 315 consensus
errors at depth 2 or more, 214 of them a base the consensus lacks. A read
loses a base where its peak was poorest, but its gap took the lower
neighbouring quality (item 76), which is usually good, so at depth 2 it
outweighed the other read's base of slightly lower quality. A gap is now
Q6 below the poorer neighbour (`GAP_PENALTY`). Sweeping the penalty:

| Gap penalty | Errors at depth 2 or more | Missing bases | Wrong bases | Replicates under 99.5 % |
| ----------- | ------------------------- | ------------- | ----------- | ----------------------- |
| 0 (before)  | 315                       | 214           | 101         | 1 of 120                |
| 3           | 257                       | 147           | 110         | 1                       |
| 6 (chosen)  | 225                       | 111           | 114         | 0                       |
| 10          | 217                       | 90            | 127         | 0                       |

More penalty trades missing bases for wrong ones (a lone inserted base then
beats the gap), so 6 is the knee, not a fitted optimum. Across the oracle,
depth 2 or more errors went down or stayed (noisy 12 to 11, homopolymer 23 to
17, thin overlaps 8 to 7); overall identity including depth 1 moved by 0.0005
or less. The oracle's homopolymer scenario now has a mean of 99.82 % (min
99.66 %) where it had 99.71 % (99.42 % in the original run).

The test that fails before: two reads over a 7-base run, one lacking a base,
qualities Q33 and Q35. A disagreement is listed when a dissenting vote is at
Q20 or more, so a gap whose neighbours are Q25 or worse is no longer one
(the gap is Q19 or less).

### Tests that changed

- `assemble.test.ts` "gives its gap the lower quality of the bases either
  side": neighbours are 31 and 35 now, the gap's quality 25; the insertion
  column test's gap votes are 24 where they were 30.
- New: four tests in "an overlap that differs where the reads are poor", and
  the homopolymer test above.
- `sangerAssembly.test.ts`: the comment names what is left of #349 and that
  #350 is fixed; the counts are unchanged (thin overlaps 1).

## Keeping the trimmed tails (#349, fourth part)

Maintainer decision 2026-10-30: keep more of the trimmed tails. Code:
`assembleReads` in `src/core/assembly/assemble.ts` (now a wrapper over
`assembleWith`).

**Method.** Trim as before and assemble. If that gives more than one contig
(and the reads have qualities and a trim), assemble again with the trim at
`TAIL_FACTOR` (2) times its error rate, at most `TAIL_CEILING` (0.2), and keep
the second result if it has fewer contigs. The overlap rules, the quality
explanation and the quality-weighted consensus are untouched, so a kept tail
base is called at the quality it states and cannot outvote a better base.
Every input that already assembled to one contig gives the same output as
before, bit for bit; only inputs left in pieces cost a second pass.
`overlapBound.ts` needed no change: it bounds what is screened, which is
still the bases of the reads handed to the aligner, whatever the trim; its
exactness argument does not mention the trim.

**Why not a per-read window.** Extending only the read being placed does not
help when both ends are poor: the contig's own end is trimmed too. The
tried alternative was a looser trim everywhere. Sweeping 200 thin-overlap
replicates (my own seeds, so the baseline is 10 of 200, not the 7 recorded
above) at trim 0.05 (default), 0.1, 0.2, 0.4 left 10, 1, 1 and 3 splits. A
looser default would move the ends of every contig into poor sequence and
changes the setting the user chose; the second pass spends that only where
the first left pieces.

| 200 thin-overlap replicates | splits | wall (sweep) |
| --------------------------- | ------ | ------------ |
| Before (trim 0.05)          | 10     | 84 s         |
| After (two passes)          | 0      | 89 s         |

False joins: 600 pairs of unrelated 900-base reads (GC 30, 50, 65 %; Q-profiles
NOISY, plateau Q20, plateau Q14 with 400-base tails; either strand) gave 0
joins after the change. The oracle gates are unchanged and pass: the thin-
overlap scenario's allowance (`known`, 1 of 8) is removed, so it must now be
8 of 8; repeat scenarios (dense 8/8, sparse 1 contig 8/8, collapsed flagged
8/8) pass as before. The oracle files took 24.6 s wall now against 23.5 s
before on a loaded machine.

**Not fixed:** the alignment that stops 9 bases short of a read's end and the
true 25-base overlap placed elsewhere were not among the sweep's failures
after the change (the sweep's own seeds did not produce them), so they were
neither reproduced nor changed.

### Tests

`assemble.test.ts` ("overlaps in the tails the trim took off"): a join whose
only overlap is in Q12 tails; the same with the trim off or at 0.1; the
consensus keeps a Q40 base against a Q12 base that disagrees; unrelated reads
with poor ends stay apart and keep the stricter trim; reads whose tails state
Q12 but share nothing stay apart.

## Speed (#353)

Assembly got about 2x slower with #347-#350 and the oracle took 291 s on a CI
runner (under coverage). Most of the time was the "unrelated" recheck (every
read left out of the rounds aligned to each read that joins), now screened by
an exact bound (`overlapBound.ts`, numbers in `docs/perf-notes.md`): the 32 + 8
reads case went from 18.6 s to 9.5 s with identical output on every oracle
scenario. The oracle is split into four test files (`sangerAssembly1-4.test.ts`,
shared code in `sangerAssemblyHarness.ts`, each scenario has a `group`) so
vitest runs them in parallel: 16 s wall locally against ~48 s. Nothing was
trimmed: 8 replicates everywhere, no `CI` switch. `ORACLE_REPORT=1` prints one
report per file now (each covers its own scenarios). No aligner-call-order test
changed.
