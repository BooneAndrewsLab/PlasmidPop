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

Not in the paper, and therefore not added:

- The tri- and tetraloop bonuses (it says they are in the supplementary
  material, the "known special stability of GNA" and GNRA/GNAB tetraloops).
  No number was invented for them.
- The terminal mismatch in hairpin loops (Equations 9 and 10): the text
  cites an unpublished database, no table. The fitted scalars
  `hairpinMismatchGc`/`hairpinMismatchAt` (-0.8, -0.6) and the fitted
  `enthalpy.hairpinMismatch` stay, for the loops of four and more.
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

- The hairpin-Tm recall (84 %) and the 95 % acceptance of #345 (91 %): the
  tri- and tetraloop bonuses.
- `hairpinTm` is estimated for hairpins only; Primer3's dimer-Tm criteria
  (`PRIMER_*_COMPL_*_TH`, also 47 C) are not modelled, and no pair was refused
  for them in the oracle.
