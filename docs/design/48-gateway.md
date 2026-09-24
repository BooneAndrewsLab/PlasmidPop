# 48. Gateway cloning

Done, 2026-09-23 (#62; `src/core/cloning/gateway.ts`, the Cloning tab's
**Gateway**). BP and LR, the two recombinations of the lambda integrase
system that Invitrogen's kits are built on.

- **No att sequences are bundled, and none are guessed.** The obvious
  design was a table of attB/attP/attL/attR variants to match by sequence.
  It was not built, for two reasons. The sequences would have had to come
  from somewhere — a vendor's plasmid files are licensed and not ours to
  copy, and typing them out from memory is how silently wrong science gets
  shipped — and they are not needed: every real donor, entry and
  destination vector _annotates its own att sites_, and a GenBank or
  SnapGene file of one carries those labels. So `attSites` reads the
  document's own features (`/^att([BPLR])(\d+r?)$/`, which covers `attP2r`
  and the multisite numbers) and nothing else. A plasmid that labels
  nothing is told so, with what to do about it. Finding an unlabelled site
  by sequence is feature detection and belongs with #60, whose own open
  question is this same licence one.
- **The crossover point comes from the two molecules.** Partner sites
  recombine within a core they share, so the longest common substring of
  the two annotated sites _is_ that core (`sharedCore`, at least 7 bases),
  and crossing over in its middle gives both recombinant sites their right
  sequence without a table to consult. A site annotated on the other strand
  is compared reverse-complemented. This also checks the labels: two sites
  that claim to be partners but share no core would not recombine, and that
  is said rather than assumed.
- **Which circle is the clone is decided by ccdB, not by geometry.** Both
  circles are made either way — that is what a crossover does — but which
  one is wanted is a matter of selection, and the cassette goes to the
  byproduct. Deciding it by position fails as soon as a recombinant site
  wraps the origin, which an entry clone's `attL1` routinely does: sorting
  the sites by position then puts them in the wrong order and the two
  circles come out swapped. Caught by the BP → LR round-trip test, not by
  reading.
- **The recombinant sites are annotated fresh.** Each parent site is cut in
  half by the crossover, so carrying the parents' features over would leave
  two half-features with the old names on either side of every junction.
  The halves' att features are dropped and one `protein_bind` feature is
  added across each junction, under the name the reaction gives it
  (`attL1` for a BP's entry clone), keeping the number, which is what pairs.
- **A vector on the other strand is turned over first.** Where both of a
  vector's sites lie on the opposite strand from their partners, the
  crossover joins the insert's top strand to the vector's bottom one, so
  the vector's pieces belong in the product reverse-complemented. The
  first version compared the cores reverse-complemented but then joined
  the vector's forward-strand pieces, which made a wrong molecule of the
  wrong length; `gateway.property.test.ts`, checking against an oracle
  that swaps arms as plain strings, caught it. The whole vector is now
  reverse-complemented before the crossover, and one pair opposed with
  the other not (an inversion, not an exchange) is refused.
- **A linear attB substrate** gives a clone and no byproduct: its flanks
  come away as loose ends rather than as a circle.
- **The frame warning** is the one the bench actually needs: an att site is
  not a multiple of three, so an N- or C-terminal fusion through one is in
  frame only by design. Each att site in the product is measured from the
  nearest CDS ending before it to the nearest starting after it, round the
  circle, and a gap that is not a multiple of three is reported. The first
  fixture written for it was accidentally in frame (a 47-base site plus one
  spacer base is 48), which the test caught.
- **Tested by running it both ways**: a BP whose entry clone then goes
  through an LR, with the gene arriving whole in the expression clone and
  ccdB on each byproduct. The att sites in the fixtures are invented — two
  arms around a core — because what is being tested is the crossover, and
  the crossover needs only that partners share a core.
- Not yet: multisite LR in one pass (two sites at a time now, so a
  three-fragment assembly takes several); recognising att sites by sequence
  (#60); the PCR panel annotating an attB tail so a product is a BP
  substrate in one step.
