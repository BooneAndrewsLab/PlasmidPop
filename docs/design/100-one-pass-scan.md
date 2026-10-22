# 100. Every recognition site in one pass

Issue #275. Status: done (1.17.x).

## What was asked

After #274 (item 99) the Enzymes list was drawn about 3.25 s after a
4.64 Mb FASTA was picked. Of the analysis worker's part, `findCutSites` was
about 1.3 s, a second of it one Shift-And pass over the whole sequence per
distinct recognition site and another per non-palindromic one's reverse
complement; `enzymeDigest` was about 0.43 s, unprofiled. And changing the
ORF minimum or the genetic code dropped the cut sites with the ORFs, so an
ORF setting ran the restriction scan again.

## What was done

- **An ORF setting drops only the ORFs.** `setOrfMinCodons` and
  `setGeneticCode` forget each open document's ORFs and keep its cut sites
  and digest; an analysis left with neither part goes. `useAnalysis` asks
  the worker for the ORFs alone, as its ORF effect already keyed on both
  settings.
- **`matchPatterns`** (`src/core/analysis/search.ts`) matches many IUPAC
  patterns in one walk over the sequence's masks. Each pattern is filed
  under every k-mer of plain bases that its most specific window of k
  positions admits (k is the shortest pattern's length, at most six: four
  with the bundled table's four-cutters). Walking the sequence keeps a
  rolling 2-bit code of the last k bases. Where those k are all A, C, G or
  T, only the patterns filed under the code can start there, less their
  window's offset, and each is checked base by base by the subset rule of
  `matchPositions`. Where an ambiguity code or a non-base is in the window,
  every pattern whose window opens with a code admitting that position's
  mask is checked the same way, so an N in the sequence still matches only
  an N in the pattern. Each pattern meets each start once, in ascending
  order, so the per-pattern lists are exactly `matchPositions`', and
  `findCutSites` builds its sites from them in the same order as before. A
  pattern shorter than four bases (a custom enzyme's) gets its own
  `matchPositions` pass.
- The pass per site stays, as `findCutSitesOnePassEach`, only as the oracle.
  Property tests hold `matchPatterns` to `matchPositions` on random masks,
  patterns and limits, and `findCutSites` to the oracle on random linear and
  circular sequences (with ambiguity codes, lower case and junk), on
  sequences with bundled sites planted (so six- and eight-cutters, Type IIS
  and Dam/Dcm-sensitive sites are matched), on circles shorter than a site,
  and with made-up enzymes: short, ambiguous, Type IIS, double cutting.
- **`enzymeDigest`** looks each enzyme name up once rather than per site,
  calls `hostMethylationAt` only for the enzymes Dam or Dcm can touch
  (91,522 of 446,034 sites at 4.64 Mb; for the rest it returned nothing
  after two lookups), and takes the lengths from `fragmentLengths`, which
  sorts the cuts and lengths as typed arrays instead of making a fragment
  object per piece. Property tests hold it to item 98's digest and
  `fragmentLengths` to `digestFragments`, which everything else still cuts
  with.
- **No WASM.** The one-pass matching is 0.19 s at 4.64 Mb, under a tenth
  of the time to the drawn list; the candidate CLAUDE.md names for genome
  scans is not justified by this profile.

## What it gave

The worker's steps, timed in Node on the bench's seeded sequences (127
bundled enzymes, linear, 3 runs; the first run of each size is the slow end
of each range, warming up):

| step                              | 1 Mb       | 4.64 Mb        |
| --------------------------------- | ---------- | -------------- |
| a Shift-And pass per pattern      | 240-321 ms | 1,114-1,153 ms |
| `matchPatterns`, the same matches | 40-52 ms   | 183-194 ms     |
| `findCutSites`, before            | 271-344 ms | 1,280-1,298 ms |
| `findCutSites`, after             | 74-104 ms  | 362-448 ms     |
| `enzymeDigest`, before            | 93-138 ms  | 423-430 ms     |
| `enzymeDigest`, after             | 52-119 ms  | 236-247 ms     |

`scripts/bench/open-scan.ts --sizes 1000000,4640000 --n 3`, the Enzymes
list drawn, ms after the file was picked, mean ± SE, one machine, one
session:

|                   | 1 Mb     | 4.64 Mb    |
| ----------------- | -------- | ---------- |
| before (item 99)  | 930 ± 9  | 3,272 ± 24 |
| one-pass matching | 729 ± 25 | 2,172 ± 29 |
| and the digest    | 683 ± 27 | 2,101 ± 18 |

The view paints at the same time (115-120 ms, 205-210 ms).

## What was left

The list is still drawn 2.1 s after the pick at 4.64 Mb while the worker's
scan, digest and packing now add up to about 0.65 s in Node. Where the rest
goes (reading and parsing the file, the transfer, the list's own work on
the main thread) has not been split yet. Of `findCutSites`, about 0.15 s is
building and sorting the 446,034 site objects, not matching.
