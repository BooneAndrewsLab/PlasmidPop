# 97. The checksum of a large document is taken in the analysis worker

Issue #270. Status: done (1.17.x).

## What was asked

Design note 96 left the status bar's SEGUID on the main thread, in the same
task as a document's first paint: a SHA-1 over `watson;crick` plus building
both strands, about 15 ms at 300 kb and 80 ms at 1 Mb by the earlier
profile, of an open task of 410-430 ms at 1 Mb. The issue asked for it to
move to the analysis worker past some size, with the status bar showing the
checksum when it arrives, and for the size to be measured rather than
guessed.

## What was measured

`scripts/bench/open-profile.ts` profiles the main thread through CDP while
a seeded random FASTA opens in an unminified production build (function
names survive), and reports the `longtask` entries, when the sequence view,
the checksum button and the enzyme list were painted, and what each busy
stretch was in. Before the change, at 1 Mb, the open was one task of
311-320 ms, of which 122-131 ms was inside `documentChecksum`: 70-75 ms of
SHA-1, 22-28 ms building the strands, and the rest garbage collection those
strings set off. The garbage collector had 114-123 ms of the whole task;
after the change it has 6-11 ms, so the two 1 Mb strands and the 2 Mb
`watson;crick` were most of what it was collecting. At 300 kb the checksum
was 35-39 ms of a 132-156 ms task.

The size threshold came from two measurements (`docs/perf-notes.md`). The
digest inline is 0.8 ms at 3 kb, 1.9 ms at 10 kb, 3.9 ms at 30 kb, 10.5 ms
at 100 kb. A worker round trip of the sequence string costs the main thread
under 0.1 ms up to 100 kb and 0.6 ms at 1 Mb, so on main-thread time alone
the worker wins from a few kilobases. What it costs instead is a paint
without the checksum and one more render of the status bar when it lands,
and for a plasmid that is more than the digest. The threshold is 50 kb
(`WORKER_CHECKSUM_FROM`): below it the digest is under 6 ms and the checksum
is in the first paint, as before; from it on the worker takes it.

## What was done

- `moleculeChecksum` in `core/checksum/seguid.ts` takes the checksum of a
  `MoleculeDescription` (sequence text, topology, protein or not, ends),
  which is what crosses to the worker; `documentChecksum` is the same
  function on a document, memoised per document object as before (#268).
  `knownChecksum` reads that memo without computing and `rememberChecksum`
  seeds it with the worker's answer, so the autosave, the lineage,
  `findByChecksums` and the history restore, which take the checksum
  synchronously, find it there and never compute a second one.
- The analysis worker answers a `checksum` request; `analysisClient.checksum`
  sends one.
- `app/state/documentChecksum.ts` owns the threshold. `documentChecksumLater`
  is the async form: inline below the threshold or when the answer is known,
  one worker request per document object otherwise, remembered when it
  lands; if the worker fails it falls back to the main thread.
  `useDocumentChecksum` is the hook the status bar and `Compare with…` use:
  the value at once for a small or already-known document, undefined while
  the worker is at it, and an answer for a document that has been replaced
  meanwhile is dropped, never shown against the new one (the answer is still
  remembered for that document). A document opened into a quiet status bar
  is asked for at once; one that follows a request within 150 ms (typing in
  a large document, where every keystroke is a new document) waits that
  beat, since a request the worker has taken cannot be called back.
- The status bar shows `cdseguid=…` dimmed, in the button's box, while the
  worker is at it, so the file name beside it does not move. `Compare with…`
  shows its checksums block once both are known.
- The autosave awaits `documentChecksumLater` before building the stored
  row, so even when it fires before the worker has answered (a 1 Mb
  document whose scan is in front of the checksum in the worker's queue),
  the digest is not taken on the main thread.

The request goes to the worker before the restriction scan, which
`useAnalysis` sends 150 ms later, so the scan is not in front of it; the
scan waits the digest's 40-110 ms instead, which the enzyme list's time does
not show because the worker's start-up, which the scan used to pay, is now
paid by the checksum request.

After the change the open task is 77-94 ms at 1 Mb and 67-97 ms at 300 kb;
the view paints at 133 ± 2 ms at 1 Mb against 343 ± 6 ms before, and the
checksum button is painted 100 ms after the view at 300 kb and 250-290 ms
after it at 1 Mb (the worker's start-up, the digest and a frame).

## What was left

- `restoreHistory` compares the checksum of the rebuilt present with the
  tab's, and the rebuilt one is computed inline when a stored history is
  restored: at 1 Mb that is 100 ms on the main thread, once per reopen.
- `writeGenBank` and the history encoding for the autosave (the 65-100 ms
  task at 1 Mb) are the next pieces that could follow into the worker.
- The SHA-1 in `sha1.ts` is about 20 MB/s; in the worker its speed no
  longer shows on the main thread, only in when the checksum appears.
