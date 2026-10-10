# 86. My parts (#210)

**Asked:** Detect features matched only the bundled list. Labs keep their own
parts; let a user keep a local collection (add from a feature in any
document, import a GenBank or FASTA file), have Detect features match it with
the bundled list and say which list a hit came from, download it as GenBank,
and include it in the backup of #203. Plus an import of pLannotate's database
files, labelled by source.

**What was built.**

- `core/annotate/myParts.ts`: `MyPart` (name, type, bases or protein, notes,
  origin), `preparePartDrafts` (cleans, drops duplicates by name + bases,
  counts parts under 12 bases (the matcher's seed; 5 residues for a protein),
  parts with non-ACGT bases, and nameless ones), `myPartToLibraryPart`,
  `partsFromDocument` / `partFromFeature` (a feature is read in its own
  direction, so a reverse-strand feature is stored as it reads).
- `LibraryPart.source` gains `'mine'` and an `origin` label (`My parts`,
  `pLannotate: snapgene`). A hit shows "from <origin>", its tooltip says it is
  not the bundled list, and `featureFromHit` writes the note as "to <origin>"
  rather than citing an NCBI record, so the annotation of a user's part can
  never look like a cited one.
- Detection: the main thread reads the store and sends the parts in the
  `detectFeatures` request (`userParts`); the worker searches them ahead of
  the bundled parts (so a tie goes to the user's name, as `keepBest` prefers
  library order) and caches the combined index by content, so an unchanged
  My parts is indexed once. Ambiguity codes in a user part are not supported
  (the matcher indexes A/C/G/T parts); such parts are counted as left out.
- Storage: Dexie version 12, table `myParts` (`id, addedAt`), a row per
  part, same conventions as `primers` (read on first use, rows validated on
  load, an edit keeps its place). `app/state/myParts.ts` mirrors the primer
  collection store. The section reads nothing until it is opened; Detect
  features loads the store when it runs.
- UI: `MyPartsSection` under Detect features; **Save to My parts** in the
  feature editor; Add from file (GenBank/FASTA, several at once);
  **Download as GenBank** (one record and one full-length feature per part,
  which reads back as the same parts; protein-only parts are counted and left
  out; imported lists are not exported, since they are a user's copy of
  someone else's data and a lab's shared file is for its own parts).
- Analytics: `parts` (`add` by source, `export`, `detect`), never names or
  counts.

**The backup of #203 does not exist yet** (milestone 1.15). `myParts` is a
plain IndexedDB table of plain rows; when the backup is built it should
include it as it includes `primers`. Noted on #203 for whoever builds it.

## pLannotate import (`io/parts/plannotate.ts`)

No code of pLannotate was read into this project and none of its data is
bundled (item 59 and the third-party data policy). The layout was checked
against the repository's `master` branch in October 2026
(`plannotate/_database_builder.py`, `_sqlite.py`, `data/data/databases.yml`,
`gather_databases/{snapgene,fpbase}`, `tests/test_data/makedb`):

- databases are `snapgene` (BLASTn, DNA), `fpbase` (DIAMOND, protein) and
  `swissprot`/`Rfam`; each source is an index plus a descriptions table
  (`<name>.db`, SQLite) with columns `sseqid, name, type, blurb`, built from a
  FASTA (header's first word is `sseqid`) and a CSV. Older releases used
  `sseqid, Feature, Type, Description`; the CSV loader accepts the aliases
  `id/accession/qseqid`, `feature/gene`, `description/desc/note`, any case,
  and sniffs the delimiter. FPbase's gatherer writes a headerless TSV
  `slug, name, blurb` and a FASTA headed by slug.
- The release ships the indexes as BLAST/DIAMOND binaries; the FASTA of
  `snapgene` is therefore not in the release as text and must be exported by
  the user (`blastdbcmd`) or come from the user's own build. That is outside
  what we can verify or automate, so the importer takes FASTA plus table and
  says so in the guide. SQLite `.db` and the binary indexes are not read (a
  SQLite reader would be a dependency for little).
- The importer is therefore tolerant rather than strict: delimiter sniffed,
  headers matched by alias, headerless FPbase table recognised, an id with no
  row named by its id (typed `CDS` for protein, `misc_feature` for DNA, as
  `makedb` does), table paired to FASTA by file-name stem. Not verified against a
  real `snapgene.fasta` (none was available, and we could not use one); the
  tests use small synthetic files in each layout. Swissprot and Rfam are not
  offered: they are large, and Rfam is not matchable by this matcher (item 59).
- Imported parts carry `origin: "pLannotate: <stem>"`, so hits and
  annotation notes name it; "Remove this list" deletes one import.

**Not done / follow-ups.** Editing a part's bases in place (remove and
re-add; name, type and notes are editable in the store but the list has no
edit form yet); IUPAC bases in user parts; a backup entry (#203).
