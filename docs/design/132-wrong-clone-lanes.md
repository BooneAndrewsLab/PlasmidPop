# 132. The wrong clones beside the right one on the check gel

Issue #361, built 2026-11-05 for 1.22.0. Check by digest (item 49) drew the
product's lane beside the empty vector's and ranked the enzymes by how well
those two differed (`compareCheck`); the check primers (item 120) handled
insert presence and orientation. The ask: predict the other common wrong
outcomes of a cloning and show them as lanes on the expected gel, rank a
digest by how well it tells the correct clone from all of them, and have
the protocol say which wrong lane a band pattern points to.

Code: `src/core/cloning/wrongClones.ts` (the molecules),
`compareCheckAll` and `checkSummary` in `src/core/analysis/gel.ts` (the
ranking), `diagnosticDigests` in `protocol.ts` and the table in
`protocolText.ts` (the protocol), `BenchProduct.tsx` (the lanes and the
legend), `LigationPanel.tsx` (which hands its fragments over),
`CloneCheckContext.wrong` and `StoredCloneCheck.wrong` (what a product
remembers).

## Which wrong clones, per method

Decided by the ends, not by a table of methods. A candidate is an order of
the same `DigestFragment`s the product was ligated from, and it is a wrong
clone when every junction of that order is one a ligase would make, by the
same `assemblyJunctions` the Ligation panel refuses an assembly with; the
molecule is then built by `ligate`, as the product is. That one rule gives
the answers the issue's open question asked for:

- **Gibson, Golden Gate and Gateway** close in one orientation only (the
  homology arms, the overhangs, the att sites direct every part), no copy
  of an insert joins another, and the vector cannot dimerise, so their only
  wrong clone is the **empty vector**: the uncut destination, which
  `emptyVector` already gave. A Golden Gate insert whose two overhangs let
  it join itself is a design fault its overhang warnings already name, not
  a lane. These reactions pass no list and get the default, the empty
  vector alone (`emptyVectorClone`).
- **Restriction ligation** (the Bench's Ligation panel, and the primer
  workspace's Simulate, item 108) gets `ligationWrongClones`: the empty
  vector; each insert turned over (`flipFragment`, the same turn
  `ligationOrientation` tries); each insert twice, head to tail (`I, I`),
  head to head (`I, flip(I)`) and tail to tail (`flip(I), I`); and the
  vector twice with no insert. The ends sort them out: a directional
  insert (two different sticky ends) has none of them, since neither its
  turned copy nor a second copy joins and the vector cannot close; a
  dephosphorylated single-cut vector has no empty clone and no dimer but
  still takes a second or a turned insert; a one-enzyme or blunt ligation
  can go wrong in every way. A vector dimer with the insert as well, and
  three inserts, are left out as the tail of a distribution the four most
  common already stand for. A candidate whose bases are the product's (a
  palindromic insert turned over) or an earlier candidate's is dropped; a
  linear product has no colonies and no wrong clones.

The head-to-head and tail-to-tail doubles are modelled because they are
real, but they make a perfect palindrome as long as the insert, which
E. coli keeps badly (SbcCD cuts long palindromes in rec+ strains), so they
are the rarest and come last. The order of `WRONG_CLONE_KINDS` — empty,
reversed, tandem, dimer, head-to-head, tail-to-tail — is how often each
turns up at the bench: the empty vector and the turned insert are the
everyday ones, a tandem comes with a high insert-to-vector ratio, a dimer
with a single-cut vector that was not dephosphorylated.

## The cap on lanes

`MAX_WRONG_LANES = 4`: the product, four wrong lanes and the ladder are six
columns, which the Bench's 360 px column still draws at a legible scale
(the `Gel` shrinks its viewBox to the column; six columns are 398 units,
0.9 px a unit). Past the cap the gel would be a smear of lane names cut to
seven characters. Since the candidates come most common first, a cap drops
the rarest: on a one-enzyme ligation the gel shows empty, reversed, tandem
and dimer and the note under it names the two inverted doubles; on a
dephosphorylated vector all four that remain fit. The cap is applied by
`wrongLanes` wherever a list is drawn or ranked against, so the ranking and
the legend describe the same lanes, and the names past it are listed.

