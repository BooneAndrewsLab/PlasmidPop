# 125. Primer3's hairpin criterion and ranking

Issues #345, #346 (and #343, report only), 2026-10-30. The primer-pairs
oracle (item 122) found that Primer3 refuses a tenth of the pairs the
designer selects, all for its hairpin-Tm criterion, and that the designer's
top pair is rarely Primer3's. The maintainer decided both are fixed in
1.21.0.

Code: `structure.ts` (`hairpinTm`), `criteria.ts` (`hairpinTm`),
`primerDesign.ts` (`PENALTY_WEIGHTS`, `PAIR_WEIGHTS`, `pairPenalty`),
`checkPrimers.ts` (uses the same pair weights). Data and gates:
`scripts/oracle/hairpintm.py` -> `src/test/oracle/hairpinTm.json`
(`structure.test.ts`), `primerPairs.test.ts`.

## Hairpin melting temperature (#345)

Primer3 refuses a primer when the Tm of its best hairpin is above
`PRIMER_MAX_HAIRPIN_TH`, 47 C by default. That is a different measure from
the ΔG of item 124: a short G/C stem has a small ΔG and still melts high
(`AGGGAACCCATGAGCACCAAAC`: ΔG -0.8, Tm 58.6 C).

`hairpinTm(seq)` carries a ΔH alongside the ΔG of the same fold (stacks use
the ΔH of `NN_PARAMS`; loops, mismatches, ends and A/T closings are seven
lumped scalars in `STRUCTURE_PARAMS.enthalpy`), takes ΔS from the two at
37 C and returns ΔH/ΔS in C, 0 where there is no hairpin. The scalars were
fitted to Primer3's hairpin Tm (coordinate descent) on the 300 primers of
`hairpinDimer.json` and the even rows of a new set, `hairpinTm.json`: 800
primers inside the designer's Tm and GC limits (random windows of seeded
templates, primer3-py 2.2.0, conditions of the design).

The Tm is steep in ΔG (0.5 kcal/mol is about 7 C here) and our ΔG is
off by up to a kcal/mol for the structures that matter, so the estimate is
noisy: without an offset it flags 99 of the 164 primers Primer3 refuses and
16 it does not. `hairpinTmOffset` (+6 C) is added to the Tm of a hairpin that
exists at 37 C; it trades more false flags for fewer misses, and a miss is
worse (the pair is refused by Primer3) than a false flag (a candidate is
dropped, and a designer has hundreds):

| Offset | Flagged by both | Ours only | Primer3 only |
| -----: | --------------: | --------: | -----------: |
|      0 |              99 |        16 |           65 |
|      6 |             135 |        84 |           29 |
|     10 |             148 |       166 |           16 |

(800 primers, 164 of them refused by Primer3.) Recall at +6 is 82 %. The
rest are hairpins our fold does not find at all: 2-3 bp G/C stems with
three-base loops, where Primer3's loop tables (tri- and tetraloop bonuses,
wobble pairs) give a stability our scalars do not. Lowering our loop
costs, or adding a triloop bonus, was tried and moves false flags and
misses together (for example, hairpin loop 3 at 2.5 kcal/mol: 146 / 146 / 18 and a
ΔG error against the 300 set up from 0.26 to 0.33). Only a model with
`thal`'s tables would do better. The offset was chosen on the same 800
primers the other scalars were fitted on, so the figures are the fit's own.

The criterion is `PrimerCriteria.hairpinTm` (default 47, Settings "Hairpin
Tm"), a primer above it is refused by `candidatePenalty` and warned by
`analyzePrimer` ("Hairpin melts at 52 C, above 47 C"). `PrimerReport` has
`hairpinTm`. The fold costs about 20 % more (0.02 ms per primer, memoised).

Primer3 accepts 191 of 200 selected pairs with this alone (181 before),
95.5 %, with the old ranking.

## Hairpin loops from the paper (#345, second step)

The 95 % aim was missed (180 of 200), and the cause named was that our hairpin
fold had only fitted scalar loop terms. The maintainer supplied SantaLucia and
Hicks 2004, "The thermodynamics of DNA structural motifs", Annu Rev Biophys
Biomol Struct 33:415-440 (the numbers below are from it and from nowhere
else; Primer3's own parameter files were not read, only run through
primer3-py for comparison numbers).

What the paper gives, and what `structure.ts` now uses:

| Term                                              | Value                                                                 | Source                          |
| ------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------- |
| Hairpin loop ΔG°37, sizes 3, 4, 5, 6, 7, 8, 9, 10 | 3.5, 3.5, 3.3, 4.0, 4.2, 4.3, 4.5, 4.6                                | Table 4, hairpin column, p. 427 |
| Sizes 12, 14, 16, 18, 20, 25, 30                  | 5.0, 5.1, 5.3, 5.5, 5.7, 6.1, 6.3                                     | Table 4, p. 427                 |
| Any other size n                                  | ΔG(x) + 2.44 R (310.15) ln(n/x), x the largest tabulated size below n | Equation 7, p. 427              |
| Loops shorter than 3                              | barred                                                                | Hairpin Loops, p. 428           |
| Loop of 3 closed by A·T                           | +0.5, and no terminal mismatch                                        | Equation 8, p. 428              |
| Loop ΔH                                           | 0, so ΔS = -ΔG/310.15                                                 | Table 4, footnote a, p. 427     |

The loop's entropy is the only temperature dependence the paper gives it, so
the hairpin's ΔH is the stacks' alone and `enthalpy.hairpinLoop` is now 0
(it was a fitted -4.5, absorbing what the fitted loops got wrong); the
triloop's A·T penalty also carries no ΔH (the paper does not say; its rule
for loops is zero). The paper's footnote writes ΔS = +ΔG × 1000/310.15; the
sign that makes ΔG = ΔH - TΔS is minus, which is what the code uses.

