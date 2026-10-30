# 120. Check primers for a clone

Issue #311, built 2026-10-29 for 1.20.0. The Primers tab designed a pair
around a region, cloning mode and the Golden Gate mode (item 113) designed
the insert's own primers, and the Bench's Check by digest (item 49)
screened a clone by restriction digest; nothing designed the primers a
colony is screened with before a miniprep. The scope was widened by the
maintainer on 2026-10-28 from "part of the Golden Gate design" to every
cloning method whose product needs confirmation primers, reached from any
product Simulate or Assemble opens and from the Bench result.

Code: `src/core/cloning/checkPrimers.ts` (the engine),
`src/app/cloneCheck.ts` (what a reaction tells the page about its product),
`src/app/components/cloneCheck.ts` and `CloneCheckPage.tsx` (the workspace
page), the `checkPrimers` request of the analysis worker.

## What a check pair is

Two kinds, and a third way of getting one:

- **Across a junction.** One primer on the vector, the other in the insert,
  pointing at each other over the join. The band exists only when the
  insert is there, and only in the orientation that puts that junction
  there: a pair across the left junction of a clone with its insert turned
  round has its insert primer on the wrong strand, pointing away. One set
  is designed per junction, so a product of several parts (a four-part
  Golden Gate, a two-insert Gibson) gets a pair across each join between
  its parts as well as across the two with the vector.
- **Flanking the insert.** Both primers on the vector, either side. One size
  with the insert, another without it (the empty vector's), the same either
  way round: presence and size, not orientation. The empty vector of a
  Golden Gate or Gateway is the uncut destination with its dropout, so the
  flank pair's empty band is the dropout's size, not nothing.
- **Reusing a primer.** The insert's own forward or reverse primer from the
  cloning design, a primer from the product's record (every PCR and
  mutagenesis step of its lineage), or one of My primers: the engine finds
  where it anneals (`findAnnealingSites`, tails allowed for), takes the
  first junction past its 3′ end, and designs only the counterpart beyond
  it. The pair then spans that junction. The counterpart's Tm range is
  centred on the reused primer's annealing Tm, not the settings', because
  a pair cycles at one temperature and the reused primer is what it is.

## The engine

`locateInsert(product, vector, parts)` finds the insert without being told
the method: the vector is the longest stretch the product shares with the
vector molecule (`longestSharedStretch`: 12-mer anchors, left-maximal
extension, both strands, through either origin), the insert is the rest of
the circle, and each other part's stretch gives the junction between
neighbours as the middle of their overlap or gap — the four shared bases
of a Golden Gate join, the arm of a Gibson join. The same function serves
a ligation (the backbone fragment is a stretch of the plasmid), a Golden
Gate (the destination less its dropout and sites), a Gibson (the whole
linearised vector, arms included), a Gateway LR (the destination less its
ccdB cassette) and a product the primer workspace simulated. A regenerated
site at a ligation junction is shared by both sides, so the located insert
is a few bases short of the fragment: nothing turns on it, the junction
only has to be within the room kept from it (`minDistance`, 50 bp). A
stretch under 50 bases is not a vector (two 20 kb molecules share a
14-mer by chance); a part may be 24 (a tag is thirty bases).

`designCheckPrimers` enumerates every stretch of each window as a primer by
the designer's own rules — `analyzePrimer` and `candidatePenalty`, exported
for this — after the cheap ones (GC, homopolymer, Tm) have refused most,
pairs them within the size window (tails counted) and the Tm difference,
then walks the pairs best first running the dear checks, the 3′ dimer and
`findPrimerBindingSites` on the product, until five are kept or none later
can beat them. Windows start 218 bp from the junction and double only
while fewer than five pairs come out: a colony band is best small, and a
1 kb window either side is ten thousand candidates. A pairing may spend
sixty scans before it gives up, which is what a tandem repeat near a
junction would otherwise cost seconds for; the notes say when that
happened. `docs/perf-notes.md` has the measurements (0.5 s at 3.5 kb, 1.5 s
at 20 kb in Node), which is why the request runs in the analysis worker.

The bands are `pcr`'s, not the arithmetic's: each kept pair is run on the
clone, on the empty vector when there is one, and on `flipInsert(product)`
— the product with the insert's bases reverse-complemented in place — when
the orientation is open. A junction pair that amplifies the empty vector,
or whose turned-clone band a gel could not tell from the clone's (ratio
under 1.15, the gel module's resolution), and a flank pair whose empty
band is the clone's size, keep their rows with the problem named. The
tests assert that every band equals the stretch of the product between
the pair's sites (plus a reused tail), that the pairs designed on the
clone give nothing on the Bench's own reverse ligation, and that a product
numbered from inside its insert designs the same pairs.

## Per method

