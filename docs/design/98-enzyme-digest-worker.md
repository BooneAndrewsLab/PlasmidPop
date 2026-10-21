# 98. The enzyme list's digest is taken in the analysis worker

Issue #271. Status: done (1.17.x).

## What was asked

The profile behind design note 96 put a second large task after the open
of a large document: when the restriction scan came back, drawing the
enzyme list was 165 ms of main thread at 300 kb and 317-330 ms at 1 Mb,
"mostly the Enzymes panel's memos". The issue asked what was expensive —
the digest results, the row build or the render — and for the computation
to move into the analysis worker or the list to be virtualised.

## What was measured

The list was already windowed (item 20's `useRowWindow`; 26 rows in the
first window), so the render was not the rows' number. The CPU profile
(`scripts/bench/open-profile.ts`, which now names an anonymous frame by its
line in the unminified bundle, so a memo can be told from another) put the
1 Mb task, 269-293 ms over three runs, in four places
(`docs/perf-notes.md`):

- about 65 ms in the `groups` memo, which built a `DigestProfile` for
  every enzyme from its sites: `digestFragments` makes an object per cut
  and `gelProfile` sorts the lengths, 96,200 of them in all;
- about 60 ms in the `blocked` memo, `hostMethylationAt` and `getEnzyme`
  over every site, and in the `cuts` closure that `pairable` ran over every
  site of every enzyme, each building a `${enzyme}:${cut}` key;
- about 40 ms of `Number.prototype.toLocaleString` in the render: in
  Chromium it makes a fresh `Intl.NumberFormat` per call, 14 µs against
  0.7 µs for one made once, with the same output. Node caches it, which is
  why a Node benchmark would not have shown this;
- the rest in the first row's `offsetHeight` (the layout), React and the
  garbage collector.

In Node the same arithmetic at 1 Mb is 51 ms for the profiles, 58 ms for
the methylation marks and 55 ms for the key strings, and the banding of
lengths that come already sorted is 5.7 ms: the sort and the objects were
the profile's cost, not the bands.

## What was done

- `enzymeDigest` in `core/analysis/enzymeDigest.ts`: for a scan's sites,
  the Dam/Dcm marks inside each site as one byte (`hostMarksBits` in
  `methylation.ts`; `hostStateBits` makes a host a mask, so a site is
  blocked when the two AND to something, which is `blockedByHost` without
  an array per site), each cutting enzyme's fragment lengths longest
  first, and its site count. It is the same `hostMethylationAt` and
  `digestFragments` the panel called, so the marks, the profiles and the
  single cutters the store ticks are what they were; the tests compare
  them against the old path on sequences with Dam and Dcm inside sites and
  a site across the origin.
- The worker's `cutSites` request takes `digest: true` and answers with the
  digest packed (`packEnzymeDigest`): the marks as they are, the lengths
  end to end in the packed sites' enzyme order with an offset per enzyme,
  the counts per enzyme, all transferred. `analysisClient.cutSitesWithDigest`
  asks and unpacks; `useAnalysis` uses it and `setAnalysis` keeps the
  digest on the `AnalysisState`.
- The panel's `groups` memo takes the digest's lengths through `gelProfile`
  (whose sort is linear on sorted input) and keeps the marks per site
  beside the sites; `blocked` is a `Set` of site objects; the render reads
  a site's marks instead of computing them; `pairable` stops at an enzyme's
  fourth open cut rather than filtering its thousands; `describeSite`,
  `describeBands`, `bandProblems`, `bandLabel` and `formatLength` format
  through one `Intl.NumberFormat` (`formatInt` in `core/format.ts`).
- The store's first-result count of single cutters is the digest's when
  there is one (10 ms over 96,000 sites otherwise), and the two views skip
  filtering the sites when nothing is ticked, which for a large document
  is the usual state.
- A result carried through an edit (`carryAnalysis`) has no digest: its
  sites have moved and the fragments with them, so the panel takes
  `enzymeDigest` inline from the carried sites, as it always did, and the
  worker's answer replaces it. Nothing is shown from a digest of another
  document: the digest is on the analysis, which the panel already refuses
  unless it is the present document's.

The task is 86-95 ms at 1 Mb, 80-91 ms at 300 kb and 197-214 ms at 4.64 Mb
(from 884-955 ms); the list is drawn 180 ms sooner at 1 Mb in the bench.

## What was left

- What remains of the task at 1 Mb is the layout forced by measuring the
  rows, grouping 96,000 sites by enzyme, the banding of their lengths and
  React's render; a profile built only for the rows on screen and for the
  "Band separation" sort would take the banding out of it.
- Typing in a large document with the panel open still takes the digest
  inline on every keystroke, from the carried sites; carrying the marks
  through the edit and leaving only the profiles to recompute would halve
  that.
- Unpacking the digest's lengths into arrays costs the task that takes the
  worker's answer 7 ms at 1 Mb and 27 ms at 4.64 Mb; `gelProfile` could
  take a typed array view instead.
