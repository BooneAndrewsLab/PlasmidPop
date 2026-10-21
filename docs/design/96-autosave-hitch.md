# 96. The scroll hitch at 300 kb was the autosave

Issue #268. Status: done (1.17.x).

## What was asked

`npm run bench` (#253) scrolls the sequence view 120 wheel events after a
seeded random FASTA has opened and its enzyme list has drawn. At 300 kb every
run dropped exactly one frame of 67-83 ms; 50 kb, 1 Mb and 4.6 Mb dropped
none. The issue asked which work lands in that frame, whether it is at a
fixed scroll position or just at the start, and whether the sizes between
50 kb and 1 Mb show it too.

## What was found

A CPU profile of the scroll (Playwright's CDP session, `Profiler.start`
with a 0.2 ms sampling interval, aggregated by the longest busy stretch)
put the whole of the long frame in `persistence.autosaveDocument`:

- `documentChecksum` for the stored row: the SEGUID digest of
  `watson;crick`, about 30 ms of SHA-1 and 10 ms of building both strands
  at 300 kb;
- `writeGenBank`, twice: once in `findIdentical`, which looked for a stored
  copy of the file by writing the text and comparing, and once in `save`,
  which stores it; about 8 ms each;
- the Dexie `put` of the document and history rows, and a garbage
  collection after all those strings.

Nothing in the sequence view itself is in it: the row layout, the renderer
and the worker round trips all hold their frames at every size.

The autosave is not at a scroll position; it is at a time. `useAutosave`
waits 500 ms after the last change to the store's document list, which at
every size puts the write about 1.0-1.2 s after the file was picked. The
bench starts scrolling the moment the enzyme list has drawn, which is
0.7 s after the open at 300 kb (so the write lands 320 ms into the scroll,
at frame 18-20) but 1.2 s at 500 kb and 1.6 s at 1 Mb, after the write has
already happened. The long task is there at every size and grows with it,
the bench just only looks while it happens at 200-300 kb:

| Size   | Autosave task on the main thread | In the bench's scroll? |
| ------ | -------------------------------- | ---------------------- |
| 50 kb  | ~15 ms                           | yes (one 33 ms frame)  |
| 100 kb | ~20 ms                           | yes (one 33 ms frame)  |
| 200 kb | 54-62 ms                         | yes                    |
| 300 kb | 52-77 ms                         | yes                    |
| 500 kb | 82-179 ms                        | no, before it          |
| 1 Mb   | 265-271 ms                       | no, before it          |

So the answer to the issue's third question is that 100 kb shows a 33 ms
frame and 200 kb the same hitch as 300 kb; 500 kb would show a worse one
if the scroll started sooner.

## What was done

- `documentChecksum` remembers its answer per document object in a
  `WeakMap`. A document is immutable, so the answer cannot go stale, and
  the status bar had already taken the same checksum at the open — the
  autosave, the lineage, `Compare with…` and `findByChecksums` were each
  taking it again. The autosave's copy is now a lookup.
- `findIdentical` fetches the stored documents with the same name and file
  name first and writes the GenBank text only when there is one to compare
  with. The first save of a file just opened, which is the one that asks,
  mostly finds nothing.
- The bench records when the longest gap fell (`scroll_max_gap_at_ms`,
  ms after the first wheel event, and `scroll_max_gap_after_open_ms`), so a
  task that lands at a time rather than a position shows as one.

The remaining main-thread cost of the autosave is one `writeGenBank`, the
history encoding and the IndexedDB write: 30-41 ms at 300 kb and 45-62 ms
at 1 Mb (`docs/perf-notes.md`). The bench no longer drops a frame past 50 ms
at any size; at 200-300 kb it still shows one 33 ms frame, a missed vsync.

## What was left

- The status bar's checksum is still taken on the main thread at the open,
  in the same task as the first paint: about 15 ms at 300 kb and 80 ms at
  1 Mb, plus the strands. Past some size it belongs in the analysis worker, with the status
  bar showing nothing until it comes back.
- `writeGenBank` and the history encoding for the autosave are the next
  largest pieces and could follow it into the worker, which would need the
  document to cross to it.
- The SHA-1 itself runs at about 20 MB/s in `sha1.ts`; a tighter inner
  loop would be worth two or three times that if the digest stays on the
  main thread.