## The ranking

`compareCheckAll` takes the product's lane and a lane per wrong clone,
all cut with the same enzyme, and orders two enzymes by:

1. how many wrong lanes the product's differs from by a band a gel
   resolves (`laneContrast` at least `resolution`): more is better, so an
   enzyme that tells three of four apart beats one that tells two, whatever
   its own lane looks like;
2. among the lanes told apart, the weakest difference, wider first, capped
   at `plenty`: a check is as good as its least clear lane. When none is
   told apart, the widest of the narrow differences still orders them, as
   `compareCheck` always did;
3. that lane's differing band, brighter first, capped at `bright`;
4. then the product's lane by `compareDiagnostic`.

With one wrong lane this is `compareCheck` rule for rule, and `compareCheck`
is now written as that call, so the tests of item 49 verify the
equivalence. An enzyme that misses a wrong circle leaves it uncut, which
runs supercoiled and is not a lane, so it counts as not told apart, as
item 49 decided for the empty vector. The Bench option reads "tells all
apart" or "same as empty, reverse"; the legend under the gel says, for each
wrong lane, what it is, its bands or that it is uncut, "same as the
product" where the enzyme misses it, and "same as X" where two wrong lanes
cannot be told from each other, which is the case a gel read by size has to
know about.

## The protocol

`buildProtocol` takes `wrongClones`; `diagnosticDigests` then digests each
wrong molecule with every candidate enzyme, ranks by `compareCheckAll`, and
each `DiagnosticDigest` carries a `WrongLane` per clone (label, name,
profile, whether apart). The page's table gets a column per wrong clone
after the product's, "uncut" for a circle the enzyme misses and "(same as
the product)" where it cannot tell the two, then a list of what each clone
is: a lane that matches a column is that clone. Without wrong clones the
table and its caveat are as before, so a protocol from a record alone does
not change.

Where the list comes from: the Bench's `ProtocolDialog` is given the lanes
the product column drew. A product assembled with **Design check
primers…** registers them in its `CloneCheckContext.wrong` (the capped
list, so a stored row holds at most four extra circles as name and bases),
`storedCloneCheck` writes them with the row and `restoreStoredCloneCheck`
puts them back, rows from before the field restoring with none; the
History tab's dialog recalls them by checksum, so the page it downloads
ranks against the same lanes the Bench showed. A product edited since has
no context and so no columns, as item 120 decided for the colony PCR.

## Rendering

The gel stays the SVG `Gel` (item 30's lanes are rectangles, not the
sequence view); nothing new is drawn on a canvas. The wrong lanes go
left of the product's, since the last lane is the one the gel writes sizes
beside, and an uncut circle is not a lane.

## Tests

`wrongClones.test.ts`: the kinds and their order on a one-enzyme ligation,
each molecule's bases equal to the one sliced by hand from the two sources
by the cut positions alone (the turned insert as the reverse complement of
the bottom strand's window), each EcoRI digest equal to the hand-built
molecule's and to the lane the Bench draws, the lengths each kind implies,
the two inverted doubles and the tandem distinct in an EcoRI digest, the
cap and the names past it; a dephosphorylated vector, a directional insert
(none), a blunt ligation (all), a palindromic insert, a linear product, the
vector not first on the shelf, two inserts named apart; `diagnosticDigests`
giving every wrong lane that molecule's own digest and ranking by lanes
told apart; and a fast-check property over random vectors, inserts, sites
and dephosphorylation that every wrong clone is a circle, never the
product, in the kinds' order and of the length its kind implies.
`gel.test.ts`: `compareCheckAll` equal in sign to `compareCheck` on every
pair of eight lane sets, more told apart wins, the weakest difference and
its band decide ties, an uncut lane is not told apart, `checkSummary`.
`BenchProduct.test.tsx`: the four lanes and the note naming the rest, the
option text, the legend's "same as the product", a dephosphorylated
vector's four. `protocolText.test.ts`: the columns, the marks and the list.
`ProtocolDialog.test.tsx`: the lanes given, recalled from the context, or
none. `cloneCheck.persistence.test.ts`: the stored form's round trip, a
row from before, a damaged row.
