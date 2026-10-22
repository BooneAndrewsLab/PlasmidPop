# 101. The restriction scan goes before the checksum

Issue #276. Status: done (1.17.x).

## What was asked

After #274 and #275 (items 99, 100) the Enzymes list of a 4.64 Mb FASTA was
drawn about 2.0 s after the file was picked (0.65 s at 1 Mb), while the
worker's scan, digest and packing added up to about 0.65 s. A timeline of
marks on both threads put the rest down to three things:

1. **The scan waited behind the SEGUID checksum** (item 97) on the one
   analysis worker, about 0.85 s at 4.64 Mb. The status bar's checksum
   effect is a child's, so its `setTimeout(0)` was queued before
   `useAnalysis`'s 150 ms timer, and the checksum went to the worker first.
2. **The checksum itself was slow**: `reverseComplement` built the crick
   strand a character at a time (270-440 ms in the worker at 4.64 Mb), and
   our SHA-1 took 280-300 ms over the 9.3 MB canonical string.
3. **The worker was started by the first request**, while the open's long
   task was still running: about 100 ms to start, against about 20 when
   the page is idle.

The autosave waits for the checksum, so the issue also warned that a fast
checksum could put the autosave (about 0.2 s of main thread at 4.64 Mb) just
before the list is drawn.

## What was done

- **A fresh document's scan is sent in the effect** (`useAnalysis`). When
  the tab holds no analysis at all (`analysis === null`: a document just
  opened, or every tab after the enzyme set changed), the restriction
  request is posted synchronously in the effect, which runs after the
  status bar's effect has only queued its timer, so the scan reaches the
  worker first. Everything else waits the 150 ms beat as before: an edit
  with a carried result, and an undo or a tab whose analysis belongs to
  another version, which is how a run of undos stays one request. The
  #138 retries and error, and the store's dropping of a stale answer, are
  the same code. The ORF scan keeps its beat; it went after the sites
  anyway (item 99).

  The alternative, having the checksum wait behind the scans, would have
  needed the status bar to know what the analysis is doing; sending the
  scan earlier needed one flag. A non-mappable edit (reverse complement,
  set origin) also leaves no analysis and so is sent at once; those are
  single commands, not runs.

- **`reverseComplement` writes bytes** (`core/sequence/alphabet.ts`): a
  128-entry table of character codes, the result decoded once. Any code
  past ASCII sends the whole string to the old loop, so output is the same
  for every input; a property test holds it to the character loop on
  random IUPAC text of both cases mixed with gaps, digits, punctuation and
  text outside ASCII, and on every ASCII code. Every caller benefits (the
  ORF scan's reverse strand among them), not only the checksum.
- **The worker digests with `crypto.subtle`.** `moleculeChecksumAsync`
  (`core/checksum/seguid.ts`) builds the same canonical string as
  `moleculeChecksum` and hands it to `sha1Base64UrlAsync`, which uses
  `crypto.subtle.digest('SHA-1')` and falls back to our SHA-1 when
  `crypto.subtle` is missing (outside a secure context) or the digest
  throws. The worker's `handleAnalysisRequestAsync` answers `checksum` with
  it. The main thread keeps the synchronous one, which most callers need
  (item 97's reasons stand). Tests: the async values equal the sync ones
  for circular, linear, sticky, protein and empty molecules and a 300 kb
  sequence, with `crypto.subtle`, without it, and with a failing digest;
  the golden SEGUID vectors are untouched.
- **The worker starts while the page is idle** after its first paint:
  `main.tsx` calls `analysisClient.start()` from `requestIdleCallback`
  (a `setTimeout` where there is none). First contentful paint over 8
  loads of the built app: 442 ms mean with it, 445 without; the worker's
  script is fetched about 20 ms after the paint.
- **The autosave writes when the main thread is idle.** After items 1-3
  the checksum came back as the worker handed over the scan, and the
  save it released ran before the list could be drawn: measured A/B over
  5 runs each, the list was drawn about 150 ms sooner at 4.64 Mb (about
  20 ms at 1 Mb, within the noise) with the save moved out of the way. `autosaveDocument` now waits for an idle callback
  between the checksum and the write (the next task where there are no
  idle callbacks, as in jsdom and Safari).

## What it gave

`npm run bench -- --sizes 1000000,4640000 --n 3`, the Enzymes list drawn,
ms after the file was picked, mean ± SE, one machine, one session, each row
built from the tree at that commit:

| Code                                    | 1 Mb     | 4.64 Mb    |
| --------------------------------------- | -------- | ---------- |
| Before (item 100)                       | 664 ± 2  | 2,041 ± 8  |
| Fresh scan sent in the effect           | 447 ± 14 | 1,184 ± 22 |
| And the byte table and `crypto.subtle`  | 471 ± 8  | 1,336 ± 7  |
| And the worker started at app load      | 423 ± 37 | 1,252 ± 25 |
| And the autosave after an idle callback | 400 ± 4  | 1,167 ± 10 |
| The same, run again                     | 490 ± 19 | 1,183 ± 30 |

The third row is worse than the second because of the autosave the fast
checksum let in, as the issue predicted; the last rows take it out. The
1 Mb figures move by 50-90 ms between identical runs, so only the 4.64 Mb
column separates the last three rows. The autosave A/B, 5 runs each, the
same session:

| Autosave                      | 1 Mb     | 4.64 Mb    |
| ----------------------------- | -------- | ---------- |
| As soon as the checksum is in | 453 ± 8  | 1,309 ± 40 |
| After an idle callback        | 432 ± 12 | 1,155 ± 30 |

The view paints at the same time throughout (115-125 ms, 198-228 ms), and
the scroll's longest frame gap stays at 17-23 ms at 4.64 Mb (with only the
scan moved forward, the save fell in the scroll instead: 261 ms).

The checksum's steps in Node on the bench's seeded sequence (3 runs):

| Step                                  | 1 Mb      | 4.64 Mb    |
| ------------------------------------- | --------- | ---------- |
| `reverseComplement`, character loop   | 46-112 ms | 460-485 ms |
| `reverseComplement`, byte table       | 6-7 ms    | 19 ms      |
| `minimalRotation` of both strands     | 35-41 ms  | 131-133 ms |
| `TextEncoder` of the canonical string | 4-5 ms    | 15-16 ms   |
| our SHA-1                             | 40-46 ms  | 146-151 ms |
| `crypto.subtle` SHA-1 (with encode)   | 9-19 ms   | 36-44 ms   |

## What was left

- Our SHA-1 is unchanged (#273): the main thread still takes it for a
  document under 50 kb, where it is a few milliseconds, and the worker
  uses it outside a secure context.
- The main thread's receive and render of the scan (unpacking, GC, the
  Enzymes panel's memos) is 220-350 ms at 4.64 Mb by the issue's
  timeline; not touched here.
- `minimalRotation` is now the largest part of a circular checksum.
