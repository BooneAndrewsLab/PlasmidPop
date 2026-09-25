# 56. A primer collection, and finding where its primers bind

Done, 2026-09-25 (#64; `src/core/primers/collection.ts`,
`src/app/state/primerCollection.ts`, `src/app/components/PrimerCollection.tsx`).
The issue asked for a list of primers (name, sequence, notes) kept in the
browser beside the recent files. Primers can be added from a design, from a
`primer_bind` feature, or by pasting many (CSV, FASTA or a column of
sequences), and exported the same ways. **Find my primers** on the open
document finds every primer that binds, with an exact 3′ end, a few
mismatches, both strands and through the origin. The sites show as primer
sites and can be picked as PCR primers. Like the documents, the list leaves
the browser only as a download.

## One matcher, PCR's

There were already two binding searches: `findPrimerBindingSites` (the
whole oligo must match, used by design and **Check a primer**) and
`findAnnealingSites` (the 3′ part anneals and the rest is a tail, used by
PCR). The collection uses the second. A lab's list is mostly cloning and
sequencing primers, and a cloning primer's 5′ tail matches the template
nowhere, so a whole-oligo search would miss the primers most worth finding.
A site found here is therefore exactly a site PCR would anneal, so handing
it to PCR gives the product it promises. The rules are PCR's too: the last
five bases exact, a mismatch past them counted against the limit (0–3,
default 2), at least 15 annealed bases, IUPAC codes pairing with what they
stand for. `findCollectionPrimers` only runs it per primer, tags each site
with the primer's id and name, and reports the primers too short to search.

With mismatches allowed, the annealed part reaches into a tail for as long
as the tail happens to pair. That is what the walk has always done, and it
is right: those bases do pair. The tests pin it rather than work around it.

## An index, because a list is hundreds of primers

The walk tries every base of the template on both strands, once per
primer. For one or two primers that is nothing. For 500 primers against a
10 kb plasmid it was 3.2 s (`collection.timing.test.ts`). `buildAnnealIndex`
lists the template's 5-mers once (a counting sort into 1,024 buckets). Each
primer is then tried only where its exact 3′ anchor stands. A degenerate
anchor looks up each word of its mix, and windows holding an N or a code are
kept aside and always tried. The result is 160 ms for 500 primers against
10 kb and 610 ms against 200 kb. The index narrows where the walk runs and
changes nothing it finds. A randomized test compares the two over messy
templates, degenerate primers and every setting that changes a site. The
search runs in the analysis worker (`findPrimers`), as the other scans do.
PCR still walks, since two primers gain nothing from an index.

## Stored a row per primer

Database version 7 adds a `primers` table, one row per primer, indexed by
when it was added, which is the order it is listed in. Adding or editing a
primer writes that row only, and an edit keeps its row's `addedAt` so it
does not move. Rows are checked on the way in, as the shelf's are, so a bad
row costs that primer and not the list. The list lives in a small store of
its own (`primerCollection`), not in the editor store. It belongs to no
document, only the Primers tab reads it, and every change to it is a write
to IndexedDB, which the editor store stays free of. It is read the first
time the tab is shown, so a session that never opens it never reads it.

Adding leaves out a primer with the same name and the same bases as one
already kept, so pasting a list twice adds nothing. The same bases under
another name are kept, because labs order one oligo twice and which name is
right is not the app's to decide.

## Reading and writing lists

`parsePrimerList` takes the shape from the text itself. A first line
starting with `>` means FASTA. If every record has a tab, comma or
semicolon outside quotes, the text is a table; quoted cells may hold
delimiters and line breaks. Anything else is read as lines. A table's
header is followed when it names a sequence column. Without a header, the
cell that is bases (at least 8, IUPAC only, `5′-…-3′` and spaces allowed) is
the sequence, the first other cell the name and the rest the notes. A name
such as `GAPDH-F` or `M13F` is never bases. The report names the lines that
held no primer.

CSV is the lossless export, `name,sequence,notes`, and reads back exactly.
FASTA ends a name at its first space, so spaces become underscores there.

From a `primer_bind` feature, the oligo is the `sequence:` note that the
Primers tab and SnapGene write (or the `PCR primer:` note on a product's
primers), because only the note holds a tail. Without one, it is the bases
under the feature read along its strand.

## Sites are a preview, features an edit

What Find shows is a preview (a new owner, `collection`), like a designed
pair. Nothing is in the document until **Add** makes a `primer_bind`
feature, with the whole oligo in a `sequence:` note so it round-trips back
into the list. **Add all** is one undo step: each feature after the first
coalesces into the step before it under a key made for that click. The
search runs again on every edit, so the list follows the document. At most
200 sites are listed and drawn.

## Handing a primer to PCR

The PCR panel keeps its boxes per document in `panelMemory`, and it is not
mounted while the Primers tab is. So **PCR fwd** and **PCR rev** write the
primer into that memory (`rememberPanel`), with its name in a new
per-slot name, and set the template back to the document in front. PCR
shows the name beside the box, on the sites and on the product's primer
features, and drops it when the bases are edited by hand, since an edited
oligo is no longer that primer. The Primers tab does not switch tabs on
each pick; a line says what PCR holds and **Open PCR** goes there.

## Not done

- Short primers (under 15 bases) are reported, not searched; a lower
  minimum for them is a setting nobody has asked for yet.
- No sharing of a list between browsers other than the files.
- If another branch also adds a database version 7, the two need
  renumbering when merged.
