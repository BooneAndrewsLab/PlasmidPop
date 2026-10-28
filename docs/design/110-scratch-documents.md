# 110. Scratch documents

Issue #306. Every open tab with content is persisted (`persistence.ts`
`autosaveAll`/`writeDocument`), so one cloning run left a ligation product,
the fragments opened to build it and the NCBI record fetched for the primers
all in **Recent files**, each looking like something the user had chosen to
keep. This marks a category of documents instead and gives it a short life.

## What item 24 decided, and what this changes

Item 24 ("Not yet") declined to mark stored documents that had never been
downloaded: every document lives in the browser, so a per-row marker would
be noise, and the Files screen says it once. That still holds for the
documents the user brought or made. What is new is a different distinction:
not "downloaded or not", but "asked for or made on the way". A scratch
document is something the program opened as a means; nothing the user typed,
pasted, opened or fetched by name is one.

## The decisions

- **`kind: 'file' | 'scratch'`** on the stored row (`StoredDocument.kind`,
  `DocumentKind`). Absent reads as `file`.
- **Scratch** are the products of ligation, Gibson, Golden Gate (including
  the Modular panel), Gateway, SOE, PCR, mutagenesis, simulate-cloning, the
  overlap-primer product, back-translation and a comparison's clone, the
  fragments opened from the Cloning shelf, and the NCBI records fetched from
  the primer workspace (`openFetched(fetched, { scratch: true })`). **Kept**
  are files, pastes, New documents, File ▸ Open from NCBI, the example, and
  also Translate ▸ Open as protein and Save consensus: nothing in #306 named
  them, and each is a deliberate Save-as-document action.
- **Said outright, not inferred.** `OpenStorage.scratch` on
  `editorStore.openDocument`, because a missing file name is also what a
  paste and a New document have, and a primer-design fetch has a file name.
  The tab carries `DocumentState.scratch`; the row's kind is written from it.
- **Kept on edit, rename, download or Keep, and by nothing else.** The one
  place an edit is made is `editorStore.apply` (rename is an op), so that is
  where `scratch` goes false; `markDownloaded` does the same for both
  download formats; `keepDocument` is the explicit one (File ▸ Keep this
  document, and Keep / Keep all in the Unkept list). Viewing, selecting,
  switching tabs and running analyses do not call any of them, and a test
  holds that. An undo or a named state cannot happen before an edit, so they
  need no case. The mutant of Mutagenesis is made by applying the point
  mutation to a copy: that edit passes `keeps = false` (the fifth argument of
  `apply`), since it is the product, not the user's work on it.
- **One way only.** Kept is never turned back into scratch. `repo.write`
  stores `scratch` only over a row that is absent or already scratch, so a
  tab that has not heard it was kept (Keep clicked in the list while its tab
  was open) cannot undo it, and an old row without a kind is kept.
- **`mergeIntoIdentical` (first save of a document identical to a stored
  one).** A scratch tab that becomes a stored kept row takes the kept state
  (`keepDocument` after the merge); a kept tab over a stored scratch row
  writes `file` over it. Opening the same accession first for primers and
  then with Open from NCBI finds the scratch tab and keeps it.
- **Recent files lists kept rows only.** Scratch rows are in a collapsed
  **Unkept (N)** section below it with Keep and Remove each and **Keep all**.
  Opening one from there opens it as scratch: looking is not keeping, and
  opening does not write the row, so its time is not touched. Capping and
  grouping by parent, and Undo, are #307.
- **Removal.** `SCRATCH_LIFETIME_DAYS = 30` after `updatedAt` (the last
  write: an edit would have kept it, so this is "last touched"),
  `SCRATCH_NOTICE_DAYS = 7`. `expiredScratch` and `expiringScratch`
  (`src/storage/scratch.ts`) are pure and take the rows, the clock and the
  ids open in tabs; `DocumentRepository.pruneScratch` and
  `PersistenceService.pruneScratch` apply them. It runs when the app starts
  (after the session is restored, in `useRestoreSession`) and when the Files page
  mounts, never continuously. It spares every tab, every id of the session
  to come back to and every tab still being saved. The Files page says "N
  unkept documents will be removed … as early as <date>" for rows within the
  notice window, with Keep.
- **Storage.** Dexie version 13 indexes `kind` and upgrades every existing
  row to `file`. Backups already carry whole rows, so `kind` travels;
  restore still merges by id, never deletes, and writes `kind ?? 'file'`,
  so a backup from before this one restores as kept. A row whose `kind` is
  neither value is skipped like any damaged row. A scratch row restored from
  a backup keeps its old `updatedAt`, so it can be removed at the next load.
  The flush on leaving stashes the scratch flag too, so a lost write does not
  turn a scratch tab into a kept one on the way back.
- **Made from (item 52).** A lineage node is a name and checksum and finds
  its document by checksum only while the browser holds it. A removed scratch
  parent therefore reads "not in this browser" with its name and checksum;
  nothing in the lineage code needed to change, and a test removes a stored
  scratch parent and checks the tree.
- **Analytics.** No new events: nothing in item 38's catalogue asks for one,
  and the existing `edit`, `file/download` events fire as before.

## Not done here

Unkept grouped by parent, a cap on the list, and Undo of Remove are item 111
(#307). Undo of Keep was not asked for there and is not done.
