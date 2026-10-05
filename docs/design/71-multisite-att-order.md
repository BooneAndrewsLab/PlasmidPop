# 71. The order a MultiSite att pair runs in (#147)

**Found:** the follow-up of #133 (item 48, `48-gateway.md`). Which of an
insert's two att sites the moving DNA runs _from_ is read off the strands
they are drawn on; where a file draws both on one strand that evidence is
gone and the names are all that is left. The rule then was the original
numbering — `attB1`–insert–`attB2`, so the lower number first — and
Invitrogen's MultiSite pairs do not follow it.

- **The kits' layout, not the counting order.** A MultiSite expression
  clone reads `attB4`–`attB1`–`attB5`–`attB2`–`attB3`, and its fragments
  are therefore `attB4`–element–`attB1r`, `attB1`–element–`attB5r`,
  `attB5`–element–`attB2` and `attB2r`–element–`attB3`. So `4` comes before
  `1`, `5` between `1` and `2`, and `3` last. `SITE_ORDER` in `gateway.ts`
  is that order and `siteRank` reads a site's place in it, with the `r`
  suffix — the same site written the other way round — ranking just after
  its own number. Which of a pair carries the `r` is no guide on its own:
  the 5′ element ends in `attB1r`, the 3′ element _starts_ with `attB2r`.
- **What went wrong before.** A 5′ element (`attB4`–element–`attB1r`) drawn
  with both sites on one strand ranked `1r` before `4`, so the arc through
  the backbone was taken as the piece that moves and the byproduct came
  back as the entry clone — silently, unless the donor happened to name its
  cassette `ccdB`, which is the one name allowed to overrule a guess. The
  same held for `attB5`–element–`attB2` (5 counts after 2) and for an LR of
  an `attL4`/`attL3` entry clone into a pDEST R4-R3 (3 counts before 4).
  `attB1`–`attB5r` and `attB2r`–`attB3` happened to come out right under
  either rule, and are kept as cases that must not change.
- **Still a guess.** A same-strand drawing is believed no more firmly than
  before: the order is marked uncertain, so a cassette the vector calls
  `ccdB` can still overrule it, with the warning that says so. Where the
  two sites _are_ drawn on opposite strands nothing changed — the strands
  decide, and a pair drawn facing outward names the arc through the origin
  as the piece that moves, which is what that drawing says.
- **Checked against pydna** (`scripts/oracle/gateway.py`,
  `src/test/oracle/gateway.json`): a 5′ element BP and a 3′ element BP, the
  5′ one also written the other way round and rotated so its element wraps
  the origin, and a one-fragment LR into a pDEST R4-R3. pydna's
  `gateway_overlap` only looks for the numbers 1 to 4, so the pairs using
  `attB5` cannot be checked against it and are in `gateway.test.ts`
  instead. The sites in both places are authentic: `attB1`, `attP1`,
  `attL1` and `attR1` as published (Hartley et al. 2000, Genome Res.
  10:1788 — the sequences pydna's own doctests carry), with the other
  numbers made from them by swapping the seven-base specificity core, which
  is the only part that differs. No vendor's vector file is copied.
- The oracle's "sites numbered against the convention" cases used to swap
  the numbers 1 and 2, which left a MultiSite pair untouched; they now
  exchange whichever two numbers a case has, so the order the names give is
  always the other one.

**Not verified:** that a 5′ entry clone's site 1 is the `attR1` its kit name
(pENTR L4-R1) implies. Run against pydna, the BP of `attB4`–element–`attB1r`
with a pDONR carrying `attP4` and the reverse of `attP1` puts the attL arms
on the clone at both sites, which is what we annotate; the real pDONR
P4-P1R's own arrangement was not available to check. Nothing in the order
rule depends on it.
