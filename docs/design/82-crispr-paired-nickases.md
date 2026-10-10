# 82. CRISPR paired nickases (#223)

**Asked:** the follow-up named in item 74: pair guides on opposite strands
whose nicks are close enough to make a staggered double-strand break, and
list the pairs with their offset and overhang.

**Decided: `pairNickases` in `core/analysis/crisprEdit.ts`, pure arithmetic
on the guides already found, and a `Paired nickases` group in the CRISPR
tab.** No worker request, no score.

## Geometry

Each guide has one nick, on the strand chosen by the nickase: D10A (the
usual choice, Ran 2013) leaves the HNH domain active, which cuts the target
strand, the one the spacer pairs with; H840A cuts the PAM strand. For
guides on opposite strands this puts one nick on each strand either way.
With the forward-strand nick at `a` and the reverse-strand nick at `b`
(boundaries between bases, as `CrisprGuide.cut`), `offset = b - a`:
positive leaves a 5' overhang of that many bases, negative a 3' overhang,
zero a blunt break. With D10A, PAM-out guides come out 5' and PAM-in guides
3', matching the literature; H840A swaps them. On a circle the offset is
the short way round, so a pair across the origin is found.

The reach is `MAX_PAIR_OFFSET` (100 bp, the range Ran et al. saw breaks over)
and adjustable. Pairs are sorted by distance between the nicks.

## Scope

Only nucleases with one cut point per guide (`supportsNickPairs`, the same
test as prime editing): SpCas9, SaCas9 and custom Cas9-like PAMs. Cas12a
cuts the strands apart already and has no widely used nickase. No scoring,
as in 74; off-targets are the per-guide counts already shown, and a pair
is not checked for off-target nick pairs.
