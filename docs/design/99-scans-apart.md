# 99. The enzyme list does not wait for the ORFs

Issue #274. Status: done (1.17.x).

## What was asked

After #271 the Enzymes list was still the slowest thing at the open of a
large document: drawn about 1.1 s after the file was picked at 1 Mb and
4.2-4.4 s at 4.64 Mb, against 0.1-0.2 s to paint the view. The issue named
two causes:

1. `useAnalysis` stored the analysis from `Promise.all([cutSitesWithDigest,
orfs])`. There is one analysis worker, so the ORF scan queued behind the
   restriction scan, and the list, which does not use ORFs, waited for both:
   about 0.85 s more at 4.64 Mb.
2. The restriction scan with its digest was about 3.2 s at 4.64 Mb, but the
   marks were on the main thread, so the scan and the digest were not told
   apart.

## What was done

- **The two scans are stored as each answers.** `AnalysisState.cutSites`
  and `orfs` are null until their own scan has answered for the document,
  and each has its own carried flag (`provisional` for the sites,
  `orfsProvisional` for the ORFs). The store takes them with `setCutSites`
  and `setOrfs`; `setAnalysis` still stores both at once (a protein, and the
  tests). Either part for a version no tab holds is dropped, as before, and
  a part that arrives second keeps the first. The single cutters are ticked
  when the first sites arrive, not when the ORFs do.
- `useAnalysis` runs one effect per scan, each with the debounce, the two
  retries and the error of #138. Each effect depends on whether its own part
  is missing, not on the whole analysis, so the sites landing does not
  cancel the ORF request still in flight. When both scans give up on a
  document the error names both.
- The consumers wait on their own part: the Enzymes tab, Cloning and the
  drawn sites on the sites (null reads as "Scanning…", like no analysis);
  the ORF panel and the alignment's ORF track on the ORFs, which they did
  already for a missing analysis. `visibleCutSites` scans the ticked enzymes
  afresh while the sites are missing, as it does for carried ones. The
  Enzymes tab's memos key on the sites and the worker's digest rather than
  the analysis object, so the ORFs landing does not group and band 446,000
  sites again.
- **`sequenceMasks` reads a table.** Timing the worker's steps in Node on the
  bench's sequences (bundled 127 enzymes, 3 runs) split the 4.64 Mb scan:

  | step                           | 1 Mb       | 4.64 Mb        |
  | ------------------------------ | ---------- | -------------- |
  | `sequenceMasks`                | 82-107 ms  | 375-383 ms     |
  | forward pass per distinct site | 207-280 ms | 969-1,003 ms   |
  | `findCutSites` in all          | 346-417 ms | 1,641-1,695 ms |
  | `packCutSites`                 | 7-10 ms    | 41-45 ms       |
  | `enzymeDigest`                 | 101-166 ms | 423-445 ms     |
  | `packEnzymeDigest`             | 0-1 ms     | 1 ms           |

  `codeMask` per base (an upper-casing, a record lookup and a loop over the
  IUPAC set) was 380 ms of it. The masks of the 128 ASCII characters are now
  taken once, and anything else still goes through `codeMask`, so the two
  cannot differ (a test checks every character below the surrogates).
  `sequenceMasks` is 26-29 ms at 4.64 Mb and 5-8 ms at 1 Mb; `findCutSites`
  1,267-1,357 ms and 272-280 ms. Find (`findSequenceMatches`), Golden Gate
  and the CRISPR panel take the same masks and gain the same.

## What it gave

`scripts/bench/open-scan.ts --sizes 1000000,4640000 --n 3`, the Enzymes list
drawn, ms after the file was picked, mean ± SE, one machine, one session:

|                     | 1 Mb       | 4.64 Mb    |
| ------------------- | ---------- | ---------- |
| 1.17.1              | 1,122 ± 10 | 4,189 ± 37 |
| scans stored apart  | 1,028 ± 24 | 3,483 ± 5  |
| and the masks table | 949 ± 12   | 3,249 ± 26 |

The view paints at the same time (114-118 ms, 200-204 ms).

## What was left (#275, done in item 100)

- One Shift-And pass over the whole sequence per distinct recognition site,
  and another per non-palindromic one, is about 1 s at 4.64 Mb: a matcher
  that takes every site in one pass, or the WASM candidate, is the next
  step.
- `enzymeDigest` is about 0.43 s at 4.64 Mb, unprofiled.
- Changing the ORF minimum or the genetic code still drops the cut sites
  with the ORFs, so the restriction scan runs again for an ORF setting; the
  parts being apart now, they could drop the ORFs alone.
