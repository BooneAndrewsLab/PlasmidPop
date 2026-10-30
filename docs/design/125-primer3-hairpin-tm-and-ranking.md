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
| Our pairs Primer3 accepts outright                  | 181 / 200  | 180 / 200 |
| Our top pair equals Primer3's top pair              | 0 / 40     | 9 / 40    |
| Our top pair overlaps Primer3's (both primers)      | 7 / 40     | 20 / 40   |
| Any of our 5 overlaps any of Primer3's 5            | 18 / 40    | 34 / 40   |
| Median our top pair's Primer3 penalty over its best | 23         | 1.12      |
| Our top pair worse than all Primer3's top 5         | 39 / 40    | 18 / 40   |

**Not met: the 95 % acceptance of #345.** The hairpin criterion alone gets
191 of 200 (95.5 %), under the old ranking. A ranking by Tm and size picks
primers at the optimum whatever their hairpin, and the hairpins Primer3 refuses
that our fold misses (about one primer in six of those it refuses) then reach the
top five more often: 180 of 200 (90 %), 20 refusals, every one the
hairpin criterion. Raising the offset past 6 does not help (those are
hairpins we do not find); refusing every hairpin our fold finds catches
148 of 164 and drops 39 % of candidates. The two targets are in tension
with this model; the maintainer's call is the ranking, which gets Primer3's
pair on 9 of 40 templates. Closing it needs `thal`'s loop tables
(multi-branch, triloops, wobble) in `structure.ts`.

## #343, 3' complementarity

Left as it is (item 124: a documented rule, "ours only" 39 pairs).

## Left open

- The hairpin-Tm recall (82 %) and the 95 % acceptance of #345.
- `hairpinTm` is estimated for hairpins only; Primer3's dimer-Tm criteria
  (`PRIMER_*_COMPL_*_TH`, also 47 C) are not modelled, and no pair was refused
  for them in the oracle.
