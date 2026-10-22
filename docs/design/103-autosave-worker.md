# 103. The autosave's GenBank text in a worker

Issue #272. Status: done (1.17.x).

## What was asked

After #268 (item 96) the autosave was still one main-thread task: one
`writeGenBank`, the history encoding and the IndexedDB put, 30-41 ms at
300 kb and 45-62 ms at 1 Mb, over the 50 ms line at 1 Mb. The issue asked
for the text and the history encoding to be made in a worker and handed to
Dexie, without changing a byte of what is stored, without a save landing
out of order, and without losing the last edit to a close or the page
being left.

## What was done

**The GenBank text is written in a save worker** (`src/workers/save.worker.ts`,
`saveClient.ts`, `saveProtocol.ts`), a worker of its own rather than a
request to the analysis worker, so a save never waits behind a genome's
restriction scan or an alignment. The client is the export client's
pattern: one worker, made on the first request; past `WORKER_GENBANK_FROM`
(50 kb, the checksum's line) the documents go to it, below it and wherever
anything goes wrong — no `Worker` (jsdom), a worker that cannot start, dies,
answers with an error or does not answer in 20 s — the text is written on
the calling thread, so a save is only ever slower, never lost.

A document crosses as two strings: the bases, and everything else
`writeGenBank` reads (name, topology, alphabet, features, metadata, ends,
methylation, styled runs) as one JSON string. A string is cloned as a
block; a clone of a few thousand feature objects costs the main thread
more than `JSON.stringify` of them (`docs/perf-notes.md`). The sequencing
read stays behind: the text does not hold it. The worker rebuilds the
document with `SeqDocument.create` and writes it; a working copy's original
goes in the same request.

**The history row stays on the main thread.** `encodeHistory` works out a
delta only for a step it has not seen (`deltaCache`, item 51) and keeps the
oldest state's copy, so an autosave's share is the new step's delta: 0.8 ms
in the profile of a file just opened at 1 Mb, about 5 ms after a keystroke
at 1 Mb with 1,000 features. In a worker it would need every state of the
history there: a flat copy of each (a megabase, two hundred steps, is
200 MB where the ropes share), or the whole history re-encoded from nothing
after each reload (780 ms at that size). Either costs more than it saves.

**`DocumentRepository.save` is split** into `historyRow`, the texts and
`write`, which stores what `save` stored for the same arguments; every
other caller of `save` is unchanged. `findIdentical` takes the writer of
its text, so the first save of a reopened file has that written in the
worker too.

## Order, and leaving the page

- **Ordinary autosaves run one after another** (a promise chain in
  `PersistenceService`): each reads the tabs when its turn comes.
- **A save may write a stored id only if it read the newest state of it.**
  Each save records the tab state it read (`lastRead`, kept only while the
  save is out); `write` asks inside its transaction, just before the put,
  whether that is still the newest. Read-write transactions over the same
  tables run in the order they were begun, so an older save that was
  overtaken stands down rather than put its state over the newer one. Two
  saves that read the same state may both write it.
- **The flush when the page is hidden or left is urgent** (`useFlushOnLeave`,
  `autosave({ urgent: true })`): it does not queue behind a save waiting on
  the worker, waits for neither the idle callback nor the worker's
  checksum, writes the text inline and begins the write at once. A page
  being left may not live to see a round trip, and nobody is looking at a
  hidden one, so its main-thread time is free. This is the main-thread
  fallback; everything else goes through the worker.
- **A tab closed while its save is out keeps that save**: nothing checks
  whether the tab is still open before writing.

The tests (`autosaveWorker.test.ts`) put the rows of tabs of every kind
through both paths and compare them, and hold the worker's answer to
check the races. `save.worker.property.test.ts` puts random edited
documents, every committed GenBank and GenPept record and a long circular
one through the snapshot, a structured clone and the worker's handler.

## What was measured

At 300 kb and 1 Mb the autosave's largest piece of main thread is now
11-21 ms (from 36-37 and 78-80 ms in the same profile), and at 4.64 Mb
47-63 ms (from a 115-143 ms task); the numbers, and the cost of crossing,
are in `docs/perf-notes.md`. The 4.64 Mb worker first fell back to the
main thread on every save: `writeGenBank` spread 77,000 sequence lines
into one `push`, which overflowed a worker's stack. A fallback that hides
a failure is only as good as the profile that would show it.

## What was left

- What remains on the main thread at a genome is reading the text back
  (6-13 ms) and the Dexie put (33-46 ms), which is IndexedDB's structured
  clone of the text. Only writing to IndexedDB from the worker would take
  that off; it would need a second Dexie connection and the order of the
  two writers kept across threads.
- Because the text now comes back a round trip later, at 4.64 Mb that
  remainder lands about 0.3 s later than the whole autosave did, inside the
  bench's first scroll. When the autosave should run is #278's.
- An edit followed by closing the tab within the 500 ms debounce is still
  not saved: the debounced autosave goes over the open tabs only. That was
  so before this change.
