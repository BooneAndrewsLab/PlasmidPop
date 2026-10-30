# 122. Selected primer pairs against Primer3

Issue #337, 2026-10-30. Item 121 compared the hairpin and dimer checks with
Primer3's thermodynamics on primers made up for the purpose. This item asks
the end-to-end question: of the pairs `designPrimers` actually selects, how
many would Primer3 accept, and does it pick the same ones?

Code: `scripts/oracle/primerpairs.py` (generator, wired into
`scripts/oracle/generate.py`), `src/test/oracle/primerPairs.json` (data),
`src/test/oracle/primerPairsOurs.json` (the pairs our designer selected,
which the generator needs as input), `src/test/oracle/primerPairs.test.ts`
(gate and exporter). `scripts/oracle/run.sh primer-pairs` regenerates the
two JSON files together: templates and Primer3's design first, then our
designer's pairs exported by the test (`ORACLE_EXPORT_PAIRS=1`), then
Primer3's verdict on them. Plain `generate` reuses the committed
`primerPairsOurs.json`. If the designer changes what it selects, the test
says to run `run.sh primer-pairs` (it re-runs the designer on the first 8
templates to check).

## What was compared

40 seeded synthetic templates (seed 20261031), 1.0-1.8 kb, GC 30-65 %;
every third has a repeated segment, every third a homopolymer and a
dinucleotide repeat. Each has a target of 100-400 bp. Nothing is taken from
a real genome or database.

- **Primer3's design**: primer3-py 2.2.0 `design_primers` with settings that
  match our defaults: primers 18-27 nt (optimum 21), Tm 55-65 C (optimum
  60), GC 35-65 %, pair Tm difference at most 3 C, at most 4 of one base in
  a row, SantaLucia parameters and salt correction at 50 mM Na+ and 500 nM
  primer (the conditions of our `meltingTemperature`), the pair flanking the
  target within 200 bp each side. Its top 5 pairs are recorded. Everything
  else is Primer3's default, including its hairpin limit (Tm of the
  structure at most 47 C) and its dimer limits.
- **Primer3's verdict on ours**: our top 5 pairs per template (200) go to
  `design_primers` as `SEQUENCE_PRIMER` and `SEQUENCE_PRIMER_REVCOMP` with
  the same settings. A pair Primer3 returns is accepted by its criteria and
  carries its penalty; one it does not return is run again with
  `PRIMER_PICK_ANYWAY` and the reasons from the refusing run (its EXPLAIN
  strings) are kept.

## Measured

| Measure                                                  | Result                                |
| -------------------------------------------------------- | ------------------------------------- |
| Primer3 found a pair on the template                     | 40 of 40                              |
| Our Tm against Primer3's, largest difference             | 0.005 C                               |
| Our pairs inside Primer3's Tm and GC limits, Tm diff 3 C | 200 of 200 (100 %)                    |
| Our pairs Primer3 accepts outright (all criteria)        | 177 of 200 (88.5 %)                   |
| Our pairs refused, reason                                | 23, all high hairpin stability (#345) |
| Our top pair equals Primer3's top pair                   | 0 of 40                               |
| Our top pair overlaps Primer3's top pair (both primers)  | 7 of 40                               |
| Any of our 5 overlaps any of Primer3's 5                 | 18 of 40                              |
| Our top pair, Primer3 penalty worse than all its top 5   | 36 of 37 accepted (#346)              |

Penalties are not comparable between the two programs (ours is
`candidatePenalty` plus Tm difference and cross-dimer; Primer3's weighs
distance from the optimum Tm and size and the product size), so the penalty
is used only to rank our pair among Primer3's.

## The gate

Aim: at least 95 % of selected pairs pass Primer3's Tm, GC and penalty
criteria. By Tm and GC alone, 100 % do, and the test holds the 95 % aim.
By Primer3's full verdict the aim is **missed**: 88.5 %. Per the maintainer's
instruction the algorithms were not changed; the gate holds the measured
floor, 86 %, and caps the refusals at 23, each of which must give "high
hairpin stability" and no Tm, GC, run or size reason. The top-pair overlap
is held at 5 of 40 (measured 7) and the any-of-five overlap at 15 of 40
(measured 18). If the designer is improved, raise the floors in the same
commit.

## Disagreements

| Issue | Class                                                                   |                     Count |
| ----- | ----------------------------------------------------------------------- | ------------------------: |
| #345  | Pairs holding a primer with a hairpin Primer3 finds too stable          |           23 pairs of 200 |
| #346  | Our top pair is rarely Primer3's, and scores worse by Primer3's penalty | 33 of 40 templates differ |

#345 is the designed-pair face of #340: the refused primers have stems of
2-4 bp, GC-rich, that `longestHairpinStem` (limit 4) passes. #346 is a
difference in ranking, not in acceptability: both programs agree on what an
acceptable primer is (Tm and GC identical) and differ on which acceptable
pair is best.

## After item 124

With the free-energy hairpin check, Primer3 accepts 181 of 200 selected pairs
(90.5 %); 19 are refused, all for its hairpin-Tm criterion (#345). The top-pair
overlaps are unchanged (#346). See item 124.

## After item 125

The hairpin-Tm criterion and a Tm-and-size ranking (#345, #346; item 125),
re-exported and regenerated with `run.sh primer-pairs` (the script no longer
deletes its own input):

| Measure                                                 | Item 122 | Item 124 | Item 125 |
| ------------------------------------------------------- | -------: | -------: | -------: |
| Our pairs Primer3 accepts outright                      |  177/200 |  181/200 |  180/200 |
| Our top pair equals Primer3's top pair                  |     0/40 |     0/40 |     9/40 |
| Our top pair overlaps Primer3's top pair (both primers) |     7/40 |     7/40 |    20/40 |
| Any of our 5 overlaps any of Primer3's 5                |    18/40 |    18/40 |    34/40 |
| Our top pair's Primer3 penalty, median over its best    |      23x |      23x |    1.12x |

The 95 % acceptance aim is still missed: the hairpin criterion alone reached
191 of 200 under the old ranking, and the new ranking, which picks primers
at the Tm and size optimum, meets more of the hairpins our fold cannot see
(item 125). The gate holds 90 % and 20 refusals; the overlap floors are the
measured 20 and 34, and a penalty-ratio gate is added.