Not in the paper (the first step did not have the supplement; the tri- and
tetraloop increments were added in the next section):

- The terminal mismatch in hairpin loops (Equations 9 and 10): the text
  cites an unpublished table (Varma and SantaLucia), and the supplement has
  none (its Table S1 is the loops, Table S2 multibranch loops). The one
  number the paper prints, -1.23 for CGCAAG (p. 428), is a single entry, not
  a table. The fitted scalars `hairpinMismatchGc`/`hairpinMismatchAt`
  (-0.8, -0.6) and the fitted `enthalpy.hairpinMismatch` stay, for the loops
  of four and more.
- The paper does give internal single mismatches (Table 2, p. 424, with
  G·T wobble mismatches) and dangling ends (Table 3, p. 426); they would
  replace more fitted scalars but were out of the brief and are not used.

The only change to the temperature offset: with the loop enthalpy at 0 the
unshifted Tm of a hairpin rises, so the old +6 C turned into a much larger
price (17.5 % of primers flagged that Primer3 would not, from 10.5 %). The
offset is re-fitted to the same rule as before (false flags at about 12 %):
+3 C. The hairpin ΔG cutoff (-2 kcal/mol) was swept from -1 to -3 on three
sets and -2 is still the best or within 1 point of it (95.3, 93.0, 95.3 %).

Measured, hairpin flagged the same way as Primer3 (ΔG at or below -2), first
the committed set, then three held-out sets of the same kind (other
seeds, kept out of the repository, `hairpindimer.py` with SEED 31415 and
27182):

| Set                        | Before   | After  |
| -------------------------- | -------- | ------ |
| hairpinDimer.json (300)    | 94.7 %   | 95.3 % |
| held-out 31415 (300)       | 92.3 %   | 93.0 % |
| held-out 27182 (300)       | 95.7 %   | 95.3 % |
| hairpinTm.json (800), mean | ΔG error |        | 0.254 | 0.242 |
| held-out 20271101 (800)    | 97.5 %   | 97.5 % |
| held-out 20281101 (800)    | 96.1 %   | 96.9 % |

Hairpin Tm at 47 C (recall of what Primer3 refuses / our flags Primer3 would
not make, share of 800), with +6 before and +3 after; "paper loops, +6" is
the intermediate step:

| Set               | Before          | Paper loops, +6 | After (+3)      |
| ----------------- | --------------- | --------------- | --------------- |
| hairpinTm.json    | 82.3 % / 10.5 % | 87.8 % / 17.5 % | 83.5 % / 11.8 % |
| held-out 20271101 | 83.9 % / 12.0 % | 91.3 % / 18.6 % | 87.0 % / 12.1 % |
| held-out 20281101 | 89.3 % / 11.3 % | 92.6 % / 19.6 % | 88.6 % / 13.4 % |

Primer3's acceptance of our selected pairs (`primerPairs.json`, regenerated):
**182 of 200 (91 %)**, from 180 (184 with +6 and a worse Tm price). The 95 %
aim is **not met**. Every one of the 18 refusals is a hairpin Primer3
calls too stable by its Tm. Of the 9 distinct primers inspected (at +6, before the
re-fit), our fold found no hairpin at all in 7; the structures Primer3
reports for them are stems of two G/C pairs closed by three or four bases
(one is `GGCGAAGC`-like, a GAA loop), which is what the bonuses of the
supplementary material are for. What remains is
therefore that data, or a bonus fitted to Primer3's output (not done: the
brief was the paper only).

Side effects: the overlap with Primer3's top pair slipped from 10, 21, 35 to
9, 19, 34 of 40 (equal, both primers, any of five); the four-part Golden Gate
check (`checkPrimers.test.ts`) lost its pair at the middle junction, whose one
forward primer (`CTTTGCGTTTAGCGTAACACATC`) Primer3 gives a hairpin Tm of 50 C
(limit 47), so that is the better answer.

