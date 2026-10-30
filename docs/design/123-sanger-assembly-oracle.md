# 123. Sanger read assembly against a known construct

Issue #335, 2026-10-30. Item 76's assembly was covered by unit tests built
from reads cut from a known sequence, with perfect or hand-placed errors.
This item asks how it does on reads whose errors follow their own Phred
qualities, over layouts that include repeats and noisy ends, and whether the
reported consensus qualities mean what they say.

Code: `src/test/oracle/sangerSim.ts` (the simulator), `src/test/oracle/
sangerAssembly.test.ts` (scenarios, gate, report). No data file is committed
and no reference assembler was used: the truth is the construct the reads
were cut from, so the comparison is exact. `ORACLE_REPORT=1 npx vitest run
src/test/oracle/sangerAssembly.test.ts` prints the report below as JSON.

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

No algorithm, threshold or heuristic was changed. The repeat ambiguity is
stated in item 76 ("no repeat resolution"); what these show is the outcome:
the assembler does not stop at a repeat, it either joins across it
without a flag (#347) or fails to join through it (#348).
