# 121. Hairpin and dimer checks against Primer3

Issue #336, 2026-10-30. `thermo.json` validates melting
temperatures against Primer3 and Biopython; the hairpin and dimer checks
had only a one-off audit script (`scripts/oracle/audit/primers/check_analyze.py`)
and no committed dataset. This item commits one and gates on it loosely.

Code: `scripts/oracle/hairpindimer.py` (generator, wired into
`scripts/oracle/generate.py`; `scripts/oracle/run.sh generate`),
`src/test/oracle/hairpinDimer.json` (data), `src/test/oracle/hairpinDimer.test.ts`
(gate).

## What was compared

Our checks are length heuristics: `longestHairpinStem`,
`maxSelfComplementarity`, `threePrimeComplementarity`. Primer3
(primer3-py 2.2.0) `calc_hairpin`, `calc_homodimer` and `calc_heterodimer`
are nearest-neighbour thermodynamics. They are compared on which primers are
**flagged**:

- Ours, at the designer's defaults (`DEFAULT_PRIMER_CRITERIA`): a hairpin
  when the stem is over 4 bp; a self-dimer when the longest
  self-complementary stretch is over 6 bp or the 3' self-complementarity
  over 4 bp; a pair dimer when the 3' complementarity of either primer to
  the other is over 4 bp.
- Primer3: the dG at 37 C, 50 mM Na+, no Mg2+ or dNTPs, 50 nM oligo (the
  conditions of our Tm) at or below a cutoff.

Dataset (seed 20261030): 300 primers and 199 pairs. Lengths 8-45 with most
in 18-27, GC from 15 to 85 %, and planted hairpins, 3' self-
complementarity, palindromes and homopolymers; pairs are random, planted
with 3' complementarity, or planted with an internal shared stretch. The set
is deliberately rich in what the checks are about, so the share flagged is
far higher than among real primers, and agreement depends on that mix: the
numbers compare the two methods on this set, not on primers in general.

## Cutoffs, chosen from the first measured numbers

Swept dG cutoffs from -0.5 to -9 kcal/mol (and Primer3 Tm cutoffs from 20 to
50 C) for each check and kept the one with the best agreement among values
that are conventional for a primer-design tool:

| Check      | Primer3 flags at | Both | Ours only | Primer3 only | Neither | Agreement |
| ---------- | ---------------- | ---: | --------: | -----------: | ------: | --------: |
| Hairpin    | dG <= -2         |   63 |        35 |           19 |     183 |    82.0 % |
| Self-dimer | dG <= -6         |   76 |        27 |           34 |     163 |    79.7 % |
| Pair dimer | dG <= -6         |   16 |        35 |           23 |     125 |    70.9 % |

(300, 300 and 199 cases.) Agreement was flat near the best cutoff
(hairpin 78-82 % from -1.5 to -3, self-dimer 75-80 % from -5 to -6), so the
choice is not delicate. Primer3's Tm of the structure agreed worse (hairpin 58-73 %, self-dimer up to 81 %, pair up to 74 %)
and was not used. Restricting to primers inside the designer's own length
and GC window did not help (hairpin 82 %, self-dimer 84 %, pair 71 % on 38
pairs).

## The gate

The maintainer's aim was 90 % agreement. It is not met: the first
measurement is 70-82 %. Per instruction the algorithms were not changed to
reach it; the gate holds the measured floor instead, a few points under each
number (hairpin 80 %, self-dimer 78 %, pair 68 %), and the disagreements are
capped at the measured counts. The test fails if agreement drops or a class
of disagreement grows. If a heuristic is improved, raise the floor in the
same commit.

## Disagreements

They fall into six classes, each its own issue (milestone 1.21.0). None is a
defect in the sense of a wrong answer; all come from counting base pairs
where Primer3 weighs them.

| Issue | Class                                                                        | Count |
| ----- | ---------------------------------------------------------------------------- | ----: |
| #339  | Hairpin: ours flags a 5-6 bp AT-rich stem, Primer3 finds it unstable         |    35 |
| #340  | Hairpin: ours passes a 3-4 bp GC-rich stem, Primer3 finds it stable          |    19 |
| #341  | Self-dimer: ours flags AT-rich self-complementarity, Primer3 weak            |    27 |
| #342  | Self-dimer: ours misses GC-rich dimers with mismatches or several short runs |    34 |
| #343  | Pair: ours flags a 5-8 bp 3' match, Primer3 weak (mostly AT-rich)            |    35 |
| #344  | Pair: ours ignores internal GC-rich cross-dimers (3' end only by design)     |    23 |

The pattern: the checks are blind to G/C content (a 5 bp GC stem and a 5 bp
AT stem count the same) and to anything but one unbroken run. The cost is
two-sided: false alarms on AT-rich primers and silence on GC-rich ones with
mismatched stems. The pair check's 3'-only rule is a design choice
(`threePrimeComplementarity`'s doc comment) and class #344 is the price of
it.

Not covered, as the issue also proposed: comparing the pairs the designer
selects against Primer3's own design output on fixed templates.

## Result of the fix

Issues #339-#344 were fixed in 1.21.0 by replacing the length heuristics with
a free-energy calculation (item 124). Same dataset and cutoffs, agreement
with Primer3 after: hairpin 94.7 % (was 82.0), self-dimer 95.7 % (was 79.7),
pair dimer 95.5 % (was 70.9). The gate now holds those floors and the
disagreement counts in item 124. The tables above are the measurement that
motivated the change.