## Tri- and tetraloop increments from the supplement (#345, third step)

The maintainer then supplied the supplementary material of the same paper
(Annu Rev Biophys Biomol Struct 33:415-440). Its Table S1, "Free energy (ΔG)
and enthalpy (ΔH) increments for tri/tetra loops (kcal/mol in 1 M NaCl at
37 C)", lists 16 triloops and 115 tetraloops, each with a ΔG and a ΔH; Table
S2 is the multibranch-loop increments, not used (the fold has none). The
numbers are in `src/core/primers/hairpinLoops.ts`, parsed from the PDF's text
and checked against a second, hand-made transcription of the page images (all
131 rows identical). The supplement itself is not committed. Primer3's
parameter files were not read, as before.

How the paper applies them (p. 428, Equations 8, 9 and 11) and what
`foldHairpin` does:

| Loop of    | Total ΔG°37                                              | Code                                                                        |
| ---------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| 3          | 3.5 (Table 4) + triloop increment + 0.5 if closed by A·T | no terminal mismatch; increment looked up by the loop with its closing pair |
| 4          | 3.5 (Table 4) + tetraloop increment + terminal mismatch  | increment looked up the same way; the mismatch is still the fitted one      |
| 5 and more | Table 4 (+ Equation 7) + terminal mismatch               | unchanged                                                                   |

The key is the loop's bases with the closing pair at either end, 5' to 3'
(`CGAAG`: a C·G pair closing the loop GAA); an increment applies only to a
loop of exactly three (triloops) or four (tetraloops) bases. The ΔH of the
increment is added to the hairpin's enthalpy ("hairpin loop ΔH and ΔS are
computed with equations analogous to Equations 8-10", Equation 11, p. 428).
Equation 9 in the paper prints "triloop bonus" for the tetraloop; the
supplement's tetraloop list is plainly what is meant. The GNA rule the paper
states for triloops is not a separate rule in the code: the table is the
rule (all 16 entries are G-N-A loops, with ΔG = ΔH: -1.5 when closed by A·T or
T·A, -2.0 when by C·G or G·C; a test checks it). 38 of the 115 tetraloops are
closed by a G·T pair; they are kept as published, and the fold, which forms
only Watson-Crick pairs, never reaches them.

Still not available, kept as it was: the hairpin terminal mismatch (above),
so `hairpinMismatchGc/At` and `enthalpy.hairpinMismatch` are the fitted values
(the supplement has no ΔG or ΔH for them). No other scalar was touched, and
no value was re-fitted.

Measured. Hairpin flagged the same way as Primer3 (ΔG at or below -2), before
(paper loops only) and after, committed set and held-out sets (seeds 31415,
27182, 31337, 4242, 777; not committed):

| Set                     | Before | After  |
| ----------------------- | ------ | ------ |
| hairpinDimer.json (300) | 95.3 % | 95.0 % |
| held-out 31415          | 93.0 % | 93.7 % |
| held-out 27182          | 95.3 % | 95.7 % |
| held-out 31337          | 95.3 % | 95.0 % |
| held-out 4242           | 92.3 % | 93.3 % |
| held-out 777            | 95.7 % | 96.0 % |

(The 300-primer set is a hair worse: 9 ours-only and 6 Primer3-only
disagreements; the held-out sets of the same kind are 93.3-96.0 %, the aim of
90 % is met on all of them.) The ΔG error of the stems the Tm depends on is
smaller on the committed 800 (mean |ΔG| difference 0.172 to 0.143 kcal/mol)
and on 20271101 (0.175 to 0.147), a hair larger on 20281101 (0.161 to 0.167).

Hairpin Tm at 47 C, recall of what Primer3 refuses / our flags Primer3 would
not make as a share of 800 (the offset is the fit's single remaining free
number; the sweep is the same rule as before, on all of it):

| Set               | +3 before       | +3 now          | +2 now          | +1 now          | 0 now          |
| ----------------- | --------------- | --------------- | --------------- | --------------- | -------------- |
| hairpinTm.json    | 83.5 % / 11.8 % | 95.7 % / 12.1 % | 91.5 % / 7.5 %  | 90.9 % / 6.0 %  | 89.0 % / 5.0 % |
| held-out 20271101 | 87.0 % / 12.1 % | 98.1 % / 12.8 % | 96.9 % / 9.3 %  | 95.7 % / 8.9 %  | 94.4 % / 8.3 % |
| held-out 20281101 | 88.6 % / 13.4 % | 98.7 % / 15.3 % | 96.0 % / 11.6 % | 96.0 % / 10.1 % | 94.0 % / 9.1 % |

