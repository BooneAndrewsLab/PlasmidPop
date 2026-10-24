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
  whether the tab is still open before writing. Since #280 the close's own
  save overtakes it instead (below).

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
- An edit followed by closing the tab within the 500 ms debounce was still
  not saved: the debounced autosave went over the open tabs only. That was
  so before this change; it is #280's, below.

## Closing a tab (#280)

### What was asked

An edit followed by closing its tab before the autosave had stored it was
lost: reopening the document from Recent files showed the state before it.
#278 (item 104) widened the window from the 500 ms debounce to as much as
some ten seconds, since an ordinary save started for a state d1 may wait up
to 5 s for quiet before the worker request and again before the put, and
an edit d2 made meanwhile is only in the next save, which reads the open
tabs and so never sees a tab closed in between.

### What was done

**The store says when tabs close.** `editorStore.onTabsClosed` tells its
listeners the states of the tabs that just left, whichever way they left:
`closeDocument` (the tab's close button, File → Close, `Alt+W`, the last
tab of the window, removing an open document from Recent files),
`closeAllDocuments`, and an untouched New tab given up to an opened file.
There is no Close others or Close all in the UI; closing the page is
`useFlushOnLeave`'s. `useSaveOnClose` (in `App`) has the persistence service
listen, so a test's own `PersistenceService` listens only when it asks to
(`saveOnClose()`), and nothing saves behind a test that did not.

**`saveClosed` writes each closed tab that changed since it was last
written** (the same `isUnchanged` test the autosave uses); an unchanged one,
and an untouched new one, write nothing. It claims the closed state in
`lastRead` before its first await, so every ordinary save of that id still
out, waiting for quiet, at the worker or before its put, finds out at its
next check, or inside its transaction, that it was overtaken and writes
nothing. It claims a shallow copy of the state rather than the state itself:
claims go by identity, so an ordinary save that read the very same state
stands down too, and a genome is put once rather than twice. A save whose
transaction had already passed its check before the close writes first;
the close's transaction begins later and lands after it. The ordinary save
now reads each tab when its turn in the loop comes rather than all of them
when it starts, so a tab closed during it is skipped rather than written in
a state older than its close's.

**It is neither urgent nor queued.** Its text is written in the save worker
and it waits for neither the queue nor quiet; it does wait for the worker's
checksum, as an ordinary save does.

- Not inline, as the flush on leaving is: that is for a page nobody may see
  again, whose main-thread time is free. A closed tab's page is still in
  use: the next tab is being drawn, and an inline `writeGenBank` of a
  4.64 Mb genome is about 110 ms on top of the put. Through the worker the
  close costs the main thread the history row, crossing the document over
  and the put, 47-63 ms at 4.64 Mb (above), once.
- Not queued, and not waiting for quiet: the queue can be held for seconds
  by a save waiting for quiet, and the point of the save is that the
  document is stored by the time anyone looks for it. Reopening it from
  Recent files is the likely next step, and `openStored` waits for the
  close's save of that id before it reads it, so a wait for quiet there
  would be a reopen held for seconds. Closing a tab is not a moment of
  scrolling, so the put the wait was for (#278) has nothing to land in.
- Leaving the page while a close's save is still at the worker loses
  nothing: the urgent flush also writes the states of closes still under
  way (`closing`), inline, as it writes the open tabs.

**A closed tab is not merged into an identical entry by re-keying it**:
there is no tab left to re-key. With no steps of its own and an identical
entry not open, the entry already holds it and nothing is written; with
steps it keeps an entry of its own, as an open tab with steps does.

**Removing a document closes its tab first without saving it** (`removing`),
drops any claim on it so a save still out stands down, and waits for a
close's save already under way before it deletes, so nothing writes a
removed document back.

**A reopened document whose undo history is rebuilt a task later** (#83)
counts as unchanged: what came back is what is stored. Before, the rebuild
made it look changed, and it was written again by the next autosave; now
neither that nor closing it unchanged writes anything.

The tests are in `saveOnClose.test.tsx`: each way a tab closes (the close
button, `Alt+W`, File → Close, closing all, an untouched New tab replaced),
the close against a save waiting for quiet before the worker and before the
put, out at the worker and held at the put, of the same state, two quick
edits, the page left while the close is at the worker, reopening from the
list with the close's save still out, removal, and the hook.

## The flush on leaving also stashes the text (#290)

Skipping `has()` and `findIdentical()` on the urgent path (6f975a3) did not
fix a document opened, or edited, less than about a second before a reload:
the reload still found nothing. The cause is the write itself, not the steps
before it: an IndexedDB transaction begun in `pagehide` (a read of the row,
then the puts) is asynchronous, and a page being reloaded does not wait for
it to commit. `localStorage.setItem` is the one store a page leaving can
finish, and `rememberSession` already relies on it for the tab ids.

So the urgent save, having the GenBank text inline anyway, also stashes it
in localStorage (`DocumentRepository.stash`, key `plasmidpop.pending.<id>`:
name, file name, text, read, time) before it begins the IndexedDB write, and
the write's commit removes the stash. `restoreLastSession` reads a stash
(`loadPending`) for each tab it restores and uses it over the stored row
unless the row is at least as new (a stash that outlived a write whose
commit the page did not see is equal, not newer). A restored stash is
treated as unwritten, so the ordinary autosave writes it and drops the
stash; its tab has no undo history (the stored one ends at an older state),
and keeps the stored origin and `derived` flag if there was a row. Leftover
stashes of tabs not restored are removed.

Limits: a document over 1.5 million characters of text is not stashed
(localStorage is some 5 million units per origin, shared with the rest), a
failed `setItem` is ignored, and a tab closed as the page goes (#280's
`closed` path) is not stashed. In those cases the IndexedDB write alone is
what there is, as before.

`leaveStash.test.ts` models "the page is gone" by a repository whose
`write` never commits, then restores through a new service over the same
storage: open then leave, edit then leave, commit clearing the stash, and
the size limit and pruning. Not verified outside the tests: real Chromium and
Firefox reloads (the issue's Playwright recipe).
