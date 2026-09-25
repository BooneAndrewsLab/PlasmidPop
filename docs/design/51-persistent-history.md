# 51. The undo history survives a reload

Done, 2026-09-24 (#5). Documents came back after a reload; their History did
not, so a reload (or a crash, or the browser throwing the tab away) cost
every undo step, and a tab closed and reopened from **Recent files** came
back with none. Now each document's history is kept in IndexedDB beside it
and comes back with it: the same steps, labels, times and merged counts, the
same position with the undone steps above it still redoable, and the two
baselines of the Edits menu where they were.

## How it is stored

A Dexie table of its own, `histories` (schema version 5; the other stores
carry over, `migration.test.ts` comes up from versions 1 and 4), one row per
document id. Apart from `documents` so that listing the recent files never
reads a history, and written in the same transaction as the document
(`DocumentRepository.save`), so the two cannot be read back out of step.

A row is not a document per step. It is the oldest kept state whole, then
each later state as what changed from the one before it
(`src/storage/historyFormat.ts`, `historyCodec.ts`):

- **Bases** as a splice: the common prefix and suffix of the two sequences
  leave `start`, how many bases were deleted and what was inserted. That is
  O(n) to find (compared a 4 KB block at a time; a `charCodeAt` loop was
  ten times slower on a megabase) and covers typing, paste, delete and
  replace in a few bytes. A reverse complement and a set origin rewrite
  every base, so as a splice they would be the whole sequence again; they
  are recognised (a turn is checked on 32 bases before the whole sequence
  is turned; a rotation is found by looking for the new start in the old
  sequence twice over) and stored as `reverseComplement` and `rotate`, a
  few bytes each. Anything else, such as a delete across the origin of a
  plasmid, is a splice as large as it has to be, which is correct and only
  costs space.
- **Features** as a patch on the previous state's list: ids removed,
  features replaced in place or appended — the shapes adding, editing and
  removing leave. An edit of the bases moves every feature after it, which
  would make every keystroke a copy of the whole list, so the patch can say
  `replay`: move the previous features the way the edit itself would
  (`SeqDocument.insert`/`delete`/`replace`/`reverseComplement`/`setOrigin`,
  then `setTopology`), and patch what that does not explain (a paste's
  features, say). A run of one base lets an insertion sit anywhere along it
  as far as the bases go, and where it sits decides where features move, so
  both ends of the run are tried. **Every patch is applied and compared
  with the real list before it is used**, and the whole list is written
  when no patch reproduces it or none is smaller: the compact forms are an
  optimisation that cannot make a history wrong.
- **Everything else** — name, topology, description, ends, host
  methylation, a sequencing read — only when it differs, as its own
  explicit copy.

Every value goes through our own copy functions (no object is stored as
the app happens to hold it), the row carries `format: 1`, and on the way
back every field is checked (`isStoredHistory`), every splice is bounds-
and alphabet-checked, and every state is rebuilt through
`SeqDocument.create`, which validates features against the sequence. A row
that fails any of that is dropped and the document opens with an empty
history, as it did before; so is a row whose present is not the stored
document (the GenBank text is written again and compared, 26 ms for a
megabase), which is the check against anything having written one without
the other. `History` gained `toRecord`/`fromRecord` for this, which lay the
stack out flat and rebuild it.

## Limits

- **Steps:** the History's own limit, 200, as before.
- **Size:** `HISTORY_BUDGET`, 4 MiB of estimated bytes per document (one
  per base or character; the estimate is `storedSize`, and the encoder
  counts exactly that). Past it the oldest steps are left out of the stored
  copy and the row is marked `truncated`, which the History panel already
  shows as **Oldest kept state**; only when no step before the present is
  left do redo steps go, from the far end; and when not even the present
  fits (a document of about four megabases or more) no history is stored.
  The history in memory is not cut; the budget bites on the next reload.
  Measured on 200-step sessions (below): a 10 kb plasmid stores 42 KB, a
  megabase with a thousand features 1.24 MB, of which the base state is
  about 1.2 MB. 4 MiB is a megabase with room for both baselines stored
  whole and a few megabytes of steps; a plasmid never comes near it, and
  it keeps the worst case for fifty stored genomes at a fifth of a
  gigabyte, which browsers grant.

## When it is written, and what it costs

With the document: `PersistenceService.autosave`, half a second after a
change and on `pagehide`, now also when only the history or a baseline
moved (an undo, a jump, a download), since those change what comes back.
States never change once made, so the delta between two of them is worked
out once and remembered (`deltaCache`, a `WeakMap` keyed by the state): the
autosave after a keystroke works out one new delta whatever the length of
the history, and a row read back seeds the cache, so the first save after a
reload works out none. Node 24, Vitest, 200 steps of typing runs, deletes,
feature edits, one reverse complement and one set origin
(`docs/perf-notes.md`): the autosave after a keystroke spends 0.5 ms on a
10 kb plasmid and 5 ms on a megabase with a thousand features; reading a
history back takes 14 ms and 310 ms. That last one is once per restored
tab and is the price of re-running 200 feature moves over a thousand
features and validating every state; if it is measured to hurt, the states
can be rebuilt lazily or off the main thread.

Deleting a document from local storage (**Remove**) deletes its history in
the same transaction. Closing a tab does not: the history stays with the
stored document, and reopening it from **Recent files** brings it back.
A stored document renamed from the Files screen gets the rename as a step
of its history, as a rename in a tab would.

## A run being typed comes back sealed

`coalesceKey` is not stored, so a restored history is sealed: the first
keystroke after a reload starts a step of its own rather than joining the
run that was being typed when the page went. A run is one thing done in
one sitting; a reload ends the sitting.

## What the baselines mean after a reload

Each is stored as where it is, not as a document: one of the kept states
(`step`), the file a working copy came from (`origin`, which is stored
beside the document already), a state of its own (`state`, stored whole),
or none.

- **Since opened** measures from what it measured from before the reload.
  For a document that is not a working copy that is the history's step 0,
  what was opened — so the marks and the History panel's **Opened
  document** row agree, and a reload no longer silently moves "opened" to
  "whatever was there at the reload", which is what it used to do. For a
  working copy it is the file it came from, as it was in the session. A
  truncated history's opened state is outside the steps and is stored
  whole, so the marks stay the session's marks; if that would leave no
  room for the present it gives way and "opened" becomes the oldest kept
  state, which is what the History panel then starts from.
- **The download marker** (the dot, the **on disk** tag, **Since last
  download**) comes back as the very state object it points at, because
  "dirty" is an identity test: undoing to the downloaded state clears the
  dot after a reload as it did before. A working copy never downloaded
  comes back never downloaded, so it has its dot and **Since last
  download** measures from its file; the old restore called any document
  with a file name clean, which was wrong for those. A download older than
  the oldest kept step is stored whole, and gives way before the present
  does, as the opened state.
- **Mark from here** and **Compared with** still come back as **Since
  opened**, as item 21 decided: they belong to one session's work.

## Privacy

Nothing leaves the browser: the rows are in this browser's IndexedDB like
the documents. One coarse event, `history`/`restore` named `restored`,
`none` or `dropped`, once per visit each, says whether stored histories
come back at all — and `dropped` would be the sign of a bug — and nothing
about what is in them (`EVENTS` in `src/app/analytics.ts`).