Primer3's acceptance of our selected pairs (`primerPairs.json`, regenerated
for each offset): +3: **197 of 200 (98.5 %)**; +2, +1 and 0: 192 of 200
(96 %); 182 (91 %) before. So the offset is no longer needed to reach 95 %,
but it still buys 4-9 points of recall for 4-7 points of false flags and
three more accepted pairs. It is kept at +3, which is the rule the previous
step used (false flags about 12 % on the fitted set), not re-fitted; on the
held-out sets it costs a little more (13-15 %). The 3 refused pairs of 200
are all hairpins Primer3 calls too stable by its Tm.

Side effects: the overlap with Primer3's top pair is now equal 10, both
primers 20, any of five 36 (of 40; 9, 19, 34 before), median penalty 1.20 times
Primer3's best and 18 of 40 worse than all its five (1.12, 18 before). The
four-part Golden Gate check in `checkPrimers.test.ts` and the PCR, cloning
and tutorial tests are unchanged in their results (run with this change: no
failure, nothing in `docs/tutorials` needed updating).

## Ranking (#346)

Primer3's pair penalty with default weights is, exactly (checked on the 400
primers of the oracle to 0.005), the sum over the two primers of
|Tm - 60| + |length - 21|; its weights for the pair's Tm difference, product
size, GC and its own dimer terms are all 0. Ours was |Tm - 60| plus a 10 per
unit GC term (up to 1.5), a 1.5 clamp term, hairpin and dimer terms and only
0.1 per base of length: so among primers within the Tm range the chosen ones
differed. `candidatePenalty` now weighs length at 1 per base from 21, as
Primer3 does, and the other terms are cut to tie-breakers
(`PENALTY_WEIGHTS`): GC 1 (was 10), no clamp 0.3 (1.5), hairpin 0.5 per
kcal/mol (same), self-dimer 0.025 (0.25), 3' self-pairing 0.03 (0.3); a pair
adds 0.25 per C of Tm difference (1) and 0.03 per base of cross-dimer (0.3).
A product-size term was not added: Primer3's default weight is 0, so a
pair far from the target ranks as it does in Primer3; the region settings
are how the user keeps primers close.

Weights were chosen from a sweep of about 50 settings on the oracle, each
run through Primer3. What the sweep showed:

- The ranking is chaotic in the small terms: Primer3's best primers tie to
  within a fraction of a point, so a 0.25 dimer term is enough to move the top pair away from
  Primer3's (overlap 22 of 40 for Tm and size alone, 12 with the old small
  terms at their old weights).
- Length at weight 1 with the old small terms gave 12 of 40 and a
  median penalty 2.3 times Primer3's best; scaled down to a tenth, 20 of 40
  and 1.1.
- Acceptance by Primer3 does not follow the ranking weights (hairpin
  weights 0.5 to 8 left it at 176-183 of 200): the primers it refuses
  that we pick have, in our fold, no hairpin to speak of.

## Result

Primer-pairs oracle (`primerPairs.json`, 40 templates, 200 pairs):

| Measure                                             | Before 125 | After 125 |
| --------------------------------------------------- | ---------- | --------- |
| Our pairs Primer3 accepts outright                  | 181 / 200  | 197 / 200 |
| Our top pair equals Primer3's top pair              | 0 / 40     | 10 / 40   |
| Our top pair overlaps Primer3's (both primers)      | 7 / 40     | 20 / 40   |
| Any of our 5 overlaps any of Primer3's 5            | 18 / 40    | 36 / 40   |
| Median our top pair's Primer3 penalty over its best | 23         | 1.20      |
| Our top pair worse than all Primer3's top 5         | 39 / 40    | 18 / 40   |

**Acceptance, #345 (met after the third step).** The hairpin criterion alone
got 191 of 200 (95.5 %) under the old ranking; the ranking of #346 (Tm and
size, hairpin a tie-breaker) put primers at the optimum whatever their
hairpin, and the hairpins Primer3 refuses that our fold missed (stems of two
or three G/C pairs closed by a GNA triloop or a tetraloop) reached the top
five: 180 of 200 (90 %). The paper's loop sizes gave 182, and the
supplement's tri- and tetraloop increments 197 of 200 (98.5 %): the table
above is the state before the supplement.

## #343, 3' complementarity

Left as it is (item 124: a documented rule, "ours only" 39 pairs).

## Left open

- The hairpin terminal mismatch is still the fitted scalars (no published
  table is available); the paper's internal-mismatch and dangling-end tables
  (Tables 2 and 3) are not used either.
- `hairpinTm` is estimated for hairpins only; Primer3's dimer-Tm criteria
  (`PRIMER_*_COMPL_*_TH`, also 47 C) are not modelled, and no pair was refused
  for them in the oracle.