The page needs what the engine cannot see: which molecule is the vector,
what the empty vector is, whether the orientation is open, and which
primers may be reused. A reaction registers these for its product
(`registerCloneCheck`, by checksum, for the session) when it opens it on
the page; the product's own tab then finds them (`recallCloneCheck`), and
the slim Primers panel offers **Check a clone ›**.

| Method                                 | Vector                         | Empty vector                                     | Orientation                                                    | Reuse                      |
| -------------------------------------- | ------------------------------ | ------------------------------------------------ | -------------------------------------------------------------- | -------------------------- |
| Ligation (Bench)                       | the longest part               | `emptyVector` of its fragment: closed, or none   | `ligationOrientation`: open iff some insert turned still joins | the record's PCR primers   |
| Cloning mode Simulate (item 108)       | the plasmid in front           | the backbone cut with the pair's enzymes, closed | the same rule on the backbone and the cut amplicon             | the two cloning oligos     |
| Golden Gate (Bench), Golden Gate part  | the longest circular part      | the uncut destination                            | fixed by the overhangs                                         | the two oligos (part mode) |
| Modular (item 76)                      | the longest circular part      | the uncut destination                            | fixed by the overhangs                                         | the record's               |
| Gibson (Bench)                         | the longest part               | closed if it can; a PCR vector has none          | fixed by the homology arms                                     | the record's               |
| In-Fusion, NEBuilder (item 79's panel) | the vector tab                 | the uncut vector                                 | fixed by the homology arms                                     | the two insert primers     |
| Gateway (Bench)                        | the destination (or donor) tab | the uncut vector, cassette and all               | fixed by the att sites                                         | the record's               |
| Overlap PCR (item 79)                  | none: the fusion is the insert | none, said so                                    | fixed by the overlaps                                          | the design's primers       |

The Bench's four reactions put the button under the product's map
(`BenchProduct`'s `onCheckPrimers`, there only when the tube goes
together); Modular, the In-Fusion designer and Overlap PCR put **Check
primers…** beside their open button, since their products are not drawn
in the Bench's column. Overlap PCR is the odd one: `fusionContext` makes
the whole linear molecule the insert and `partJunctions` (the inner part
of `locateInsert`, exported) finds a junction at each join, so the engine's
junction pairs confirm each fusion and its flank pair is refused as
reaching both ends.

`ligationOrientation` turns each non-vector part over in turn and asks
`assemblyJunctions` whether every join is still compatible: one enzyme at
both ends and blunt ends leave it open, two different sticky ends fix it.
The empty vector is the same molecule Check by digest ranks against (item
49's `emptyVector`): a cut vector that cannot close (two enzymes,
dephosphorylated) or a PCR product with no phosphates has none, and the
page says which rather than guessing; the pairs are then checked on the
product alone and the empty column reads n/a.

**Not covered, by decision.** Mutagenesis has no junction: a point
mutation is confirmed by sequencing, and a pair across nothing would only
mislead, so its panel registers no context. A plain PCR product is not a
clone until it is ligated, and the ligation registers. A product edited
since it was made has no context (the registry is by checksum; a reopened
product gets its context back from its stored row, #327, below): the page
then says so and takes the selection as the
insert and any open circular tab as the empty vector, which is also how it
works on a plasmid made elsewhere. The Bench's **Against** picker is
consulted by the Ligation panel (#329): the button hands the picker's
choice to the panel, which uses that part as the vector, and so as the
source of the empty vector, and falls back to the longest part only when
none was chosen (Gibson, Golden Gate and Gateway still take the longest;
their picker is not wired in). The context carries the vector's name and
whether it was chosen, and the page's Vector line says which. Before the
fix the geometry and the empty lane described the longest part even when
the digest above was checked against another.

**The protocol** (item 78) lists the page's design when the document has
one: the best pair across each junction and the best flanking one
(`protocolChecks`, pairs with a problem left out), with the three bands,
under its own heading after the diagnostic digest, and their oligos among
those to order. `ProtocolDialog` reads the record the page remembered
for the tab (`recallCloneCheckRecord`); a Bench preview has no tab and so
no checks.

## The page

A fifth rail page, **Clone check**, beside Check (item 107's workspace).
Product, insert, empty vector and orientation on four lines; a Reuse
select grouped by where a primer comes from; the size window and the
distance from the junction; the shared primer settings; one button. The
results are a table (what the pair spans; both primers; the clone, empty
and flipped bands, — for none) and the selected pair's detail with the
three bands, the problems, the actions the Results page has plus **Use in
PCR** on this product, and a gel of the three lanes (`Gel`, the shared
agarose and ladder). Selecting a pair draws its sites and band on the map
with the insert as a bracket. The design is remembered per document while
the bases stay, as the Results page's is.

## Validation

Cross-checked against the pinned oracle venv (`.venv-oracle`: Biopython
1.85, primer3-py 2.2.0) with an ad-hoc script, not a committed JSON: the Tm
of each designed primer against `primer3.calc_tm` at the app's conditions
(500 nM oligo, 50 mM Na⁺, SantaLucia 1998) and the band sizes against the
textbook product (forward primer, the template between, the reverse
complement of the reverse primer) built by string slicing in Python, with
the 3′ anchor rule the PCR oracle uses. Run 2026-10-29 on the one-enzyme
ligation (both primers designed, and the insert's tailed forward primer
reused) and the four-part Golden Gate, 40 pairs in all: 75 designed
primers within 0.000 °C of `primer3.calc_tm` (santalucia, 50 mM Na⁺,
500 nM; Biopython's `Tm_NN` with `DNA_NN3` and `saltcorr=6` is up to
2.6 °C away, as the thermo oracle already records), and all 100 band sets
(clone, empty vector, turned clone) equal to the slices, including the
tail of the reused primer and the empty lanes.

## Tests

`checkPrimers.test.ts`: the shared stretch on both strands and through
either origin; the insert located on the ligation tutorial's directional
and one-enzyme products, the four-part Golden Gate (three inner junctions),
the two-insert Gibson and the Gateway LR clone, and refused when the vector
is nowhere, everywhere or mid-way along a linear product; `flipInsert`
twice is the original and over the origin is the same circle; the design on
the directional ligation (kinds, best first, the band is the slice, the
room from the junction, specificity, determinism, the size window, the
product rotated into its insert), the one-enzyme ligation (junction pairs
silent on the empty vector and on the reverse ligation, flank pairs the
empty band plus 801), reuse (the insert's forward and reverse primers, a
tailed one, a vector primer pointing in, a window too small, a primer that
does not anneal), the multi-part builds and the edge cases (ambiguity
codes, a linear product, an "empty vector" that is the clone itself).
`cloneCheck.test.ts`: the registry, `ligationOrientation`, both context
builders and the lineage's primers. `CloneCheckPage.test.tsx`: the page
with a registered context (the lines, the design, the kinds, the lanes,
the flank band arithmetic), reusing the reaction's primer, the rail's
count, and without a context (the selection and a chosen tab).
`BenchProduct.test.tsx`: the button is there only where the panel can
assemble. `analysisClient.test.ts`: the request inline.

## Keeping the context with the document (#327)

Chosen by the maintainer 2026-10-30 from three options. The context could
not ride in a GenBank comment as 'Made from' and base styles do: there is
one `writeGenBank`, used for storage, the autosave worker, the urgent
flush, downloads, file-handle writes and share links, so a comment would
be in every file the user sends, and `empty` is a whole vector.

**What was built.** A sidecar field on the IndexedDB row,
`StoredDocument.cloneCheck` (`StoredCloneCheck` in `storage/db.ts`): the
product's checksum, method, insert range, junction positions, orientation
and its note, the empty vector's note, the vector's name and whether it
was chosen, the reuse primers, and the empty vector as name and bases
(not a GenBank text; the designer reads only its sequence, so features
would be dead weight). Not indexed, so no Dexie version; rows from before
have none and load as before.

- **Write.** `PersistenceService.writeDocument` passes
  `storedCloneCheck(doc, recallCloneCheck(doc))` in the provenance of
  `repo.write`, which both the autosave (text from the save worker, the
  field is plain data built on the main thread) and the urgent flush
  reach. `documentRow` keeps it only while its checksum is the document's
  own, so a context an edit has outdated is never written. The
  localStorage stash of the flush holds text only and deliberately skips
  it; on a reload that prefers the stash, the stored row's field is read
  and matched by checksum like any other.
- **Read.** `repo.load` returns it; `reopen` calls
  `restoreStoredCloneCheck`, which validates the shape (a damaged backup
  is ignored) and registers it under the checksum it was made for. The
  registry is the same one the reactions use, so the page and the Primers
  tab need no change to find it.
- **Stale.** The checksum is the whole test. An edit anywhere changes it,
  so `recallCloneCheck` finds nothing and the next autosave writes the row
  without the field (dropped, not recomputed: the geometry cannot be
  re-derived without the parts). Undoing the edit restores the checksum
  and the session registry still has the context, so it is written again.
- **Backup.** Rows go out as stored, so a backup carries it and a restore
  puts it back; it is plain JSON.
- **Leaves the browser.** Only in a backup the user makes. Downloads, the
  SnapGene writer, parts files and share links are built from the
  document alone and never see it; a test compares a GenBank text and a
  share payload before and after registering a context.
- **The page** says, whenever `recallCloneCheck` is null, "No cloning
  context is kept for this document, so the selection is the insert", in a
  Context line under Insert; it is absent when a context is in force.

Tests: `cloneCheck.persistence.test.ts` (stored form and its round trip,
an edit inside the insert finds nothing, repository save and load, a row
from before the field, the text of a row unchanged by it, download and
share link identical, backup round trip, autosave then reopen through
`PersistenceService`, the urgent flush, an edit then autosave drops it),
and the page test for the message.
