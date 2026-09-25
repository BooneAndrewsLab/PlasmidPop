# 52. What a product was made from

Done, 2026-09-24 (#67; `src/core/lineage/`, `src/io/genbank/madeFromComment.ts`,
`src/app/components/MadeFrom.tsx`). SnapGene keeps a construct's history, as
a tree of the files and operations that made it. Here a product opened as a
new document and the link to its parts was lost as soon as it did. Asked for:
record on each simulated product the operation, its settings and the parents'
names and SEGUIDs; show it as a tree whose nodes open the version they name
where the browser still holds it; and keep it through a save.

## The model

`LineageNode` (in `DocumentMetadata.lineage`) is a molecule: name, checksum
(`documentChecksum`'s full text, or null for an empty one), topology, length,
and `step: LineageStep | null`. `LineageStep` is a discriminated union, one
kind per reaction, each with `parents: LineageNode[]`:

| op            | parents | settings                                                     |
| ------------- | ------- | ------------------------------------------------------------ |
| `digest`      | 1       | end enzymes, range in the parent (0-based, unrolled), uncut  |
| `pcr`         | 1       | forward and reverse primer (name, bases), polymerase         |
| `ligation`    | ≥ 1     | circular, `flipped` per parent                               |
| `golden-gate` | ≥ 1     | enzymes (one or two), `flipped` per parent                   |
| `gibson`      | ≥ 1     | kit (Gibson, In-Fusion, NEBuilder), circular, overlap, flips |
| `gateway`     | 2       | BP or LR, and whether it is the byproduct                    |
| `mutagenesis` | 1       | the change as labelled, the design method, both primers      |
| `phosphates`  | 1       | removed (phosphatase) or put on (kinase), on a shelf part    |
| `edited`      | 1       | none: the parent is the product as it was made               |
| `elided`      | 0       | how many molecules were left out below                       |

- **The whole tree, not one level.** A parent carries its own lineage, so a
  plasmid ligated from a fragment of a PCR product names the PCR's template.
  One level would have made the tree only as deep as the documents still
  open, and a file two steps back is exactly what gets closed and deleted.
- **No sequences.** A checksum tells whether a molecule in front of you is
  the one a step used, and is 36 characters where the molecule may be 10 kb.
  The tree is metadata about the molecule. It is not a second copy of every
  ancestor.
- **The root is the product as made**, with its checksum then. Edits leave
  `lineage` alone: the tree says what the product was made from, and the
  document's own history (items 5 and 51) says what happened since. So the
  root's checksum and the document's disagree after an edit, which is how
  the view says **edited since**. It costs no bookkeeping in the editor.
- **An edited product used again is a molecule of its own.** `lineageOf(doc)`,
  which every recorder uses for a parent, gives an `edited` node carrying the
  document's checksum now, with the recorded lineage beneath it. The tree
  then says what really went into the tube. Taking the old lineage as the
  parent would name a molecule that was never used.
- **Blunting is not a step.** It is an edit of a document (`bluntEnds`, item
  10), so it is in the History and makes the product read as edited. A
  dephosphorylation is different: it happens to a shelf part, which has no
  history, so it is a `phosphates` step, and taking it back removes the step
  rather than adding the opposite one. Flipping a part changes nothing: the
  checksum is double-stranded, so it is the same molecule either way.
- **Extracting a stretch drops the lineage** (`extractRange`). A stretch of a
  product is not the molecule the tree describes, and extracting is not a
  reaction.
- **Limits: 64 molecules and 24 levels** (`pruneLineage`). The tree is walked
  breadth first, and a step is kept whole or not at all, since half of a
  ligation's parents would be a false account of it. A step that does not
  fit becomes `elided`, counting what it stood for, and the molecule it made
  keeps its name and checksum. A construct made in five rounds of two-part
  cloning, each insert a PCR product, is 26 molecules and a 3.3 KB block. The
  worst case, 64 PCR products with 60-base primers and long names, is 19 KB
  (23 KB of GenBank with the indentation). A share link compresses that to
  about 1 KB more link, or 0.6 KB for the typical tree. Every recording
  prunes, so a tree built from pruned parents stays bounded.

## Where it is recorded

At the moment a result becomes something kept, never inside the reactions:
the panels run `digest`, `goldenGate` and `gibson` on every render to
describe what they would make, and a checksum of every part (about 1 ms per
plasmid, `docs/perf-notes.md`) each time would be paid for nothing.
`src/core/lineage/record.ts` has one function per reaction, each taking the
result and what went into it:

- `fragmentWithLineage` where the digest list shelves or opens a fragment
  (**Add**, a click on the view, **Open**). `DigestFragment.lineage` carries it
  on the shelf and into IndexedDB. `documentFromFragment` gives it to the
  document it makes, under that document's name, and so to the tube's shelf
  ingredients too.
- `recordPcr` for **Open**, and `fragmentOfDocument` for **Shelve**, which
  shelves the recorded product whole.
- `recordLigation` takes the ticked shelf parts in order, with their flips.
  A part shelved before this build has no lineage and stands in as a leaf
  under its name and checksum (`fragmentLineage`).
- `recordGoldenGate`: `AssembledPart` gained `document`, the tube document
  each piece was cut from, since `fragment.source` is a name and two tabs can
  share one. The parents are those documents, each once, in the order the
  pieces join.
- `recordGibson`, `recordGateway` (clone or byproduct), and
  `recordOverlapDesign`, which records the In-Fusion or NEBuilder product as
  the vector and a PCR product of the template, so the template is two
  levels down.
- `recordMutagenesis`. The mutant opens as the template renamed, and the
  design's edit is the tab's first step (item 47), so the lineage is the
  mutant's. After the edit the document is the molecule as made. Undo it and
  it reads as edited since, which is true.
- `withPhosphates` in the store's `setShelfPartDephosphorylated`.

## Keeping it through a save

GenBank has no field for it, so it is one COMMENT block of ours, written by
`writeGenBank` after the other own lines and read by the parser like them
(`ownComments.ts`). A block that cannot be read back whole is kept as an
ordinary comment both ways, rather than dropped or half read (#72):

    PlasmidPop-made-from: 1
    0 ligation cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 3426 circular
    + pUC19+GFP%20assembly circular=yes flipped=01
    1 digest ldseguid=dmS9Y4eutZMCbPaGkq0blFgh8RU 2665 linear
    + pUC19%20EcoRI-BamHI%20fragment enzymes=EcoRI,BamHI
    + range=2661..2639
    2 - cdseguid=AAAAAAAAAAAAAAAAAAAAAAAAAAA 2686 circular pUC19
    1 pcr - 761 linear GFP%20PCR
    + forward=GFP%20fwd%2C%205%E2%80%B2%20EcoRI,GGAATTCATGGTGAGCAAGGGCGAGGAG
    + reverse=GFP%20rev,CGGGATCCTTACTTGTACAGCTCGTCCATG
    + polymerase=proofreading
    2 - cdseguid=dUxN7YQyVInv3oDcvz8ByupL44A 4733 circular pEGFP-N1

- **A line per molecule, in pre-order with its depth,** rather than one
  JSON line. The block reads as a tree to someone looking at the file in
  another program, a file diff shows which molecule changed, and a line
  breaks at GenBank's 79 columns (`+` continues a line; only one long token,
  a long primer, runs over, as the writer lets a long word do). Positional
  fields first (depth, op or `-`, checksum or `-`, length, topology, name),
  then the step's settings as `key=value`.
- **Percent-escaping** for a space, `%`, `,`, `=` and anything outside
  printable ASCII, so a name can hold anything and the file stays ASCII.
  `-` stands for an empty name or list item, and a lone `-` is escaped.
- **Ranges are 1-based and inclusive**, as the rest of a GenBank file
  counts. Across the origin the end is the smaller number, and the parent's
  length on the next line down unrolls it.
- **Versioned** (`: 1`). A block of a version this build does not know is
  kept as a comment and written back unchanged, so a newer build's tree
  survives a round trip through an older one.
- **Strict.** Each step must have the parents its kind takes (`parentCount`),
  and the flags one per parent. A depth that skips a level, a second root, a
  bad checksum or escape, or a missing setting makes the whole block
  unreadable. A tree past the limits, which this app did not write, is
  pruned on the way in.
- It rides in share links for free, since a link carries GenBank text.
  FASTA has no room for it: the header already carries the ends and the
  host, and a tree does not fit in a header line. The guide says an export
  leaves it out. There was no FASTA warning to extend.
- Stored documents are GenBank text too, so IndexedDB keeps it without a
  schema change. The history rows (item 51) copy metadata, so they gained a
  `lineage` field, optional on the way in so format-1 rows read as before. A
  shelf part whose stored lineage does not validate loses the lineage and
  keeps the part.

## The tree

A **Made from** section at the top of the History tab, collapsed to one line
saying how the document was made (`<details>`, open state remembered per
document for the page load). It is in the History tab rather than a panel of
its own because it is the other half of the same question, how this document
came to be. The tree answers up to the moment it was made, and the list below
it answers since. A seventh sidebar tab for a section most documents do not
have would have cost every document a tab. It renders nothing for a document
with no lineage.

- Nested lists of cards with buttons, not an ARIA tree: there is nothing to
  select, only something to open, so a `role="tree"`'s arrow-key model would
  be machinery for no action. `summary` and `button` are keyboard
  accessible as they are.
- Each card: name, what made it (`describeLineageStep`), length, topology,
  the checksum's short form (full on hover), a PCR's or a mutagenesis's
  primers, and **Open** or _not in this browser_. The root says **this
  document** or **edited since**.
- **What the browser holds** is looked up by checksum, only while the tree is
  shown. Open tabs are matched synchronously: each tab's checksum is cached
  per immutable document object (`cachedChecksum`), so a render costs one
  SHA-1 per new tab state. Closed documents are matched by a new indexed
  `checksum` field on the stored row (Dexie version 6), written by every
  save. The upgrade fills it in from each row's text, and a row that will
  not parse is left without one. So a lookup is one `where('checksum').anyOf`
  and no stored text is parsed. A tab wins over storage, and the document the
  tree belongs to is never offered.
- **Open** brings the tab to the front, or opens the stored document as
  **Recent files** does (`persistence.openStored`).
- Not looked in: the undo history of each document, and a working copy's
  stored origin. Either could hold the exact version a step used after the
  document moved on. The first would mean a checksum of up to 200 states per
  document. For the second, opening would need a new way to open an original
  that is not a document of its own. Both are follow-ups if wanted.

## SnapGene's history

Investigated: packet `0x07` of a `.dna` file is a `<HistoryTree>` XML
document, xz-compressed in 10 of the 12 bundled SnapGene 8.2 samples that
have one. Its nodes have names, lengths, topology, operations
(`insertFragments`, `amplifyFragment`, `primerDirectedMutagenesis`, …) and
oligos. The ancestors' sequences are in `0x0B` packets, in an encoding not
worked out. Reading it needs an xz (LZMA2) decoder, which the browser does not
have, and it carries no checksums. Filed as #85 rather than blocking this.

## Usage events

`history`/`made-from` (the tree expanded, once per visit) and
`history`/`made-from-open`, named `tab` or `stored`: where the opened
molecule was held, never which.
