# 73. A piece of a feature remembers what it was cut from (#182)

**Asked:** the fifth correctness audit found that since #174 a feature a
cut runs through becomes partial pieces with no link to the feature they
came from. Two things went wrong because of it:

- A `/transl_except` whose codon the cut split belongs to neither piece
  (#179 drops it), and #181's rejoin could not bring it back: a
  selenoprotein cut by EcoRI inside its TGA and closed again read `MK*IPG*`
  instead of `MKUIPG*` (F1). `/anticodon` the same.
- #181 rejoined by what pieces looked like (name, qualifiers, partial
  marks, CDS frame), so it joined pieces across a junction that had lost
  bases (an in-frame dropout, a chewed-back or filled-in end), joined
  same-named pieces from two plasmids (F2), and missed a `join` cut in its
  intron, whose pieces do not touch at the junction (F4).

**Decided: each piece carries a record of the original feature
(`Feature.origin`, `FeatureOrigin` in `features/feature.ts`), and ligation
joins pieces back only when they meet again exactly as they were cut. The
#181 heuristic (`rejoinAtJunctions`) is gone.**

## The record

- `key`: the original's id, the same on every piece of it, so pieces from
  the different fragments of one digest find each other and pieces of two
  plasmids' look-alike features never do.
- `whole`: the original itself, laid out on its own — forward strand,
  base 0 its first base of reading, located qualifiers moved with it — in
  a linear space of `span` bases. Read 5′ to 3′, the record is the same
  whichever way a fragment is later turned (`flipFragment`, a document's
  reverse complement) and wherever it lands, so nothing has to update it.
- `from`, `to`: which of the original's bases the piece holds, counted
  along its own bases from the 5′ end.
- `gaps`: a hash (FNV-1a, case folded) of the bases of each intron, so two
  pieces cut apart in an intron join back only across the same bases.

`extractRange` (every digest, copy and cloning product) gives the record
to every feature it clips, whether into one piece or several. A piece cut
again passes on its own record with `from`/`to` narrowed, so every piece
names the first feature cut. A feature that has a record but no longer
matches it (an edit added or took bases since) is taken as a feature in
its own right. A feature with a site segment, or a `join` that cannot be
laid out at all, gets no record and is never joined back. A `join` that
steps back on a linear molecule (`join(88..93,4..14)`) is laid out with
its own space starting at its lowest base.

## Joining back (`rejoinPieces`, `document/featureOrigin.ts`)

Two pieces of one key join when the second holds the original's bases
just after the first's, both lie where _one_ placement of the original on
the product puts them (the placement is read from each piece's 5′ base,
and the piece must then be exactly its share of the original: same bases
covered, no more, no fewer), on the same strand, and, when the boundary
between them is an intron of the original, the product's bases there hash
to the intron's. Same placement is what rules out a lost or gained base
anywhere between them; the hash rules out an intron of the right length
but other bases. A piece whose type, name, joining or shared qualifiers
were edited since its cut is not joined either.

A chain of pieces that adds up to the whole original gives the original
back: its own segments and partial marks, `/translation`, `/transl_except`
and `/anticodon` placed on the product, a fresh id, no record. A chain
that adds up to less gives one larger piece cut the same way the original
would have been cut there (cut sides partial, `/translation` dropped, a
CDS read from its first whole codon), keeping a record for later. Pieces
that do not meet stay as they are.

Only `ligate` (and so `emptyVector`, the shelf's assembly and closing a
fragment) joins pieces back, as #181 did. Golden Gate, Gibson and Gateway
products carry the records but do not read them.

## Where the record goes, and does not

- **In memory**, on documents, digest fragments and the shelf: yes. The
  shelf is stored by structured clone, so a part's records survive a
  reload.
- **GenBank: not written.** It is bookkeeping about a cut on the bench,
  not about the molecule, has no INSDC qualifier, and would show up in
  every other tool as an unexplained `/note`-like qualifier. A record
  only means something next to its sibling pieces, which a file of one
  fragment does not hold. A fragment saved and reopened (or a document
  restored from storage, which is kept as GenBank) has partial pieces
  with no record; they stay apart, which is the honest pre-#181 result
  rather than a wrong join.
- **Clipboard JSON and stored undo history: not written**, for the same
  reason and because their readers rebuild features field by field.
- **CRDT:** the record is immutable plain data on the feature, replaced
  wholesale, never edited in place, like the feature's qualifiers.

## Checked

The round-5 probes after the change: the F1 repro and its reverse-strand
twin give `MKUIPG*` back with its `/transl_except`; F2's dropout and the
trimmed/filled KpnI end leave two partial pieces; the restore sweep (400
real-enzyme single and double cuts, religated in order and swapped,
partial digests, Gibson) has 0 problems (260 before, all two-cut
religations of a `join` cut in its intron); the random
cut/flip/ligate sweep against the Biopython base-identity oracle (circular,
two-source, tandem and linear sources) has no false rejoin, no missed
rejoin and no lost `/transl_except`. Regression tests:
`cloning/ligate.provenance.test.ts`, `document/featureOrigin.test.ts`.
