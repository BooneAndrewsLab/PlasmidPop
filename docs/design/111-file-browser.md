# 111. Browse all files, grouped products, Undo for Remove

Issue #307, after item 110 (scratch documents). The start screen listed every
stored document, and listing read every document's text. This caps Recent
files, adds a panel for everything, groups the products of one parent, and
gives Remove an Undo.

## Listing without the text

`repo.list()` used to `toArray()` the documents table, which makes IndexedDB
deserialise each GenBank text (and origin text) only to throw it away.
IndexedDB cannot return part of a record, so the small fields are in a table
of their own: **`summaries`** (Dexie version 14, `id, updatedAt`), one row per
document with the fields of `DocumentSummary` and the parent (`StoredSummary`,
`summaryOf`). It is written in the same transaction as the document row at
every place a document row is written or deleted (`write`, `keep`, `remove`,
backup restore, the upgrade), not by Dexie hooks, which cannot reach a table
outside the transaction's scope. Code that edits a row by hand, as some
tests do for `updatedAt`, updates the summary too. Measured with
fake-indexeddb (in memory, so the least it saves) on 100 documents of 200 kb:
the full read took 21 ms and `list()` 2.5 ms; a browser reading real storage
also pays for the disk.

## Parent of a product

`parentChecksum` and `parentName` are on the document row and the summary:
the first parent of the lineage root's step (`lineageParent`, in
`src/core/lineage`, item 52), taken when the row is written. A document with
no lineage, a step with no parents or a first parent with no checksum has
neither and is never grouped. The version 14 upgrade fills them in from each
row's text in one pass (as version 6 did for `checksum`); a text that will not
parse is left without and is still listed. Backups carry whole rows, so the
fields travel; a restored row that has them keeps them, one from a backup
before this derives them from its text. Old backups restore as before.

`groupByParent` (`src/storage/summaries.ts`) is pure: scratch rows sharing a
parent checksum fold into one entry at the place of the first, two or more
only; kept rows and rows with no parent stay rows. It runs on the Unkept list
and on the browse panel's list after search and sort. Kept documents are not
grouped: a file you made is a file, whatever it was made from.

## Recent files and the panel

`RECENT_FILES_LIMIT = 6` kept rows are shown. **Browse all files…** appears
when something stored is not on the page (more kept rows, or unkept ones) and
opens `BrowseFilesDialog`, on the app's dialog classes: search by name or file
name (`searchRows`), sort by updated, name (numbers as numbers) or size
(`sortRows`), ticks with **Select all shown**, **Remove selected** and **Keep
selected** (which acts on the scratch ones). The rows are the one `StoredList`
shared with Recent files and Unkept, so the `open` badge, Rename and the
`.recent__name` truncation are the same everywhere.

## Undo for Remove

Remove (a row, a group, a selection) calls `persistence.removeStoredWithUndo`.
Chosen design: **mark, hold, then delete**, not soft delete in the rows.

- The tabs close at once (as `removeStored` always did), and the ids are put
  in a mark list in localStorage (`plasmidpop.removing`, id to due time),
  written before the call returns. `repo.list()` and `findIdentical` skip
  marked ids; nothing else changes, so Undo is only erasing the marks and
  the document, its history row and its summary are exactly as they were.
- After `REMOVAL_HOLD_MS` (10 s) a timer deletes the rows and histories
  (`commitRemoved`) and then forgets the marks, in that order, so a crash
  between leaves a mark that deletes nothing.
- **Closing or reloading the page in the window.** Only marked ids are ever
  deleted, so a row that was not removed cannot be lost. The next start
  (`settleRemovals`, before the scratch prune) deletes marked rows that are
  due and, for those still within their hold, sets a timer for their due
  time; until then they stay hidden. A removal whose time ran out cannot come
  back, and there is no Undo after a reload, because the toast went with the
  page. A due time rather than "delete everything marked" so that a second
  browser tab starting does not cut the first one's Undo short.
- One Undo per removal (#322; at first there was one Undo, for the latest,
  and starting another removal carried out the one still held, which lost
  the first Undo to a quick second Remove). `persistence.held` is a map from
  a removal key to its ids and timer; `removeStoredWithUndo` returns the key,
  `undoRemoval(key)` restores only that removal's ids and clears only its
  timer, and each timer carries out only its own ids. One call is one unit:
  **Remove selected** of N documents is one Undo. A document an earlier hold
  still has (reopened, then removed again) moves to the new removal, so the
  earlier timer cannot delete it under the new Undo; a hold left empty by
  that is dropped with its toast. A document that is open in a tab when its
  hold ends (the user opened it from elsewhere) is spared and only loses its
  mark.
- Each toast has a ring that drains over the hold (#322): an `aria-hidden`
  SVG circle emptied by a CSS `stroke-dashoffset` animation whose duration is
  `REMOVAL_HOLD_MS` passed as `--undo-hold`, so ring and deadline share one
  constant and nothing runs per frame; keyed toasts keep their animation when
  others come and go, and reduced motion shows the ring full.
- The persisted side needed no change: the localStorage mark was always a
  map of id to due time, so several pending removals were already
  representable, and what an older build wrote reads the same.
  `settleRemovals` settles each mark by its own due time, skipping ids a
  live hold owns.
- The toasts are `RemovalNotice`, rendered by `App`, driven by
  `editorStore.removalNotices` (key and message, oldest first) like the
  backup notice. Each `.undo-toast` is its own `role="status"`, stacked in a
  fixed `.undo-toasts` column at the bottom centre, newest at the bottom
  (there was no toast in the app; the notices under the toolbar are inline
  banners). At most `REMOVAL_NOTICE_LIMIT` (3) are up: a fourth puts the
  oldest away as if dismissed, its removal still held until its time, so
  the stack cannot cover the page however fast one removes. Dismiss (×)
  takes down one toast without undoing. `EmptyState` re-lists whenever the
  list changes.
- Scratch pruning and a restore from a backup are not held: pruning is not a
  user action, and a restore never deletes.
