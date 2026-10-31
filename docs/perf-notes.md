# Performance notes

Measurements that back the "plain TS first, WASM only when justified" rule
in CLAUDE.md. Re-run the quoted test and update this file when the
implementation changes.

## Pairwise alignment (Gotoh affine, global)

| Date       | Input            | Cells | Time   | Where                                   |
| ---------- | ---------------- | ----- | ------ | --------------------------------------- |
| 2026-09-17 | 3,000 × 2,940 bp | 8.8 M | 278 ms | Node 24 (V8), `pairwise.test.ts` perf   |
| 2026-09-18 | 3,000 × 2,940 bp | 8.8 M | 1.8 s  | GitHub Actions ubuntu-latest runner     |
| 2026-09-23 | 5,000 × 5,000 bp | 25 M  | 820 ms | Node 24, packed traceback (was 960 ms)  |
| 2026-09-23 | 12,000 × 10,409  | 125 M | 3.2 s  | Node 24, local, one strand, 220 MB RSS  |
| 2026-09-23 | 12,000 × 10,470  | 2.3%  | 59 ms  | Node 24, banded (#51), `banded.test.ts` |

About 26 ns per cell including traceback bookkeeping, one byte per cell of
traceback memory (three until 2026-09-23, item 45). The 12 kb row is a
noisy (≈7% error) reverse-strand read against a random plasmid, the case a
user reported; the strand was picked by 11-mer count, so one alignment ran
instead of two. The in-browser limit is 150 M cells (roughly 12 kb × 12 kb,
150 MB) and alignment runs in the analysis worker so the UI never blocks.

Past 25 M cells a read is aligned in a band around the 15-mers it shares
with the reference (item 46): the last row is a 3% error read against its
plasmid, whose band held 2.3% of the matrix's cells, 55 times faster than
the full fill of the row above. The one fill serves both, the full matrix
being a band of every cell; that cost about 5% on a 5 kb × 5 kb full
alignment (722 ms against 690 ms, mean of six).

Decision: no WASM for v1. Plasmid-scale alignments finish in well under a
second and a 10 kb read, banded, in a tenth of one. The limit was the
quadratic algorithm, not the language.

## A plate of reads (Align all, #59, 2026-09-24)

96 Sanger-like reads of 700–900 bases (poor first 30 and last 80 bases,
1% error between, half reversed, some through the origin) against a 5 kb
circular plasmid, local, trimmed at 5%, one after another as the batch
runs them (`readBatch.timing.test.ts`, Node 24, the worker's code run
inline, three runs each):

| Path                                                        | 96 reads    | per read |
| ----------------------------------------------------------- | ----------- | -------- |
| as a single alignment: both strands in full below 4 M cells | 12.9–13.0 s | 135 ms   |
| `fast`: strand by 11-mers, then banded                      | 0.52–0.59 s | 6 ms     |

A trimmed Sanger read against 5.8 kb (the plasmid with its start repeated
for the origin) is about 4 M cells, just under the size where one strand is
picked first, so a single alignment fills the whole matrix twice, about
130 ms a strand. That is nothing for one read and 13 s for a plate, so a
batch asks for `fast`: the strand is picked by shared 11-mers at any size
and the read aligned in the band, checked by its edge as for long reads.
On this plate the two paths gave the same strand, score and identity for
all 96 reads, and `strands.test.ts` checks the same on noisy reads in both
modes. The worker's round trip per read (a few kilobytes each way) is not
in these numbers and is small beside them; in the browser the batch has
not been timed.

## Checking a band's answer (#167, 2026-10-06)

The band can miss the optimum without its path touching the edge (tandem
repeats, a long insertion near a read end), so its score is now checked:
the region any better path could reach (design note 46, "Checked against a
bound") is filled, score only, when it is at most 25 M cells. Node 24,
before and after the check, same inputs; plates are three runs each in
one process (the first is cold), single alignments a median of three.

| Input                                                        | Before            | After              |
| ------------------------------------------------------------ | ----------------- | ------------------ |
| Plate, 96 Sanger reads, 5 kb circle, trimmed at 5% (default) | 1.0, 0.71, 0.69 s | 1.19, 0.99, 0.87 s |
| same, untrimmed (30 + 80 poor bases a read)                  | 1.2, 0.99, 0.99 s | 2.1, 2.1, 2.1 s    |
| same, untrimmed, 250 poor bases at the end                   | 1.2, 1.2, 1.3 s   | 3.7, 3.7, 3.7 s    |
| Plate, 96 reads, 300 kb circle, trimmed                      | 28-29 s           | 28-29 s            |
| Plate, 96 reads, 300 kb linear, trimmed                      | 10.0-10.2 s       | 11.2-11.6 s        |
| 1 kb read (3% errors), 300 kb linear, one alignment          | 102 ms            | 268 ms             |
| same, 300 kb circle unrolled to 600 kb                       | 220 ms            | 289 ms             |
| 10 kb read (3% and 5% errors), 10.5 kb, Global               | 68 / 37 ms        | 371 / 397 ms       |
| 10 kb read, 12 kb, Local (not checked: region 118 M cells)   | 39 / 41 ms        | 42 / 47 ms         |

`readBatch.timing.test.ts` alone (one cold run): 0.96 s before, 1.15 s
after; on GitHub's runner 4.8 s before and 9.9 s on the first run after,
a run in which unrelated timings were 1.5-1.7 times their usual too. Its
budget went from 10 to 20 s, still far under aligning both strands in
full. In `banded.test.ts`, "the cost of checking a band": a 1 kb read
against a 300 kb circle unrolled, checked, 466 ms cold; a 10 kb Global
read 361 ms.

What it costs is the region, which grows with how far the band's score
falls short of a perfect match: a trimmed Sanger read leaves 0.1-2 M
cells (2.1 M for the 1 kb read above, filled in about 42 ms, ~20 ns a
cell), an untrimmed one with poor ends several times that. A local path
pays only 0.5 for each further base it deletes from the reference, so a
noisy 10 kb read in Local could in principle reach almost any cell, and
checking it would cost a full alignment (2.2-2.6 s measured when the
budget was the 150 M limit); past 25 M cells the check is skipped and the
band's answer kept, marked unchecked. Global pays for every gap base in
pairs it can no longer have as well, which keeps a 10 kb read's region at
13 M of 111 M cells.

Decision: check whenever the region is under 25 M cells, the size the
full fill is already used up to. A default plate costs about 0.2 s more
and is exact; untrimmed reads with poor ends cost more (up to 3.7 s for
250 poor bases on every read), still well under the 13 s of aligning both
strands in full. The score-only fill was barely faster than the fill with
traceback (the per-cell work is the three-state recurrence, not the
traceback byte) but needs no memory a cell and reads only the rows the
region has. The 300 kb plates' 0.1-0.3 s a read is not the check: it is
the per-read 15-mer index and encoding of the whole unrolled reference,
done again for every read. Fixed in #170, below.

### The reference kept between reads (#170, 2026-10-09)

Each read of a batch is its own call into the worker, so the reference's
15-mer index (`banded.ts`), its 11-mer bitmap (`strands.ts`) and its
upper-cased, encoded form (`pairwise.ts`, three fills a read) were built
again for every read. The last one of each is now kept and reused when the
next call's reference is equal (by value: the worker gets a new string with
every request); the encoding keeps two, since a local check fills a slice of
the reference between two fills of all of it. Node 24, 96 Sanger reads
(`readBatch.timing.test.ts`, trimmed at 5%, local, `fast`), 300 kb circle
unrolled to 600 kb:

| Input                   | Before    | After       |
| ----------------------- | --------- | ----------- |
| 96 reads, 300 kb circle | 27.3 s    | 12.9-13.3 s |
| 96 reads, 5 kb circle   | 1.1-1.4 s | 1.1-1.3 s   |

The timing test no longer asserts a wall clock (CI runners took 83-121 s for
the 96-read plate); it runs 12 reads and counts the word index's `Map.set`
calls, so an index built per read fails it. The table is a local measurement.

The word index took 200+ ms for the first read and now 1-2 ms for the rest.
What remains is the real work of each read: the band (about 0.8 M cells, 40
ms), its check (about 0.2 M cells, 15-30 ms) and the O(reference) row
tables of the band (10-40 ms), not shared between reads since they depend on
the read. Cutting that further would need a band narrower than its margin.

## Edit marks (sequence diff)

Myers' greedy O(ND) diff over the two versions, after stripping the common
prefix and suffix (`src/core/diff/sequenceDiff.ts`), then an affine-gap
re-alignment of each neighbourhood of changes (`refine.ts`). It runs on the
main thread once per edit, so the cost has to fit inside a keystroke.

| Date       | Input                                                       | Time    |
| ---------- | ----------------------------------------------------------- | ------- |
| 2026-09-19 | 4,361 bp (pBR322-sized), 20 short edits                     | 1.3 ms  |
| 2026-09-19 | 4,361 bp, 500 scattered substitutions                       | 31.4 ms |
| 2026-09-19 | 4,361 bp, two unrelated sequences (hits the step cap)       | 29.8 ms |
| 2026-09-19 | 10 kb, 16 unrelated blocks with shared 32-mers between them | 37.3 ms |

Node 24 (V8), `sequenceDiff.test.ts` perf. Cost is roughly proportional to
the edit distance D times the length, so it is the number of _edits_, not
the sequence length, that matters. `maxEdits` is 1,000 steps. Past that the
diff looks for a 32-base run occurring once in each version and splits
there, which keeps a long session with one big indel in it exact; only when
no such run exists is the differing middle reported as one replacement.
A plain insertion or deletion of any size never reaches the fill at all.
Splitting turns one hard problem into two that can each be hard again, so
the splits share a work budget of three whole-input fills; the last row
above is the shape that exhausts it.

A shortest edit script is not always the clearest one: on a four-letter
alphabet, two edits a dozen bases apart can be "explained" in fewer steps by
matching stray bases in between, which draws as a scatter of one-base marks.
Every neighbourhood of changes within 24 bases of each other is therefore
re-aligned with `alignPairwise` in global mode, whose affine gap costs
prefer one long gap to six short ones. Those windows are tiny, so the O(nm)
aligner is affordable here; neighbourhoods over ~200 × 200 bases are left as
the cheap script had them, and the re-alignments share a 250,000-cell budget
per diff. It costs about 30 % on top of the fill, worst case ~37 ms.

Nothing here is a WASM candidate; if plasmids of this size ever cost more
than a frame, move the diff into the analysis worker before reaching for
Rust.

## Restriction scanning

Full 130-enzyme scan of a 4.4 kb plasmid completes in a few milliseconds
(see `render.smoke.test.ts`, which runs the scan as part of the renderer
smoke test). Not a WASM candidate at plasmid scale.

## Colouring the bases in the sequence view

The strand text is drawn ten bases to a `fillText`, which keeps the letters
on the column grid whatever the font's real advance width is. With "Colour
the bases" on (the Format menu), each line is drawn once per colour present
with the other columns blanked out with spaces, instead of once per base.

| Date       | What                               | fillText calls | Renderer time |
| ---------- | ---------------------------------- | -------------- | ------------- |
| 2026-09-19 | one 900 px screen of pBR322, plain | 201            | 0.29 ms       |
| 2026-09-19 | the same screen, bases coloured    | 639            | 0.72 ms       |
| 2026-09-19 | all 44 rows at once, plain         | 1,066          | 3.8 ms        |
| 2026-09-19 | all 44 rows at once, coloured      | 3,460          | 4.4 ms        |

Node 24 (V8) with a stub drawing context, so this is the renderer's own work
and the string masking, not text rasterization; the view only ever draws the
rows in the window, the first line of the table. One fill per base would be
~1,800 calls for that screen, which is the reason for the masking. The cost
test in `render.smoke.test.ts` fails if colouring ever grows past a small
multiple of the plain path.

## Golden Gate assembly

The Cloning tab works the reaction out on the main thread, in a `useMemo`
that re-runs whenever the enzyme or the ticked parts change, rather than in
the analysis worker. The panel has to answer while the user is ticking
boxes, and it is one enzyme over a handful of plasmids rather than the full
table over one.

| Date       | Reaction                              | Product   | Time   |
| ---------- | ------------------------------------- | --------- | ------ |
| 2026-09-19 | 4 kb vector + 2 inserts of 1 kb, BsaI | 6,012 bp  | 2.2 ms |
| 2026-09-19 | 8 kb vector + 5 inserts of 2 kb, BsaI | 18,024 bp | 5.2 ms |

Node 24 (V8), mean of 20 runs. That covers the digest of every part, the
walk over the overhangs, and building the product document. Both are inside
a frame, so nothing is gained by moving it off the main thread; if parts
ever arrive in the dozens, the digest is the half that grows and belongs in
the worker with the rest of the restriction scanning.

## Gibson assembly

Cheaper than the Golden Gate above it, because there is nothing to digest:
the whole reaction is a search for the longest shared end between each
ordered pair of parts. That is one prefix-function pass over the shorter
part's length per pair, linear and uncapped since #134 (it was `maxOverlap`
= 60 string comparisons per pair, which missed any longer overlap).

| Date       | Reaction                        | Product   | Time   |
| ---------- | ------------------------------- | --------- | ------ |
| 2026-09-22 | 6 parts of 2 kb, 30 bp overlaps | 12,000 bp | 1.0 ms |
| 2026-10-05 | same, uncapped search (#134)    | 12,000 bp | 5.1 ms |

Node 24 (V8), `gibson.test.ts` perf, mean of 10 runs, including building the
product document. The 2026-10-05 row is a warm mean of 20 runs, in which the
capped search measured 3.0 ms, so the uncapped one costs about 2 ms more. Six parts is the practical ceiling of the one-step
protocol, so this is the large case rather than a worst case. It runs in the
same main-thread `useMemo` as the Golden Gate, for the same reason.

## Primer design

`designPrimers` runs on a click, not per keystroke. With the settings'
filters (hairpin, 3′ dimer) it takes about 125 ms for a 600 bp target on a
4.4 kb circle and 110 ms on 50 kb. The specificity check
(`requireSpecific`, on by default) scans the whole template once per
shortlisted candidate, in penalty order and only until 40 of each strand
are found (at most 400 checks): +5 ms on 4.4 kb, +260 ms on 50 kb, measured
2026-09-22 over five runs on a random template. If that ever needs to come
down, index the template's 3′-anchor 5-mers once instead of rescanning.

## PCR

Two walks over the template per primer — one for each strand — and a walk
stops at the first base that does not pair, so all but a handful of the 2 L
starting positions cost a single character comparison. Building the product
documents is the rest of it.

| Date       | Template  | Products | Time    |
| ---------- | --------- | -------- | ------- |
| 2026-09-22 | 4,361 bp  | 1        | 2.1 ms  |
| 2026-09-22 | 13,800 bp | 1        | 3.3 ms  |
| 2026-09-22 | 50,000 bp | 1        | 11.3 ms |
| 2026-09-22 | 50,000 bp | 7        | 14.2 ms |

Node 24 (V8), mean of 20–50 runs; the last row is `pcr.test.ts` perf, where
the two primers also prime in enough other places to give six more products.
The test's budget is 500 ms on the median of 20 runs, a margin for slow shared
CI runners (#249) that a quadratic walk would still blow through. Linear in the length, as
the walk says it should be, and the extra 3 ms of the last row is six more
product documents rather than more searching.

The panel runs it in a main-thread `useMemo` on every keystroke in either
primer box, like the Golden Gate and Gibson panels above it. At plasmid
scale that is 2 ms per character typed, which is inside a frame; a 50 kb
template is not, and would want debouncing or the worker if anyone amplifies
from one.

Note the seven products: over 100 kb of searchable strand, a 15-base 3′
match with two mismatches turns up by chance. That is not a modelling error
— a long template really does prime in more places — and it is why the
products are ordered by mismatches first and capped at `maxProducts`.

## Restriction scanning with an imported enzyme table

The bundled table is 127 enzymes. A REBASE `withrefm` import (see the user
guide, "Enzymes") is 1,581 — every enzyme in REBASE 609 whose cut position
is known and which cuts on one side of its site — of which 577 are sold by
somebody. Reading the 4.4 MB file takes 110 ms, once, on import.

Scanning pBR322 (4,361 bp, circular), Node 24 (V8), mean of 10–20 runs:

| Date       | Enzymes                  | Scan    |
| ---------- | ------------------------ | ------- |
| 2026-09-19 | 127 (bundled)            | 7.3 ms  |
| 2026-09-19 | 577 (REBASE, commercial) | 17.7 ms |
| 2026-09-19 | 1,581 (REBASE, all)      | 82.5 ms |
| 2026-09-19 | 1,581 over 52 kb         | 1.04 s  |

All of it runs in the analysis worker, so these are not frames dropped; the
Enzymes tab says "Scanning for restriction sites…" until the answer comes
back. A plasmid stays comfortable even with everything imported.

`findCutSites` matches once per distinct recognition sequence rather than
once per enzyme, because isoschizomers are rife: those 1,581 enzymes have
only 346 distinct sites between them. That took the full scan from 134 ms
to 82 ms — less than the 4.5x the pattern count suggests, because matching
is no longer the whole cost. A full scan of pBR322 returns **63,053** cut
sites, and allocating, sorting and structured-cloning those back to the main
thread is now the larger half. Narrowing the scan to what the panel is
actually showing (the supplier filter, or the ticked enzymes) is the next
thing to try if this ever needs to be faster; it would cut both halves at
once.

### Shift-And matching and packed results (2026-09-23)

Measured again for #20, the scan was not what the paragraph above says any
more: pBR322 against the table imported now returns **10,485** sites, not
63,053 (the larger count predates `MIN_SITE_BITS`, which dropped AbaSI and
kin). Scanning one enzyme per isoschizomer group — 422 of them — still took
27 of the 36 ms, so the matching was the cost, not the allocation, and
narrowing the scan to the supplier filter would have saved a third of it at
the price of re-scanning on every change of the filter.

Three changes instead, none of which changes what is found:

- `matchPositions` uses **Shift-And** for patterns of up to 31 bases: one
  shift and one AND per base per pattern, against a comparison per pattern
  base before. That also speeds up Find and primer binding, which use it.
- `findCutSites` breaks ties in its sort by a name rank computed once,
  not by `localeCompare` per comparison; isoschizomers put a dozen
  enzymes on one cut, so there are many ties.
- The worker sends the sites **packed** as an `Int32Array` of four numbers
  each plus the enzyme names (`packCutSites` in
  `src/workers/analysisProtocol.ts`), and transfers the buffer. A
  structured clone of 110,000 objects cost 183–235 ms, about half of it
  rebuilding them on the main thread; packing and unpacking cost 8 ms each.

Node 24 (V8), circular, mean of 10 runs; "52 kb" is a random sequence.
Before and after, scan plus handover (clone before, pack + unpack after):

| Sequence | Enzymes                  | Sites   | Scan before | Scan after | Handover before | Handover after |
| -------- | ------------------------ | ------- | ----------- | ---------- | --------------- | -------------- |
| pBR322   | 127 (bundled)            | 462     | 7.1 ms      | 2.8 ms     | 0.8 ms          | 0.3 ms         |
| pBR322   | 587 (REBASE, commercial) | 3,916   | 17.4 ms     | 6.4 ms     | 6.8 ms          | 0.4 ms         |
| pBR322   | 1,581 (REBASE, all)      | 10,485  | 35.8 ms     | 14.3 ms    | 16.0 ms         | 1.1 ms         |
| 52 kb    | 127 (bundled)            | 4,984   | 77.4 ms     | 21.8 ms    | 8.9 ms          | 0.4 ms         |
| 52 kb    | 1,581 (REBASE, all)      | 109,638 | 408 ms      | 116 ms     | 235 ms          | 15.6 ms        |

A full REBASE scan of a 52 kb construct went from about 640 ms to 130 ms.
What is left is mostly pushing a `CutSite` per cut for every isoschizomer;
sharing one set of cuts per group would be the next step, and would mean
changing what `CutSite[]` consumers are handed.

### Reading the bands off each enzyme

The Enzymes tab works out what every enzyme's own fragments would look like
on a gel (`gelProfile` in `src/core/analysis/gel.ts`), not just the enzymes
whose rows are on screen, because the list can be ordered by how far apart
the bands are. That is a sort of each enzyme's cut positions plus one walk
down them.

| Date       | Enzymes                       | Time    |
| ---------- | ----------------------------- | ------- |
| 2026-09-22 | 1,581 (REBASE), ~40 cuts each | 35.8 ms |

Node 24 (V8), `gel.test.ts` perf; the bundled 127-enzyme table is about a
fortieth of that. It runs in a `useMemo` on the main thread, keyed on the
analysis and the enzyme table rather than on the filter boxes, so it is paid
once when a scan comes back and not while anything is being typed. Left
where it is: the scan it follows costs 82 ms in the worker, and moving 36 ms
of arithmetic there to save a single frame after it would mean sending a
profile per enzyme back across the wire.

### Ranking double digests

`bestPairs` (`src/core/analysis/gel.ts`) judges every pair of the listed
enzymes that cut at most three times by the digest with both, so it is
quadratic. The first cut built a `Set` and a full `digestFragments` per pair
and took 111 ms for 200 enzymes; merging the two sorted cut lists, going
straight to lengths and rejecting an unreadable lane before building its
profile (most pairs of a big table are one) brought that to 36 ms warm.

| Date       | Enzymes paired | Pairs  | Time    |
| ---------- | -------------- | ------ | ------- |
| 2026-09-22 | 120            | 7,140  | 14.4 ms |
| 2026-09-22 | 200            | 19,900 | 36.0 ms |

Node 24 (V8), `gel.test.ts` perf. The Enzymes tab pairs at most 120, fewest
cuts first, and recomputes only when the names listed change, not on each
render. The bundled table on pBR322 lists 49 such enzymes (1,176 pairs), so the
usual cost is a few ms.

### Rendering the list of rows

`EnzymePanel` used to put at most 200 rows in the DOM and cut the rest off,
because a row per enzyme locked the page up for seconds. The list is now
windowed (`useRowWindow` in `src/app/components/`): it scrolls inside the
panel, and only the rows over the viewport plus 600 px either side are
rendered — 22 to 34 of them on pBR322 in Chrome, whatever the size of the
table behind them. Rows are not all the same height, since a row's cut
positions wrap onto as many lines as they need (49, 67 and 86 px on pBR322),
so each is measured as it is rendered and remembered by name; a row never
yet seen is assumed to be 46 px, which shows up only in the length of the
scrollbar. The 600 px of slack is there because the scroll position reaches
React a frame after the browser has painted it, and a window that ended at
the viewport's edge would show a band of nothing until it caught up.

## The preview overlay

A preview (a primer pair, every match of a find) is packed into lanes and
turned into a per-row count before the linear layout is rebuilt, and that
happens on every keystroke in the find bar. Measured 2026-09-21 in Node 24,
mean of 20 runs: **1.65 ms** for the worst case the app allows — a 101 kb
sequence (1,690 rows of 60 bases) with 200 previewed spans, which is the cap
the find bar draws up to. A designed primer pair on a plasmid is three spans
over ~70 rows and does not register.

Two things keep it cheap. `packLanes` is the same greedy interval colouring
the features use, and a preview has a handful of spans rather than the
hundreds a REBASE scan produces; `overlaysPerRow` walks each span's rows
once. The cap in the find bar is there for legibility rather than speed — at
200 dashed boxes the view says nothing that the count does not say better.

## Map labels

The label ring is laid out on every render, and the map is redrawn whenever
the pointer moves onto or off a feature, so the pass has to be cheap at the
densities a REBASE import makes possible. Each label is placed in rank order
at the free slot nearest its anchor, which means testing its box against the
boxes already taken; those are filed by horizontal band (two line heights),
so a candidate is only compared with what is near its own y rather than with
everything placed so far. Item 31 added two more tests per slot: whether it
keeps the ring's order against the slots its neighbours took, and whether the
leader line back to the elbow would cross one already drawn (filed the same
way, by the stretch of ring a leader runs over).

Measured 2026-09-21 in Node 24 on pBR322 with every feature named (50 of
them), the whole map rendered through `SvgContext` at 900 × 700, mean of 150
runs:

| labels on the ring                                     | render |
| ------------------------------------------------------ | ------ |
| 6 features, no cut sites (a real pBR322)               | 0.7 ms |
| 50 features                                            | 1.1 ms |
| 50 features, 35 single cutters                         | 1.4 ms |
| 50 features, 123 cut positions                         | 1.6 ms |
| 50 features, every cut site of all 127 bundled enzymes | 3.5 ms |

The last row is not a case the app puts in front of anyone — the Enzymes tab
ticks single cutters and only up to `MAX_DEFAULT_ENZYMES` of them — but it is
the shape of the worst case, and it stays inside a frame. Banding the boxes
took it from 8.8 ms to 6.5 ms and left everything else where it was; most of
what remains is building the SVG string, which the canvas does not do. Item
31's two tests cost nothing measurable and the worst case came _down_ to
3.5 ms with them: the shorter slide they came with (eight line heights where
it had been sixteen) halves the slots a crowded label tries, and the order
rule cuts the search short as soon as a neighbour's slot is reached.

Spreading crowds about their centre first (#24, item 31) costs some of that
back. Measured 2026-09-24 the same way, mean of 150 runs after 30 to warm up,
before and after:

| labels on the ring                 | before | after  |
| ---------------------------------- | ------ | ------ |
| 50 features                        | 1.0 ms | 1.4 ms |
| 50 features, 35 single cutters     | 1.5 ms | 1.9 ms |
| 50 features, every cut site of all | 4.0 ms | 6.4 ms |

The second label ring (#23) adds a pass for what the first ring could not
place; after it, measured the same way: 1.7 ms for 50 features, 2.3 ms with
35 single cutters, 7.8 ms with every cut site of all 127 enzymes. Searched
at the first ring's resolution and to the end it took 15.8 ms there; the
outer ring's grid is coarser (three-quarters of a line) and the pass stops
after 24 labels in a row find no room.

The first cut of the spread took 38.7 ms in the last row: trimming an
overfull crowd re-spread it once per label left out, and every merge
re-centred the whole cluster. A cluster now keeps its span and the sum its
centre is found from, so a merge is constant time, and a tenth of an
overfull crowd is trimmed per round, at most 16 rounds.

### Tracked changes on the ring

Item 25 draws the same `DocumentDiff` the sequence view marks — an arc over
the backbone per mark, a wedge per deletion, an outline per touched feature.
There is nothing to lay out: the diff is already computed for the sequence
view (and shared through `editDiffBetween`'s one-slot cache), and each mark
is one arc at a radius that is known. Measured the same way, on the real
pBR322 at 900 × 700, mean of 150 runs:

| marks on the ring           | render |
| --------------------------- | ------ |
| none (`edits` null)         | 0.6 ms |
| 10 marks and 10 deletions   | 0.7 ms |
| 200 marks and 200 deletions | 2.4 ms |

A session's editing gives a handful of marks; 200 is well past what the
Myers diff and its re-alignment produce for anything a person typed, and it
is still inside a frame. A diff too coarse to follow is one mark, not
thousands, so the pathological case is bounded from the other side too.

Removed features drawn as ghosts, and the ring made clickable (#27, item
25), measured 2026-09-24 the same way (pBR322 at 900 × 700, mean of 150 runs
after 30 to warm up). The ghosts are an outline each in a lane that
`lanesWithGhosts` packs after the live features; the pointer test,
`changeAt`, runs on every move over the map:

| on the ring                           | render  | lanes   | pointer test |
| ------------------------------------- | ------- | ------- | ------------ |
| none                                  | 0.65 ms | —       | 1 µs         |
| 10 marks, 10 deletions                | 0.62 ms | —       | 2 µs         |
| 10 marks, 10 deletions, 10 ghosts     | 0.65 ms | 0.06 ms | 8 µs         |
| 200 marks, 200 deletions              | 1.8 ms  | —       | 5 µs         |
| 200 marks, 200 deletions, 50 ghosts   | 1.8 ms  | 0.09 ms | 20 µs        |
| a session: 2 CDSs removed, 300 bp cut | 0.62 ms | 0.02 ms | 4 µs         |

Nothing to see: an outline is two arcs, and the lanes are one greedy pass
over the ghosts against what the live features already hold. Fifty ghosts
scattered at random took the map from 4 lanes to 7; the session's two fit in
the gaps the removed CDSs left.

## Molecule checksums (SEGUID v2)

`documentChecksum` is taken on the document in front every time it changes —
the status bar shows it — so it sits on the same path as a keystroke, beside
the edit-mark diff above. The work is three passes over the sequence and a
SHA-1 over twice it: Booth's minimal rotation of each strand, and the digest
of `watson;crick`.

| Date       | Input                      | Time    | Where                     |
| ---------- | -------------------------- | ------- | ------------------------- |
| 2026-09-22 | 4,361 bp circular (pBR322) | 0.92 ms | Node 24, `seguid.test.ts` |
| 2026-09-22 | 200,000 bp circular        | 21.5 ms | Node 24, `seguid.test.ts` |

Linear in the length, as the algorithm says it should be. Two things brought
the plasmid case down from 1.12 ms, both of them arithmetic rather than
structure, and both are safe because the published test vectors say what the
answer has to be:

- The second strand is rotated to follow the first (two slices) instead of
  being reverse-complemented again, which is what the reference
  implementations do and what the first cut here did not.
- Booth's loop compares code units rather than characters. Every symbol
  involved is ASCII and `-` (45) sorts below every base, which is the order
  SEGUID's staggered ends need anyway.

The remaining cost is split about evenly between the two rotations, the
reverse complement that builds the second strand, and the digest. The status
bar memoizes on the document, so a render that changes nothing else costs
nothing; `Compare with…` takes three more, once, when the dialog opens.

WASM would be the obvious next step and is not worth it: 0.9 ms is a fifteenth
of a frame on a plasmid, and the 200 kb case is past the scale of anything
this app targets (>10 Mb is a non-goal; 200 kb is already ten pBR322s of
BAC).

## Partial digest (#10, 2026-09-23)

`partialDigest` on pBR322 (J01749) with its 35 single cutters, in Vitest on
Node 24, warm:

| pieces cut out                               | time       |
| -------------------------------------------- | ---------- |
| all 1,225                                    | 175–245 ms |
| longest 300                                  | 47–107 ms  |
| 200 that miss the fewest sites (the panel's) | 10–20 ms   |
| three sites of one enzyme, all 9             | 1.2 ms     |

Almost all of it is `fragmentFromRange` building each piece's document
(bases, features, interval tree); listing the stretches and sorting them is
nothing. The pieces that miss the fewest sites are also the shortest, which
is why keeping those is faster than keeping the longest as well as closer to
what the tube holds. It runs in the Cloning tab's main-thread memo only while
**Partial digest** is ticked; the realistic case — one enzyme, a few sites —
is a millisecond.

## Gibson warnings (#12, 2026-09-23)

`gibson` on six parts with 25 bp overlaps, mean of 20 warm runs, Vitest on
Node 24:

| tube      | without warnings | with    |
| --------- | ---------------- | ------- |
| 6 × 2 kb  | 1.4 ms           | 2.7 ms  |
| 6 × 10 kb | 2.7 ms           | 10.2 ms |

The repeat search is one pass per strand of every part, looking up a rolling
2-bit code of 15 bases in a map of the junction windows. Two earlier cuts
were slower: a map of every k-mer in the tube (13 ms at 6 × 2 kb, the
allocation of 24,000 substrings) and one `indexOf` per window per strand
(6.5 ms). A `?? []` in the inner loop, a fresh array for every base, cost about 4 ms
by itself.

## The Bench's product column (item 49)

The Bench draws the open reaction's product and ranks enzymes to check it
by, on the main thread and only when the product changes. Single warm runs,
Vitest on Node 24, the bundled table (127 enzymes):

| step                         | pBR322, 4.4 kb | 13 kb |
| ---------------------------- | -------------- | ----- |
| `findCutSites`, every enzyme | 4 ms           | 9 ms  |
| `exportMapSvg` at 360 px     | 25 ms          | —     |

Too little for a worker round trip. An imported REBASE set is larger, and
the scan grows with it; if that is measured to hurt, the product can be
scanned by the analysis worker instead.

## The stored undo history (item 51, 2026-09-24)

Two sessions of 200 steps each — runs of typing (1–30 bases, coalesced),
deletes, feature renames, one reverse complement and one set origin — on a
circular document, single warm runs, Vitest on Node 24:

| step                                           | 10 kb, 12 features | 1 Mb, 1,000 features |
| ---------------------------------------------- | ------------------ | -------------------- |
| encode, next keystroke (one new delta)         | 0.5 ms             | 5 ms                 |
| encode, nothing new (every delta remembered)   | 0.2 ms             | 0.2 ms               |
| encode, all 200 deltas from nothing            | 24 ms              | 780 ms               |
| structured clone of the row (IndexedDB's copy) | 1.5 ms             | 8 ms                 |
| decode, all 200 states                         | 14 ms              | 310 ms               |
| `writeGenBank`, the check on load              | 3 ms               | 27 ms                |
| `parseGenBank` of the same, for scale          | 11 ms              | 38 ms                |
| open the stored document, states deferred      | —                  | 50 ms                |
| stored size (`storedSize`)                     | 42 KB              | 1.24 MB              |

The encode from nothing never happens in use: each autosave works out only
the delta of the step it has not seen (`deltaCache`), and a row read back
seeds the cache. It was 1.6 s before the prefix and suffix were compared
4 KB at a time (`===` on two slices is a memory compare; a `charCodeAt`
loop was 19 ms per megabase pair), and 12 ms rather than 5 for the next
keystroke. The decode is dominated by moving a thousand features for each
of the replayed edits and validating each state, the same work the edits
did in the session; it runs once per restored tab.
`historyCodec.timing.test.ts` keeps budgets on the keystroke (1 Mb, 100
features), the 10 kb decode and the deferred open.

**The states are no longer rebuilt on the way in** (#83, 1.8). The document
comes from its own row, parsed and checked, which is the 50 ms above; the
200 states are rebuilt straight after the tab is on screen (`setTimeout`,
not an idle callback, so Undo is not empty while the user reads), or sooner
if an edit, an undo or a jump asks for them first. So a restored session
pays a parse per tab before its first paint and the 300 ms after it, per
tab, rather than before. Rebuilding is unchanged in cost: the work is the
thousand features moved for each replayed edit.

## Finding a primer collection (#64, item 56, 2026-09-25)

500 primers of 18–30 nt, half from the template and a tenth with a 16 nt
5′ tail, against a random circular template, single warm runs, Vitest on
Node 24 (`collection.timing.test.ts`):

| template | `findAnnealingSites` per primer, walking every base | with `buildAnnealIndex` |
| -------- | --------------------------------------------------- | ----------------------- |
| 10 kb    | 3,253 ms                                            | 163 ms                  |
| 200 kb   | 78,440 ms                                           | 606 ms                  |

The walk tries both strands at every base for every primer; the index of
5-mers, built once per search, tries a primer only where its exact 3′
anchor stands. What is left is mostly building the sites (a Tm each) and
the lookups. It runs in the analysis worker. PCR, with two primers, still
walks.

## Detect features (item 59, 2026-09-25)

| Input                                  | Library                 | Time   | Where                                      |
| -------------------------------------- | ----------------------- | ------ | ------------------------------------------ |
| 1 Mb random, circular, 8 parts planted | 109 parts (partial)     | 286 ms | Node 24, map lookup per 12-mer             |
| same                                   | 109 parts               | 47 ms  | Node 24, bitmap before the map             |
| same                                   | 227 parts, 131,847 bp   | 127 ms | Node 24, `detect.test.ts`                  |
| same                                   | 255 parts, 100 proteins | 888 ms | Node 24, protein match on strings (#93)    |
| same                                   | 255 parts, 100 proteins | 113 ms | Node 24, protein match in codes (#93)      |
| same                                   | 269 parts, 100 proteins | 538 ms | Node 24, gapped fill per failed seed (#94) |
| same                                   | 275 parts, 100 proteins | 171 ms | Node 24, gapped where seeds gather (#94)   |

Both strands, 95% identity. Every 12-mer of the sequence is looked up;
nearly all are in no part, and a 2 MB bitmap of the words the library holds
says so six times faster than the `Map` of their positions did. A seed then
costs one diagonal check that gives up after a handful of mismatching bases,
so what remains grows with the number of chance seeds, i.e. with the
library's size. The index (the 12-mers at ~260,000 positions on both strands) is built
once per worker and kept. The library itself is a lazy chunk: 109 kB
(31 kB gzipped) for the core and 70 kB (12.6 kB gzipped) for the FPbase
file, fetched the first time Detect features runs.

Matching the parts that carry a protein (#93, 1.8) translates the sequence
in six frames and seeds on five residues. Written the obvious way — six
strings and a `slice` per position — that cost 780 ms on top of the DNA
search, most of it in allocating two million five-character strings. Filling
the frames as arrays of five-bit residue codes and rolling the seed word
through them, with the same kind of bitmap before the map, brought the whole
search back to 113 ms: 16 ms over the DNA search alone, for a hundred more
proteins.

Gapped matching (#94, 1.10), measured 2026-10-02 on one machine against
the code before it with the same 275-part library, alternating runs:

| Run (1 Mb, circular, 8 parts planted) | Before (substitutions) | With indels |
| ------------------------------------- | ---------------------- | ----------- |
| First full run (50 kb warm-up before) | 146–154 ms             | 169–174 ms  |
| Warm, median of 7                     | 99–103 ms              | 101–103 ms  |
| Warm, DNA search only, median of 7    | 41–42 ms               | 46–52 ms    |

The first version ran a banded edit-distance fill (17 cells a row) wherever
a seed's diagonal failed its check: 538 ms (against 146 ms then). A chance
seed against a long part fails its diagonal in a few dozen bases, but the
fill, with the whole of a long part's budget to spend, runs hundreds of
rows before it gives up, and a megabase has ~26,000 chance seeds. Now the
seeds of parts that may match with indels are recorded during the scan,
sorted by (part, diagonal) afterwards, and the fill runs only where a
window of neighbouring diagonals holds as many seeds as a match within the
budget must leave (at least 13): on real copies only. The sort is ~2.5 ms;
the first run's extra ~20 ms is the fill running cold on those copies,
which a warm worker does not pay.

## Residue numbers in the sequence view (item 60, 2026-09-25)

One 900 px screen of a 200 kb circular sequence with a CDS every 1.2 kb (a
third of them two-exon joins), 100 bases per row, median of 50 screens down
the sequence, drawn through a context that does nothing
(`residueNumbers.timing.test.ts`, Node 24, a mutation run busy on the same
machine):

| Residue numbers | One screen   |
| --------------- | ------------ |
| Off             | 0.78–0.82 ms |
| Every 10th      | 0.83–0.88 ms |
| Every residue   | 1.02–1.05 ms |

Before the change the same screen took 0.73–0.95 ms, the band of numbers
off. Every residue first measured 1.4–1.6 ms: the number's text was
formatted with `toLocaleString` each time and its codon's stretch found with
`runsInRow`, which builds and sorts a list. Formatting each number once and
walking the codon's three bases for the stretch took it to about 1 ms. What
is left is the existing walk over every codon of each CDS that reaches a
row, which the numbers do once more.

## Timing tests and shared runners (#148, 2026-10-05)

A budget on a mean lets one run that a busy CI runner stalled fail a test
that is not slow: the 50 kb PCR test read 202 ms against its 200 ms budget
once, after ~135 ms locally. It now times its 20 runs one by one and compares
their median (`medianMs` in `src/test/timing.ts`); a real slowdown moves every
run, so the median still catches it. The other timing tests were checked and
sit below ~30% of their budgets (the next closest is the 10 kb history decode,
28–57 ms of 200), so they are left as they were. Use `medianMs` for any new
budget that is within about 40% of its limit.

## banded.test.ts run time (#172, 2026-10-06)

Since #167 every banded alignment is checked, so each test that compares it
with a full alignment pays for both. The file took about 4 minutes on CI
(Node 24, shared runner, other test files running alongside) and 21 s here
(`vitest run`, tests alone ~20 s), of which the #159 junk-flank test was 5.1 s,
the 20-seed region tests 3 s and the 4-seed kind-by-mode matrix 5 s.

Each regression case now runs at the size it already had, with only as many
seeds as it takes to fail without its fix, each found by reverting the fix:
the #159 test runs 3 of its 12 trials (0 and 3 miss without the flank band),
the #167 matrix one seed per kind and mode, "fast Align all" the three cases
that miss, the region tests 8 seeds. The two #51 noisy-read tests use a 3 kb
reference, not 5 kb, and two seeds, not three. The Biopython oracle still
holds the broad pair sets. The 10 kb global check now also asserts its region is under 20% of the
matrix, since the clock cannot tell: CI took 3.7 s for what takes 0.3 s here
(12x), about what a full fill (110 M cells, 3-4 s here) would take locally,
so its limit stays at 15 s and the region size is the exact guard. CI after
this change: banded.test.ts 100 s, down from about 240 s.

|                         | Before | After               |
| ----------------------- | ------ | ------------------- |
| `banded.test.ts`, local | 21.3 s | 11.4 s (tests ~9 s) |
| #159 test               | 5.1 s  | 1.6 s               |

## CRISPR guide scan (item 74, #206, 2026-10-09)

The guide finder's two halves cost very differently. Finding the guides is
one pass per strand with a PAM window at each base — linear, and never the
problem. Counting off-targets compares each guide with the other
PAM-adjacent sites, and there are about as many sites as guides, so done
plainly it is quadratic: a random 200 kb circle has ~25,000 SpCas9 sites and
625 M comparisons.

A seed index fixes it. Two spacers that differ in at most _k_ places must
share one of any _k_ + 1 equal blocks, so the sites are bucketed by each of
their _k_ + 1 blocks and a guide is only compared with the sites sharing a
block with it. Sites whose spacer has an ambiguous base belong to no bucket
and are compared with every guide; there are few of them in a real record.

Measured here (`crispr.timing.test.ts`, SpCas9, circular, off-targets to
three mismatches, the whole record):

| Length | Guides | All pairs | Seed index |
| ------ | ------ | --------- | ---------- |
| 5 kb   | 608    | 64 ms     | 39 ms      |
| 20 kb  | 2,515  | 184 ms    | 77 ms      |
| 50 kb  | 6,282  | 671 ms    | 161 ms     |
| 200 kb | 25,104 | 8,237 ms  | 818 ms     |

The Biopython oracle (`src/test/oracle/crispr.test.ts`) passes unchanged
either way, which is what says the index only skips comparisons that could
not have matched.

## Homologue search (item 59, #219, 2026-10-10)

The gapped protein search (`homologue.ts`) must not turn a 10 kb plasmid
into a seconds-long wait, nor a megabase into a minute. It seeds with exact
4-residue words from every protein of 50 residues or more (154 proteins,
43,035 residues in the bundled list), records a word only when a second word
lies within 48 residues on the same diagonal band (BLAST's two-hit rule, a
direct-mapped table of the last word per band), extends the pair ungapped
along its diagonal with an X-drop of 20 and asks for a score of 45 or more,
and only then aligns locally (`alignInBand`, protein alphabet) in a band of
32 diagonals either side of the cluster. Each step was added for a measured
reason. The first version aligned every chance cluster in full, most of them
against the 1,000-residue proteins: 2.3 s for 10 kb of random sequence, and
3.2 s a megabase. An ungapped check along the whole diagonal and a banded
fill brought a megabase to 0.8 s; extending only from the seeds, and
recording only paired words (677,000 words in a megabase became a few
thousand), to 0.35 s.

Measured (Node 24, the whole bundled list, six frames, circular):

| Case                                                   | Time    |
| ------------------------------------------------------ | ------- |
| 10 kb random, no homologue                             | ~4 ms   |
| 1 Mb random, homologues alone                          | ~0.35 s |
| 1 Mb random, whole `detectFeatures` (`detect.test.ts`) | ~0.8 s  |

CI runs about three times slower, so that test's budget is 4 s.

Validation on synthetic variants (ten proteins, each recoded with random
codons and diverged by random substitutions plus two indels, in 6 kb
of random flank): found 10/10 up to 30% of residues replaced (aligned
identity 63-89%), 9/10 at 40%, 9/10 at 50% (identity 48-57%), 7/10 at 60%,
2/10 at 70%. The misses are mostly EGFP, held to 60% identity as a
fluorescent protein. No hit in 100 random 10 kb sequences (1 Mb), nor
in a shuffled AmpR. Recall on real homologues is for the oracle (#220) to
measure.

## Export figure of a long sequence (#246, 2026-10-17)

Pages go out as one ZIP or PDF (item 94), so the old 40-page cap had no
reason left. Measured in the real dialog in headless Chromium (Playwright,
`chromium-1248`, Linux), a synthetic random 100,000-base DNA (the most the
sequence view exports) loaded from a FASTA file, _Sequence view_, _Split into
pages_, click Export, time to the download event. Memory is the resident set
of the whole browser process tree (`ps`, sampled every 150 ms), as a rise over
the idle dialog (about 1.12 GB for a headless browser with the app loaded);
heap is `performance.memory.usedJSHeapSize` (JS only, sampled every 0.5 s).
The app was the Vite dev server's (unminified); the numbers are for
comparing exports, not for the production bundle. Longest stall is the longest `longtask` (main thread blocked, no painting).
One run each, so read them to a factor of about 1.3.

A4 pages, 60 bases a row unless said (139 pages; 12 rows a page). Letter is
152 pages at 60; 10 a row is 834 A4 pages, 30 a row 278.

| Export                     | Pages | Time   | RSS rise | Heap peak | Longest stall | File    |
| -------------------------- | ----: | ------ | -------- | --------- | ------------- | ------- |
| SVG ZIP                    |   139 | 0.5 s  | 27 MB    | 81 MB     | 0.44 s        | 0.4 MB  |
| SVG ZIP, US Letter         |   152 | 0.6 s  | 51 MB    | 104 MB    | 0.49 s        | 0.4 MB  |
| SVG ZIP, 10 a row          |   834 | 1.0 s  | 50 MB    | 105 MB    | 0.89 s        | 0.9 MB  |
| PNG ZIP 2×                 |   139 | 10.6 s | 280 MB   | 184 MB    | 2.7 s         | 38.5 MB |
| PNG ZIP 4× (3,175 × 4,490) |   139 | 27 s   | 447 MB   | 333 MB    | 6.3 s         | 86 MB   |
| PNG ZIP 2×, 30 a row       |   278 | 19 s   | 402 MB   | 258 MB    | 4.8 s         | 67 MB   |
| PNG ZIP 2×, 10 a row       |   834 | 44.5 s | 638 MB   | 432 MB    | 9.9 s         | 116 MB  |
| PDF vector                 |   139 | 5.6 s  | 335 MB   | 114 MB    | 5.1 s         | 0.4 MB  |
| PDF vector, 30 a row       |   278 | 8.7 s  | 858 MB   | 77 MB     | 8.0 s         | 0.5 MB  |
| PDF vector, 10 a row       |   834 | 9.6 s  | 854 MB   | 110 MB    | 8.9 s         | 0.9 MB  |
| PDF raster 1×              |   139 | 27 s   | 277 MB   | 152 MB    | 0.37 s        | 14 MB   |
| PDF raster 2×              |   139 | 101 s  | 368 MB   | 267 MB    | 0.91 s        | 33 MB   |

Findings.

- **Nothing failed**, up to the 834 pages that are the most the layout gives
  (SVG ZIP, PNG ZIP at 2×, vector PDF). The cap did not protect anything at
  its old value of 40.
- **The raster PDF is the cost.** About 0.2 s a megapixel (139 pages at 1×,
  0.89 MP: 27 s; at 2×, 3.57 MP: 101 s; the same pages as PNGs in a ZIP:
  10.6 s), so linear in pixels and 9 times the ZIP's cost. It is jsPDF
  decoding each PNG it is given (`addImage`), not the canvas. 834 pages at 2×
  would be about 10 minutes. It does not stall: it awaits an image decode per
  page, so the browser answers between pages.
- **Memory** follows the retained pictures: about 0.2 MB of RSS a megapixel
  held for PNG ZIPs (all blobs, then their bytes, then the ZIP), so
  2,970 MP (834 pages at 2×) is +640 MB and 11,900 MP (834 pages at 4×) would
  be about four times that, which is why the ZIP has a budget of 3,000 MP.
  The vector PDF's rise (up to +860 MB with a 110 MB heap) is mostly
  transient native memory from jsPDF and the DOM parse of each page (the
  heap stayed at 110 MB), peaking near 2 GB in all at 834 pages.
- **Freezes.** The vector PDF drew 834 pages in one 8.9 s task; yielding
  between pages (after any 100 ms of work, `pdfWriter.ts`) cut the longest
  stall to 0.59 s (the closing `output()`), at 12.5 s instead of 9.6 s in all
  (the 139-page run: 7.9 s, longest stall 0.31 s, against 5.6 s and 5.1 s).
  The PNG ZIP still blocks once, for 2.7 to 9.9 s, while fflate deflates the
  ZIP synchronously (PNG data does not compress, so storing would be fast but
  would change the files); a worker for that was not built. No export
  stalled the page while it rasterised.

The rule these set is in design note 94: pages at most 1,000; a ZIP of PNGs at
most 3,000 megapixels; a raster PDF at most 600 (two minutes). Rejected
configurations were checked in the dialog: 139 pages as a raster PDF at 4×
(1,981 MP) and 834 pages as PNGs at 4× (11,889 MP) are refused with the
advice; 300 kb sequences are refused by the 100,000-base limit before any of
this.

## Export figure off the main thread (#247, #248, 2026-10-17)

The same harness as above (headless Chromium 156 through Playwright
`chromium-1248`, the dev server, the synthetic 100 kb FASTA, _Sequence view_,
_Split into pages_, click Export, time to the download event; RSS of the
browser process tree over the idle dialog, about 600 MB this time; longest
`longtask`), after the ZIP's deflate and the raster PDF's assembly moved to
the export worker and the pages are drawn through `eachPage` (design note
94). One run each. The raster-PDF budget was lifted to 3,000 MP for the
runs, to find where it breaks.

| Export                  | Pages |    MP | Time   | RSS rise | Heap peak | Longest stall | File    | Before (#246)        |
| ----------------------- | ----: | ----: | ------ | -------- | --------- | ------------- | ------- | -------------------- |
| PNG ZIP 2×              |   139 |   496 | 11.9 s | 225 MB   | 77 MB     | 0.26 s        | 38.5 MB | 10.6 s, stall 2.7 s  |
| PNG ZIP 2×, 10 a row    |   834 | 2,970 | 49.9 s | 608 MB   | 50 MB     | 0.58 s        | 116 MB  | 44.5 s, stall 9.9 s  |
| PDF vector              |   139 |     — | 8.0 s  | 289 MB   | 124 MB    | 0.27 s        | 0.4 MB  | 7.9 s, stall 0.31 s  |
| PDF vector, 10 a row    |   834 |     — | 12.6 s | 319 MB   | 152 MB    | 0.55 s        | 0.9 MB  | 12.5 s, stall 0.59 s |
| PDF raster 2×           |   139 |   496 | 103 s  | 370 MB   | 87 MB     | 0.29 s        | 33 MB   | 101 s, stall 0.91 s  |
| PDF raster 2×, 30 a row |   278 |   992 | 198 s  | 519 MB   | 120 MB    | 0.47 s        | 57 MB   | refused (600 MP)     |
| PDF raster 4×           |   139 | 1,981 | 363 s  | 595 MB   | 150 MB    | 0.28 s        | 79 MB   | refused              |
| PDF raster 2×, 10 a row |   834 | 2,970 | 567 s  | 787 MB   | 197 MB    | 0.55 s        | 98 MB   | refused              |

Findings.

- **Nothing stalls for longer than the page layout itself.** The longest
  tasks left (0.26 to 0.58 s) are `exportLinearSvgPages` laying out the
  pages before anything is drawn, the same 0.44 to 0.89 s the SVG ZIP always
  had, plus the hand-over of 834 buffers. The PNG ZIP's 2.7 to 9.9 s deflate
  is gone from the main thread; the status line was seen changing every
  sample (150 ms) through every run.
- **Total time is unchanged**: the worker does the same work at the same
  speed (0.19 to 0.21 s a megapixel for the raster PDF, as on the main
  thread, which is what the spike predicted), and the yields between pages
  cost about a second in ten. Nothing got faster; it stopped blocking.
- **Memory** of a raster PDF follows the retained PNGs as the ZIP's does:
  about 0.26 MB of RSS a megapixel (+787 MB at 2,970 MP against the ZIP's
  +608 MB), the extra being jsPDF's streams in the worker. The heap of the
  main thread stays under 200 MB; the page bytes are transferred, not
  copied. 2,970 MP is the most the layout can produce at 2×, and it held
  with 1.4 GB of browser in all, so the raster budget is raised to the ZIP's
  3,000 MP; the time, about 10 minutes at the top, is now a background job
  with a spinner, progress and Cancel.
- **Cancel** in the real browser: a PNG ZIP at 2× stopped at "drawing page
  33 of 139…", the status cleared at once, Export was enabled, no download
  came within 6 s, and the next Export (a fresh worker) delivered the ZIP in
  11.9 s as before.

The spikes that decided what runs where (rasterising in a worker fails in
Chromium and Firefox; jsPDF holds in a worker, svg2pdf does not) are in
design note 94.

## Opening and scanning a large sequence (#253, 2026-10-20)

`npm run bench -- --sizes 3000,50000,300000 --n 10` builds the app, serves
`dist/` with `vite preview`, and in headless Chromium 156 (Playwright
`chromium-1248`, a fresh context per run) picks a seeded random FASTA in the
header's file input. It times, from the input's change event to the frame
after each first appears, the painted sequence view and the drawn enzyme
list (the Enzymes panel is opened as soon as its tab exists), then sends 120
wheel events of 300 px over the sequence view and logs the gaps between
animation frames. One unrecorded run per size warms the browser up. The
script is `scripts/bench/open-scan.ts`; it writes one CSV row per run and
prints mean ± SE. These are the runs of
[`docs/perf/open-scan-2026-10-20.csv`](perf/open-scan-2026-10-20.csv), on a
16-thread Xeon E5-2630 v3, at 1.16.1 plus the 1.16.2 fixes, while a system
update was compiling on five or more of those threads; re-run on an idle
machine before quoting them:

| Size   | View painted | Enzyme list | Longest frame gap | Frames > 50 ms |
| ------ | ------------ | ----------- | ----------------- | -------------- |
| 3 kb   | 106 ± 3 ms   | 318 ± 6 ms  | 32 ± 2 ms         | 0              |
| 50 kb  | 116 ± 5 ms   | 405 ± 8 ms  | 30 ± 2 ms         | 0              |
| 300 kb | 197 ± 10 ms  | 673 ± 9 ms  | 45 ± 4 ms         | 0.2 ± 0.1      |

- About 150 ms of every enzyme time is `useAnalysis` waiting a beat
  (`DEBOUNCE_MS`) before it asks the worker, so the scan itself is the rest:
  roughly 0.2 s at plasmid size and 0.5 s at 300 kb, off the main thread.
- Scrolling holds frame rate at every size; a 300 kb record drops one frame
  past 50 ms in about one run in five.
- These are timings of the whole app in a browser, so they move with the
  machine and with what else it runs. Compare runs made on one machine.

## The scroll hitch at 300 kb (#268, design note 96, 2026-10-21)

The bench above dropped one frame of 50-83 ms while scrolling a 300 kb
record, every run, and none at 50 kb or 1 Mb. A CPU profile of the scroll
(Playwright's CDP session, `Profiler.start` at a 0.2 ms interval; the
longest busy stretch aggregated by stack) put the whole frame in
`persistence.autosaveDocument`: the SEGUID digest for the stored row (SHA-1
over `watson;crick`, ~30 ms, and ~10 ms building the strands), `writeGenBank`
twice (`findIdentical` and `save`, ~8 ms each), the Dexie `put` and a garbage
collection. The sequence view's own work held its frames at every size.

The write is at a time, not a scroll position: `useAutosave` fires 500 ms
after the last change to the document list, which at every size is about
1.0-1.2 s after the file was picked. The bench starts scrolling when the
enzyme list has drawn, which is 0.7 s after the open at 300 kb and 1.2-1.6 s
at 500 kb and 1 Mb, so the bigger sizes scroll after the write has already
happened. The autosave's main-thread task, from the `longtask` entries
(headless Chromium 156, 16-thread Xeon E5-2630 v3, idle machine; three runs
per size):

| Size   | Autosave task, 1.17.0 | Autosave task, fixed | In the bench's scroll   |
| ------ | --------------------- | -------------------- | ----------------------- |
| 50 kb  | ~15 ms                |                      | yes, one 33 ms frame    |
| 100 kb | ~20 ms                |                      | yes, one 33 ms frame    |
| 200 kb | 54-62 ms              | ~30 ms               | yes, one 50-83 ms frame |
| 300 kb | 52-77 ms              | 30-41 ms             | yes, one 50-83 ms frame |
| 500 kb | 82-179 ms             |                      | no, before it           |
| 1 Mb   | 265-271 ms            | 45-62 ms             | no, before it           |

The fix remembers `documentChecksum` per document object (the status bar
had already taken it at the open) and has `findIdentical` write the GenBank
text only when a stored document shares the name and file name. The bench
after it (`npm run bench -- --sizes 200000,300000,1000000 --n 5`, same
machine, idle):

| Size   | View painted | Enzyme list  | Longest frame gap | Frames > 50 ms |
| ------ | ------------ | ------------ | ----------------- | -------------- |
| 200 kb | 145 ± 5 ms   | 583 ± 10 ms  | 33.4 ± 0.0 ms     | 0              |
| 300 kb | 170 ± 6 ms   | 691 ± 10 ms  | 33.3 ± 0.0 ms     | 0              |
| 1 Mb   | 343 ± 6 ms   | 1432 ± 23 ms | 16.8 ± 0.0 ms     | 0              |

What is left of the autosave is one `writeGenBank` (11-16 ms at 300 kb,
28 ms at 1 Mb), the history encoding and the IndexedDB write; at 300 kb it
still costs one 33 ms frame, which is a missed vsync rather than a hitch.
The bench now records when its longest gap fell (`scroll_max_gap_at_ms`
after the first wheel event, `scroll_max_gap_after_open_ms` after the file
was picked), so a task that lands at a time shows as one.

The same profile puts two larger main-thread tasks before the scroll, which
the bench's `view_ms` and `enzymes_ms` include and which are not this
issue: the open itself (205 ms at 300 kb, 410-429 ms at 1 Mb, of which the
status bar's checksum is 15 ms and 80 ms and garbage collection 30 ms and
125-158 ms), and drawing the enzyme list (165 ms at 300 kb, 317-330 ms at
1 Mb, mostly the Enzymes panel's memos).

## The checksum of a large document, off the main thread (#270, design note 97, 2026-10-21)

The open task above was profiled with `scripts/bench/open-profile.ts`: an
unminified production build (`npx vite build --minify false --outDir
dist-profile`, so function names survive), a CPU profile of the page's main
thread over CDP at a 0.2 ms interval, the `longtask` entries, and the frame
after the sequence view, the checksum button and the enzyme list first
appear. Headless Chromium 156, 16-thread Xeon E5-2630 v3, idle, three runs
per size; the unminified build runs a little slower than the shipped one.

Before, with the checksum taken inline in the status bar's first render:

| Size   | Open task  | In `documentChecksum` | GC in the open | View painted | Checksum painted | Enzyme list |
| ------ | ---------- | --------------------- | -------------- | ------------ | ---------------- | ----------- |
| 300 kb | 132-156 ms | 35-39 ms              | 27-34 ms       | 178-203 ms   | with the view    | 710-738 ms  |
| 1 Mb   | 311-320 ms | 122-131 ms            | 114-123 ms     | 355-371 ms   | with the view    | 1.29-1.45 s |

At 1 Mb the checksum's 122-131 ms is 70-75 ms of `digestWords`, 22-28 ms of
`documentStrands` and `reverseComplement`, and garbage collection inside
it; the two strands and the 2 Mb `watson;crick` are what the collector was
spending most of its 114-123 ms on.

Where the threshold sits: the digest inline (Node 24, median over 10 fresh
documents, circular random DNA) against a round trip of the sequence string
to an echo worker (headless Chromium, median over 20; the timer's
resolution is 0.1 ms):

| Size   | Inline digest | Round trip: main-thread send | Round trip: answer back |
| ------ | ------------- | ---------------------------- | ----------------------- |
| 1 kb   | 0.74 ms       | < 0.1 ms                     | < 0.1 ms                |
| 3 kb   | 0.80 ms       | < 0.1 ms                     | < 0.1 ms                |
| 10 kb  | 1.9 ms        | < 0.1 ms                     | < 0.1 ms                |
| 30 kb  | 3.9 ms        | < 0.1 ms                     | 0.1 ms                  |
| 100 kb | 10.5 ms       | 0.1 ms                       | 0.1 ms                  |
| 300 kb | 37 ms         | 0.2 ms                       | 0.4 ms                  |
| 1 Mb   | 107 ms        | 0.6 ms                       | 1.2 ms                  |
| 3 Mb   |               | 1.8 ms                       | 3.2 ms                  |

The round trip's own main-thread cost is below the digest's at every size;
what the worker costs instead is a paint without the checksum and one more
render of the status bar when it lands, which for a plasmid is more than
its 0.8 ms digest. `WORKER_CHECKSUM_FROM` is 50 kb: below it the digest is
under 6 ms and stays in the first paint.

After, with the worker asked at once from the status bar's first render
(the restriction scan follows it 150 ms later):

| Size   | Open task | GC in the open | View painted | Checksum painted | Enzyme list |
| ------ | --------- | -------------- | ------------ | ---------------- | ----------- |
| 300 kb | 67-97 ms  | 4-7 ms         | 110-147 ms   | 244-252 ms       | 612-693 ms  |
| 1 Mb   | 77-94 ms  | 6-11 ms        | 127-147 ms   | 390-429 ms       | 1.27-1.39 s |

The checksum button is painted 100 ms after the view at 300 kb and
250-290 ms after it at 1 Mb: the worker's start-up (the first request
creates it; the scan used to pay that), the digest, the answer's clone and
a frame. The autosave's task at 1 Mb (65-100 ms, `sequenceLines`,
`writeGenBank`, the IndexedDB put) has no checksum in it: the worker's
answer is remembered on the document, and the autosave awaits it.

The bench after (`npm run bench -- --sizes 300000,1000000 --n 5`, same
machine, idle; the #268 table above is the same code before this change,
measured the same day):

| Size   | View painted | Enzyme list | Longest frame gap | Frames > 50 ms |
| ------ | ------------ | ----------- | ----------------- | -------------- |
| 300 kb | 111 ± 3 ms   | 587 ± 14 ms | 30.0 ± 3.3 ms     | 0              |
| 1 Mb   | 133 ± 2 ms   | 1306 ± 8 ms | 16.8 ± 0.0 ms     | 0              |

The view paints 60 ms sooner at 300 kb and 210 ms sooner at 1 Mb; the
enzyme list is 100-130 ms sooner too, since the worker no longer starts up
on the scan's request. What is left of the open task at 1 Mb is the parse,
the first render and the sequence view's layout, none of it the checksum.

## Drawing the enzyme list of a large document (#271, design note 98, 2026-10-21)

The other large task the #268 profile showed: when the scan comes back,
the Enzymes panel's memos and its first render. Profiled with
`scripts/bench/open-profile.ts` as above (it now names an anonymous frame
by its line in the bundle, so a memo or an arrow in a render can be found),
three runs per size, two at 4.64 Mb. Before:

| Size    | List-draw task                      | Enzyme list drawn |
| ------- | ----------------------------------- | ----------------- |
| 300 kb  | 134-221 ms                          | 559-664 ms        |
| 1 Mb    | 269-293 ms                          | 1.26-1.33 s       |
| 4.64 Mb | 884-955 ms, then a 222 ms re-render | 4.75-5.07 s       |

Where the 1 Mb task went, by self time (96,200 sites of the bundled 127
enzymes; the enzyme list's own profile, not the scan, which is in the
worker):

- The `cuts` closure, 34-38 ms: `pairable` filtered every site of every
  enzyme through a `Set` of `${enzyme}:${cut}` strings, building the
  string per site, to find the enzymes with at most three open cuts.
- The `blocked` memo, about 60 ms: `hostMethylationAt` over every site
  (26-32 ms), `getEnzyme` per site (13-19 ms) and the same key strings.
- The `groups` memo, about 65 ms: `digestFragments` (14-18 ms) and
  `gelProfile` (25-39 ms) for each enzyme, a sort of its thousands of
  fragment lengths inside the latter.
- The render: `describeSite` 23-29 ms and `describeBands` 16 ms, which is
  `Number.prototype.toLocaleString` for the dozen positions and the bands
  of each of the 26 rows the first window draws; `attachRow` 13-17 ms, the
  first `offsetHeight` of a row forcing the layout; garbage collection
  12-18 ms.

The same pieces in Node 24 (seeded random circular DNA, median of 5):

| Size   | Sites  | `findCutSites` | `digestFragments` + `gelProfile` per enzyme | `gelProfile` on sorted lengths | `hostMethylationAt`, every site | Key strings, every site |
| ------ | ------ | -------------- | ------------------------------------------- | ------------------------------ | ------------------------------- | ----------------------- |
| 300 kb | 28,894 | 135 ms         | 17 ms                                       | 2.0 ms                         | 17.5 ms                         | 13 ms                   |
| 1 Mb   | 96,200 | 380 ms         | 51 ms                                       | 5.7 ms                         | 58 ms                           | 55 ms                   |

So the sort and the fragment objects are most of a profile, and the banding
of sorted lengths is a tenth of it. `toLocaleString()` with no arguments
makes a fresh `Intl.NumberFormat` each call: 600 calls are 8.4 ms in
headless Chromium 156 against 0.4 ms through one formatter made once
(`formatInt`), with the same output over 1,000 random values; Node has a
cache and shows 0.4 ms either way, which is why the cost was only in the
browser profile.

What was done (design note 98): the worker's `cutSites` answer carries,
when asked, an `EnzymeDigest` — the Dam/Dcm marks inside each site as one
byte, each enzyme's fragment lengths sorted longest first, and its site
count — packed as transferred buffers like the sites. The panel's `groups`
takes the lengths through `gelProfile` (the sort is linear on sorted input),
`blocked` is a mask over the bytes and a `Set` of site objects, `pairable`
stops at an enzyme's fourth open cut, the store's first-result count of
single cutters is the digest's, and the two views skip filtering 96,000
sites when nothing is ticked. Measured after the digest and the formatter
alone the task was 114-130 ms at 1 Mb and 89-103 ms at 300 kb; the three
trims took the rest. After everything:

| Size    | List-draw task | Enzyme list drawn |
| ------- | -------------- | ----------------- |
| 300 kb  | 80-91 ms       | 540-574 ms        |
| 1 Mb    | 86-95 ms       | 1.14-1.18 s       |
| 4.64 Mb | 197-214 ms     | 4.44-4.51 s       |

What is left of the task at 1 Mb: the row measurement's forced layout
(`attachRow`, 15-21 ms), grouping the sites by enzyme (9-11 ms),
`gelProfile` and `bandsOf` over 96,000 sorted lengths (14 ms), garbage
collection (10 ms) and React's own render. The worker's answer costs more
to receive: unpacking the digest's lengths into arrays is 7 ms at 1 Mb and
27 ms at 4.64 Mb, where the task taking the answer grew from 65 ms to
102-107 ms with the garbage collection those arrays set off.

The bench after (`npm run bench -- --sizes 300000,1000000 --n 5`, same
machine, idle; the #270 table above is the day's code before this change):

| Size   | View painted | Enzyme list  | Longest frame gap | Frames > 50 ms |
| ------ | ------------ | ------------ | ----------------- | -------------- |
| 300 kb | 100 ± 2 ms   | 524 ± 3 ms   | 33.3 ± 0.0 ms     | 0              |
| 1 Mb   | 119 ± 2 ms   | 1129 ± 11 ms | 16.8 ± 0.0 ms     | 0              |

The list is drawn 60 ms sooner at 300 kb and 180 ms sooner at 1 Mb: the
digest moved to the worker costs the scan 60-100 ms there, and the main
thread saves more than that in the task that follows.

## The enzyme list and the ORF scan, and the masks (#274, design note 99, 2026-10-21)

`npm run bench -- --sizes 1000000,4640000 --n 3` (built from the tree each
time; same machine, idle), the Enzymes list drawn, ms after the file was
picked:

| Code                         | 1 Mb         | 4.64 Mb      |
| ---------------------------- | ------------ | ------------ |
| 1.17.1                       | 1122 ± 10 ms | 4189 ± 37 ms |
| Sites stored before the ORFs | 1028 ± 24 ms | 3483 ± 5 ms  |
| And `sequenceMasks` by table | 949 ± 12 ms  | 3249 ± 26 ms |

The worker's steps, timed in Node on the bench's seeded sequences (127
bundled enzymes, linear, 3 runs; 96,198 sites at 1 Mb, 446,034 at 4.64 Mb):

| Step                           | 1 Mb       | 4.64 Mb      |
| ------------------------------ | ---------- | ------------ |
| `sequenceMasks`, before        | 82-107 ms  | 375-383 ms   |
| `sequenceMasks`, by table      | 5-8 ms     | 26-29 ms     |
| Forward pass per distinct site | 208-222 ms | 965-972 ms   |
| `findCutSites`, before         | 346-417 ms | 1641-1695 ms |
| `findCutSites`, after          | 272-280 ms | 1267-1357 ms |
| `packCutSites`                 | 7-10 ms    | 41-45 ms     |
| `enzymeDigest`                 | 98-166 ms  | 419-445 ms   |
| `packEnzymeDigest`             | 0-1 ms     | 1 ms         |

What is left is the pass per site and the digest (#275).

## One pass for every site, and the digest (#275, design note 100, 2026-10-22)

`npm run bench -- --sizes 1000000,4640000 --n 3` (built from the tree each
time; same machine, idle), the Enzymes list drawn, ms after the file was
picked:

| Code                                | 1 Mb        | 4.64 Mb      |
| ----------------------------------- | ----------- | ------------ |
| Before (design note 99)             | 930 ± 9 ms  | 3272 ± 24 ms |
| `matchPatterns`, one pass           | 729 ± 25 ms | 2172 ± 29 ms |
| And `enzymeDigest` with less a site | 683 ± 27 ms | 2101 ± 18 ms |

The worker's steps, timed in Node on the bench's seeded sequences (127
bundled enzymes, linear, 3 runs; 96,198 sites at 1 Mb, 446,034 at 4.64 Mb):

| Step                           | 1 Mb       | 4.64 Mb      |
| ------------------------------ | ---------- | ------------ |
| `sequenceMasks`                | 5-9 ms     | 25-29 ms     |
| Shift-And pass per pattern     | 240-321 ms | 1114-1153 ms |
| `matchPatterns`, same patterns | 40-52 ms   | 183-194 ms   |
| `findCutSites`, before         | 271-344 ms | 1280-1298 ms |
| `findCutSites`, after          | 74-104 ms  | 362-448 ms   |
| `packCutSites`                 | 7-11 ms    | 39-49 ms     |
| `enzymeDigest`, before         | 93-138 ms  | 423-430 ms   |
| `enzymeDigest`, after          | 52-119 ms  | 236-247 ms   |
| `packEnzymeDigest`             | 0-1 ms     | 1-2 ms       |

Inside the old digest at 4.64 Mb: `getEnzyme` per site 87-93 ms warm,
`hostMethylationAt` per site 264-286 ms (with the lookup; 91,522 sites are
of a Dam- or Dcm-sensitive enzyme), `digestFragments` and its sort per
enzyme 183-201 ms. No WASM: the matching left is 0.19 s.

## The scan before the checksum (#276, design note 101, 2026-10-22)

`npm run bench -- --sizes 1000000,4640000 --n 3` (built from the tree at
each commit; same machine, idle), the Enzymes list drawn, ms after the file
was picked:

| Code                                       | 1 Mb        | 4.64 Mb      |
| ------------------------------------------ | ----------- | ------------ |
| Before (design note 100)                   | 664 ± 2 ms  | 2041 ± 8 ms  |
| Fresh document's scan sent in the effect   | 447 ± 14 ms | 1184 ± 22 ms |
| And byte-table `reverseComplement`, subtle | 471 ± 8 ms  | 1336 ± 7 ms  |
| And the worker started at app load         | 423 ± 37 ms | 1252 ± 25 ms |
| And the autosave after an idle callback    | 400 ± 4 ms  | 1167 ± 10 ms |
| The same, run again                        | 490 ± 19 ms | 1183 ± 30 ms |

The autosave, A/B with `--n 5`: 453 ± 8 / 1309 ± 40 ms written as soon as
the checksum is in, 432 ± 12 / 1155 ± 30 ms after an idle callback. With
only the scan moved forward, the save landed in the scroll instead (longest
frame gap 261 ms at 4.64 Mb, against 17 ms before and after). First
contentful paint over 8 loads, worker started at an idle callback or not:
442 vs 445 ms mean.

The checksum's steps in Node (vitest, seeded random DNA, 3 runs):

| Step                                 | 1 Mb      | 4.64 Mb    |
| ------------------------------------ | --------- | ---------- |
| `reverseComplement`, character loop  | 46-112 ms | 460-485 ms |
| `reverseComplement`, byte table      | 6-7 ms    | 19 ms      |
| `minimalRotation` of both strands    | 35-41 ms  | 131-133 ms |
| `TextEncoder`, canonical string      | 4-5 ms    | 15-16 ms   |
| Our SHA-1                            | 40-46 ms  | 146-151 ms |
| `crypto.subtle` SHA-1, with encoding | 9-19 ms   | 36-44 ms   |
| `moleculeChecksum` (circular), sync  | 81-92 ms  | 298-310 ms |
| `moleculeChecksumAsync` (circular)   | 53-61 ms  | 198-208 ms |

## Our SHA-1 (#273, design note 102, 2026-10-22)

`sha1Base64Url` over seeded random DNA text, Node 24.4.1 (V8) on an Intel
Xeon E5-2630 v3 (2.4 GHz, 16 threads), idle. Two scripts kept outside the
repo: _warm_ is one size per fresh process, warmed (500 calls at 20 kB, 100
at 100 kB, 10 at 1 MB, 5 above), then the median of 15 calls, three
processes; _first call_ is the one call of a fresh process, median of 11
processes (min-max in brackets). Every run checked the digest against
`node:crypto` first. 2 and 9.28 MB are the canonical strings of a 1 Mb and
a 4.64 Mb double-stranded molecule.

| Text    | Warm, before | Warm, after | First call, before  | First call, after |
| ------- | ------------ | ----------- | ------------------- | ----------------- |
| 20 kB   | 0.21-0.24 ms | 0.15-0.17   | 3.8 (3.1-12.6) ms   | 4.6 (4.2-9.4)     |
| 100 kB  | 1.0-1.1 ms   | 0.64-0.77   | 11.2 (5.3-12.4) ms  | 9.4 (7.3-13.5)    |
| 1 MB    | 10.8-11.0 ms | 6.8-7.5     | 24.6 (22.6-27.7) ms | 30.1 (28.6-32.5)  |
| 2 MB    | 34.8-35.0 ms | 13.3-15.4   | 42.1 (40.7-47.8) ms | 40.9 (37.0-47.5)  |
| 4.64 MB | 77-81 ms     | 30-35       | 89 (88-92) ms       | 59 (53-77)        |
| 9.28 MB | 156-162 ms   | 60-65       | 177 (174-181) ms    | 89 (84-113)       |

Warm, that is 60-100 MB/s before (it depended on how the loop had been
compiled: 90 MB/s at 1 MB, 57 MB/s at 2 MB) and about 150 MB/s after,
the same at every size. `node:crypto` does 9.28 MB in 19 ms. A first call
is mostly V8 compiling the loop, so its numbers move by several ms between
identical runs; below 100 kB and at 1 MB the new loop's first call is no
faster, at a few MB and above it is 1.5-2x faster.

What it cost, at 9.28 MB warm, measured apart: `TextEncoder.encode` of the
whole text 16 ms, `encodeInto` the same text 16,384 characters at a time
into one 48 kB buffer 7 ms, the old compression loop on encoded bytes
about 140 ms. So the rounds dominated, and in them mostly the optimized
code bailing out (`--trace-deopt`: "Insufficient type feedback" at the
write-back after the loop, on nearly every call). Variants tried, 4.64 MB:

| Variant                                         | Warm     | First call |
| ----------------------------------------------- | -------- | ---------- |
| Before                                          | 78 ms    | 89 ms      |
| Rounds as four loops, old outer loop            | 73 ms    |            |
| A function per block, four loops of 20          | 36 ms    |            |
| A function per block, 80 rounds written out     | 20 ms    | 108-114 ms |
| Outer loop, write-back inside it, four loops    | 27 ms    | 46-62 ms   |
| The same, one loop with the round's `if` (kept) | 29-31 ms | 53-59 ms   |

The written-out rounds took V8's Maglev 35-40 ms to compile, so the first
call got slower at every size up to several MB. Four loops of 20 were 7%
faster warm than one loop, but at 10-50 kB the first call took 6-7 ms
against 4-5 for the single loop and the old code. Reading a word with
`getInt32` rather than four bytes and shifts: 27.4 vs 30.6 ms. Reading the
characters with `charCodeAt` instead of encoding (an ASCII fast path) was
no faster than encoding.

## The autosave's GenBank text in a worker (#272, design note 103, 2026-10-22)

After #268 the autosave was still one main-thread task of `writeGenBank`
(`sequenceLines` most of it), the history encoding and the Dexie put. The
GenBank text is now written in a save worker of its own; the history row
and the put stay on the main thread.

Measured with `scripts/bench/open-profile.ts` on unminified builds of main
(7634ee9) and of this change, the profile's busy stretches taken down to
1 ms (`--stretch 1`, new) and those holding the autosave's functions added
up; headless Chromium 156, 16-thread Xeon E5-2630 v3, load average about 3,
seeded random FASTA (no features), four runs per size:

| Size    | Autosave before: total, longest piece        | Autosave after: total, longest piece       |
| ------- | -------------------------------------------- | ------------------------------------------ |
| 300 kb  | 39-40 ms, one task of 36-37 ms               | 20-26 ms in three pieces, longest 11-13 ms |
| 1 Mb    | 81-84 ms, one 78-80 ms (a 59-61 ms longtask) | 33-44 ms in three pieces, longest 16-21 ms |
| 4.64 Mb | 150-184 ms (a 115-143 ms longtask)           | 53-70 ms, longest 47-63 ms (no longtask)   |

At 4.64 Mb the autosave before was in two runs of five part of one
512-554 ms stretch with the Enzymes list's draw; after, that stretch is the
list's alone. What is left, by piece: when the idle callback comes, the
history row (`encodeHistory`, cached), the bases flattened (`toString`, 1.3
ms at 300 kb, 3.2 ms at 1 Mb) and the post (2.4 ms at 1 Mb); when the text
comes back, reading it (1.6 ms at 1 Mb, 9-13 ms at 4.64 Mb) and the Dexie
put, whose structured clone of the text and the history row into IndexedDB
is the 7-12 ms at 1 Mb and 33-46 ms at 4.64 Mb that no worker of ours can
take (design note 103).

What crossing costs the main thread, from a page posting snapshots to the
built worker (headless Chromium, median of 9, features of three qualifiers
at one per kb):

| Size, features | Send: bases + JSON | Send: features as objects | Read the text back | Round trip |
| -------------- | ------------------ | ------------------------- | ------------------ | ---------- |
| 300 kb, 300    | 1.4 ms             | 1.5 ms                    | 0.3 ms             | 14 ms      |
| 1 Mb, 1,000    | 2.9 ms             | 4.8 ms                    | 1.5 ms             | 25 ms      |
| 4.64 Mb, 4,642 | 15.5 ms            | 21.6 ms                   | 5.9 ms             | 127 ms     |

against `writeGenBank` on the main thread (Node 24, median of 5, the same
documents): 0.7 ms at 10 kb, 2.0 ms at 50 kb, 10.5 ms at 300 kb, 29 ms at
1 Mb, 110 ms at 4.64 Mb. Below `WORKER_GENBANK_FROM` (50 kb) the text is
written inline. `JSON.stringify` of the features and a clone of the string
is 1.7 ms at 1,000 features in Node against 7.8 ms for a `structuredClone`
of the objects, which is why the protocol sends JSON.

The first build's worker failed at 4.64 Mb with "Maximum call stack size
exceeded" and the client wrote the text inline, as it should: `writeGenBank`
pushed the 77,000 sequence lines with one spread call, which a worker's
smaller stack does not take. It now pushes them one at a time.

`node scripts/bench/open-scan.ts --sizes 1000000,4641652 --n 5` on the
same two builds (mean ± SE):

| Size    | Longest frame gap, before | after         | Frames > 50 ms, before | after     |
| ------- | ------------------------- | ------------- | ---------------------- | --------- |
| 1 Mb    | 46.7 ± 3.3 ms             | 26.7 ± 4.0 ms | 0.4 ± 0.2              | 0.0 ± 0.0 |
| 4.64 Mb | 30.0 ± 3.3 ms             | 43.4 ± 4.1 ms | 0.0 ± 0.0              | 0.4 ± 0.2 |

At 1 Mb the autosave's task had fallen into the scroll (#278) and is gone.
At 4.64 Mb what is left of it, the 47-63 ms of reading the text and the
put, comes about 0.3 s later than the whole autosave used to (the worker's
130 ms, and the request is posted at the end of the list's busy stretch),
at open+1.54-1.74 s, which is inside the bench's scroll where the old task
at +1.2 s was just before it. When the autosave runs is #278's question.

## The open's last long task, the autosave and the heap (#278, design note 104, 2026-10-22)

Headless Chromium 156 (Playwright), 16-thread Xeon E5-2630 v3, load
average 2.7-4.1 throughout (two unrelated processes at 100% of a core
each), seeded random FASTA (no features). _Before_ is main at 0612215
(#272 and #274-#276; ce62d92 after it changes a test only), _after_ this
change; minified builds of each in
directories of their own, run one after the other. `open-scan.ts` now also
reads the JS heap as the scroll left it and after a forced collection, the
longest `longtask` inside the scroll, and with `--scroll-from view` starts
the scroll as soon as the sequence view is painted instead of once the
Enzymes list is drawn.

`node scripts/bench/open-scan.ts --sizes 300000,1000000,4641652 --n 10`
(mean ± SE; the scroll starts once the list is drawn):

| Size    | Enzymes list, before | after         | Longest frame gap, before | after         | Heap, before | after   | After GC, before | after   |
| ------- | -------------------- | ------------- | ------------------------- | ------------- | ------------ | ------- | ---------------- | ------- |
| 300 kb  | 213.5 ± 5.8 ms       | 214.4 ± 10.1  | 18.5 ± 1.6 ms             | 16.8 ± 0.0 ms | 19.3 MB      | 19.1 MB | 12.6 MB          | 11.8 MB |
| 1 Mb    | 417.5 ± 10.4 ms      | 410.3 ± 12.5  | 28.4 ± 2.5 ms             | 16.8 ± 0.0 ms | 39.8 MB      | 24.9 MB | 20.2 MB          | 17.7 MB |
| 4.64 Mb | 1209.5 ± 16.9 ms     | 1138.2 ± 11.9 | 40.0 ± 2.7 ms             | 26.7 ± 3.7 ms | 125.3 MB     | 93.8 MB | 55.5 MB          | 60.7 MB |

The same with `--scroll-from view`, where the rest of the open lands in
the scroll:

| Size    | Longest frame gap, before | after         | Longest task, before | after      | Frames > 50 ms, before | after |
| ------- | ------------------------- | ------------- | -------------------- | ---------- | ---------------------- | ----- |
| 300 kb  | 36.7 ± 6.9 ms             | 35.1 ± 6.3 ms | 33.6 ± 9.3 ms        | 45.2 ± 7.6 | 0.2                    | 0.1   |
| 1 Mb    | 108.3 ± 4.5 ms            | 70.0 ± 5.4 ms | 116.0 ± 4.3 ms       | 33.0 ± 9.1 | 1.0                    | 0.8   |
| 4.64 Mb | 283.3 ± 11.7 ms           | 88.3 ± 2.5 ms | 292.3 ± 10.7 ms      | 18.7 ± 9.5 | 1.0                    | 2.0   |

At 4.64 Mb one frame of 283 ms became two of 50-90 ms. The longest task
the observer reports during the scroll is smaller than the longest gap
because a collection between tasks is in the gap but in no task.

`open-profile.ts --scroll` (new: the bench's wheel events once the list is
drawn, and per long task the profile's top self times inside it) on
unminified builds, three runs per size:

| Size    | Receive and first render, before           | after                                      |
| ------- | ------------------------------------------ | ------------------------------------------ |
| 1 Mb    | one task of 101-136 ms (GC 19-22 ms)       | one of 52-68 ms (GC 4-5 ms)                |
| 4.64 Mb | one of 305-320 ms at +818-855 (GC 100-122) | 66-106 ms and 56-94 ms (GC 4-48 and 17-24) |

In the 4.64 Mb task before: `unpackEnzymeDigest` 21-35 ms, `unpackCutSites`
26-30, the panel's grouping 23-31, `gelProfile` 25-30 and `bandsOf` 9-10
for every enzyme, the blocked set 7-10, the collector 100-122. After, the
autosave's put is a task of 52-54 ms at open+6.35-6.46 s, a second after
the scroll ended (+5.1-5.2 s); before, it and the text read back were a
55-82 ms stretch at +1.50-1.58 s, inside the scroll. Timed per slice in an
instrumented build (4.64 Mb, three runs), a slice of 50,000 sites is 4-17
ms, except the one a collection falls in, 75-90 ms; at 10,000 sites a slice
the long tasks were the same length, so what is left is that collection.

The heap, `--settle 4000` (the scroll, then 4 s more, so every autosave is
written; three runs): after a forced collection 20.2 → 18.9 MB at 1 Mb and
55.5 → 49.1 MB at 4.64 Mb. 1.17.1 built from its tag, five runs, the
scroll after the list: 20.1 and 55.3 MB after the collection, 29.7 and
130.7 MB before it. So what the issue saw growing between releases is
garbage not yet collected; what is held did not change until this change
lowered it. At the end of the scroll `after` holds 60.7 MB because the
first save is still waiting for the input to be quiet before its put: a
heap snapshot then has the save's GenBank text, two strings of 5.88 MB,
held by `writeDocument`; once it is written the heap is the 49.1 MB above.
The heap snapshots (`open-profile.ts --snapshot`, after a forced
collection, 4.64 Mb): 63.1 MB of self sizes before, 56.8 MB after, of
which the 446,000 site objects and the other objects 25.7 MB, the sequence
4.64 MB once, the bundle's source 6.8 MB.

## The cut sites kept packed (#281, design note 105, 2026-10-22)

The same machine and method as #278: headless Chromium (Playwright), 16-thread
Xeon E5-2630 v3, seeded random FASTA (no features). _Before_ is main at
3db0488, _after_ this change; minified builds of each in directories of
their own (and unminified ones for the profiles), run one after the other.
Load average 13.5 falling to 5.5 during the first set (`before`, scroll after
the list; the builds had just finished), 4-6 for the rest.

`node scripts/bench/open-scan.ts --sizes 300000,1000000,4641652 --n 10`
(mean ± SE; the scroll starts once the list is drawn):

| Size    | Enzymes list, before | after         | Longest frame gap, before | after         | Heap, before | after   | After GC, before | after   |
| ------- | -------------------- | ------------- | ------------------------- | ------------- | ------------ | ------- | ---------------- | ------- |
| 300 kb  | 238.0 ± 9.8 ms       | 222.3 ± 11.3  | 16.8 ± 0.0 ms             | 16.8 ± 0.0 ms | 19.7 MB      | 15.1 MB | 11.8 MB          | 11.3 MB |
| 1 Mb    | 408.2 ± 11.5 ms      | 360.8 ± 8.9   | 16.8 ± 0.0 ms             | 16.8 ± 0.0 ms | 23.1 MB      | 27.2 MB | 17.7 MB          | 16.1 MB |
| 4.64 Mb | 1165.6 ± 21.5 ms     | 1022.2 ± 10.8 | 28.4 ± 2.5 ms             | 21.8 ± 2.5 ms | 93.8 MB      | 88.0 MB | 60.7 MB          | 52.7 MB |

The same with `--scroll-from view`, where the rest of the open lands in
the scroll:

| Size    | Longest frame gap, before | after         | Longest task, before | after       | Frames > 50 ms, before | after | After GC, before | after   |
| ------- | ------------------------- | ------------- | -------------------- | ----------- | ---------------------- | ----- | ---------------- | ------- |
| 300 kb  | 20.1 ± 3.3 ms             | 33.4 ± 4.3 ms | 6.1 ± 6.1 ms         | 10.5 ± 7.0  | 0.0                    | 0.0   | 11.8 MB          | 11.3 MB |
| 1 Mb    | 68.3 ± 3.9 ms             | 56.7 ± 4.4 ms | 27.9 ± 9.4 ms        | 36.7 ± 10.0 | 0.9                    | 0.4   | 17.7 MB          | 16.1 MB |
| 4.64 Mb | 100.0 ± 6.1 ms            | 85.0 ± 3.0 ms | 44.8 ± 11.1 ms       | 69.5 ± 2.2  | 1.9                    | 1.0   | 48.9 MB          | 40.9 MB |

At 4.64 Mb the two frames of 50-100 ms became one of 85 ms. The longest
task reads longer because the receive and the first render are now one task
with no collection between them; before, the collections fell between the
two tasks, in the gap but in no task. At 300 kb the open is done before the
scroll starts, either way; the frame gaps there are within the noise.

`open-profile.ts --scroll` on unminified builds, three runs per size:

| Size    | Receive and first render, before                     | after                                         |
| ------- | ---------------------------------------------------- | --------------------------------------------- |
| 300 kb  | one task of 57-64 ms; busy stretch 77-88 ms, GC 4-8  | 52-59 ms; stretch 65-79 ms, GC 0-0.3          |
| 1 Mb    | one task of 52-68 ms; stretch 118-126 ms, GC 9-17    | 52-74 ms; stretch 40-97 ms, GC 2-4            |
| 4.64 Mb | 85-113 ms and 54-72 ms; stretch 238-288 ms, GC 72-90 | one of 72-85 ms; stretch 138-155 ms, GC 0-0.3 |

In the 4.64 Mb stretch before: `unpackScan` 60-75 ms and the collector
72-90 ms. After: building the packed set (`PackedCutSiteSet`, the counting
sort by enzyme) 16-19 ms, `unpackScan` 2-4 ms, no collection; what is left
is the panel's first render (`gelProfile` 9-14 ms for the rows on screen,
React). Up to a third of each long task the profiler samples as idle, as
before. The autosave's put is unchanged (52-55 ms at open+6.2-6.4 s).

What is made at open, counted in an instrumented build (a counter in the
set's object maker, the bench's sequences, 1400 x 900): with the sequence
view and map alone, nothing is ticked at any of the three sizes (no single
cutters) and no site object is made; with the Enzymes tab open, 308, 322 and
324 objects at 300 kb, 1 Mb and 4.64 Mb, the first twelve sites of each row
the list has drawn, against 446,000 at 4.64 Mb before. A ticked enzyme makes
its own sites' objects when the views first pick it.

## Detect features on repeat-rich input (#288, 2026-10-23)

Detection was quadratic in the number of hits: every reduction step asked
all the hits so far about each new one. A random megabase has few hits, so
the 1 Mb test above never showed it; a tandem repeat has thousands. Profiled
by timing the stages of `detectFeatures` on a tandem of a 2.6 kb unit (forty
short parts, alternating strands), 400 kb: `keepBest` 4.1 s of 5.6 s,
`withRepeats` 0.6 s, the protein search's duplicate check and the rest the
remainder.

Each became a lookup. `keepBest`, `withHomologues`, `substitutionsFirst`
and `fewestEdits` ask an `OverlapIndex` (`overlapIndex.ts`, 512-base buckets)
for the hits near the one in hand, which is every hit that could overlap it;
`withRepeats` finds the next copy of a tag by the base a copy starts at; the
protein search keeps the starts found per part in a set. The hits reported
are unchanged (the corpus tests and the pLannotate oracle pass untouched).

Measured (Node 24, circular, whole `detectFeatures`, `detect.test.ts` perf):

| Input                                 | Hits   | Before  | After  |
| ------------------------------------- | ------ | ------- | ------ |
| 100 kb tandem of the 2.6 kb unit      | 1,521  | 0.74 s  | 0.39 s |
| 400 kb                                | 6,006  | 5.8 s   | 0.72 s |
| 1 Mb                                  | 15,015 | (>40 s) | 1.0 s  |
| 1 Mb of a 942 bp unit ending in 6×His | 9,260  | —       | 1.0 s  |

The "before" for 1 Mb is extrapolated from the doubling, not run.

## Clone-check primers (#311, design note 120, 2026-10-29)

`designCheckPrimers` judges every stretch of a window either side of each
junction by the primer designer's rules, pairs them, scans the product for
each kept primer's other binding sites and runs `pcr` on the clone, the
empty vector and the clone with its insert turned round. Measured in Node 24
on the tutorials' files (`checkPrimers.test.ts`, timings taken ad hoc, not
asserted):

| Product                                                       | Design                           | Time   |
| ------------------------------------------------------------- | -------------------------------- | ------ |
| 3,465 bp one-enzyme ligation, both orientations, empty vector | 15 pairs (two junctions, flank)  | 0.5 s  |
| same, one primer reused                                       | 5 pairs                          | 0.13 s |
| 3,118 bp four-part Golden Gate, fixed                         | 20 pairs (five junctions, flank) | 0.65 s |
| 20 kb random circle, 2 kb insert                              | 10 pairs                         | 1.5 s  |
| 5 kb of a 300 bp tandem repeat as the vector                  | none (scan budget spent)         | 0.5 s  |

Three things brought the first figure down from 1.7 s: the cheap rules (GC
content, homopolymer, Tm) before the full report, whose hairpin and
self-complementarity scans are quadratic; windows that start 218 bp from
the junction and double only while fewer than five pairs come out, since a
colony band is best small anyway; and the dimer and specificity checks run
in order of the rest of the penalty and stopped once no later pair can
beat the five found. `findPrimerBindingSites` itself visits the 3′ anchor
first and compares character codes (2.5 ms a scan at 3.5 kb, from 3.8 ms),
which the Primers tab's designer gains too. What is left is `analyzePrimer`
at about 45 µs a candidate and `pcr` at 4–5 ms a template at 3.5 kb; both
grow with the product, so the design runs in the analysis worker
(`checkPrimers` request) and the page says it is designing.

## Designer after the free-energy checks (#352)

The nearest-neighbour ΔG hairpin and dimer (item 124) and the `pcr`-rule
specificity (#351) pushed four designer tests to 5-8 s on a CI runner.
Profiled single-threaded (`node --cpu-prof`), the time was `dimerEnergy` and
`loopEnergy` (one dimer per candidate pair), then `codeMask` under the
specificity scans (`findPrimerBindingSites`, `pairsWithCode`), then
`hairpinEnergy`. Three changes, none altering a result:

- `hairpinEnergy` and `dimerEnergy` remember their answer by sequence (pair)
  for the default parameters, bounded at 50,000 entries: a primer is asked
  about in every pair it sits in, and a redesign asks the same pairs again
  (the mutation test's reference listing and `designPrimers` share them).
  The plain stack, the commonest loop, is inlined in both DPs.
- `codeMask` of a single ASCII character is a table lookup (the table was
  already there for `sequenceMasks`), which `pairsWithCode` hits per template
  base.
- `annealsElsewhere` builds the `AnnealIndex` once per template and gives it
  to `findAnnealingSites`, rather than walking the whole template per primer.

Node 24, this workstation at load 13-20 (noisy), each test alone, best-of and
range of three runs, ms (limit 5000):

| Test                                             | Before     | After     |
| ------------------------------------------------ | ---------- | --------- |
| `primerDesign.mutation` "matches a slow listing" | 906-1983   | 816-1235  |
| `checkPrimers` "four-part Golden Gate: a pair"   | 1390-2460  | 1251-1419 |
| `primerDesign` "refuses a primer ... elsewhere"  | 1545-1807  | 510-628   |
| `PrimerWorkspace` "commits a typed number"       | ~1100-1200 | 926-2109  |

The workspace test is jsdom and render, not the designer (about 0.2 s of its
profile). What is left in `checkPrimers` is one `foldDimer` per rough pair.

## Hairpin Tm (item 125)

`hairpinTm` rides on the hairpin fold: a second array holds the ΔH of the
helix of lowest ΔG, so the fold costs about 20-25 % more (6,000 primers of
18-27 nt, memo bypassed: 100-144 ms before, 119-170 ms after, 0.02 ms a
primer) and is still memoised by sequence. The designer tests keep their
times (`matches a slow listing` 950-970 ms, the four-part Golden Gate 860-920 ms,
load average 5-7).

## Read assembly (item 76, #353)

After the best-overlap and repeat handling (#347-#350) assembly was about 2x
slower. A CPU profile of 32 reads of a 5 kb region plus 8 unrelated reads put
84 % in the affine alignment fill, and 650 of its ~900 calls were the check
that a read left out of the rounds ("unrelated") still overlaps nothing, made
against every read that joins: two full 700 x 700 fills (both strands, no
shared words to band around, ~25 ns a cell on random sequence) per pair.
`OverlapScreen` (`overlapBound.ts`) now answers that with a plain one-state
local score (+1 a match, -2 for anything else), which is an upper bound on
what an overlap of 25 columns at 90 % can score; a pair that falls short is
not aligned. It is exact (a property test against the aligner is in
`overlapBound.test.ts`), and contigs, layouts, consensus, qualities and
warnings are identical on every oracle scenario and on the 32 + 8 case
(compared as JSON before and after).

Not worth it, measured: caching alignments between rounds (the consensus
text differed in all but 8 of ~800 calls), a branch-free `fillBand` (slower
under V8), a 6-mer diagonal filter (kept 45 % of unrelated pairs: at 90 %
identity over 25 columns the q-gram bound is as weak as a 12-base chance
run), screening `fitsElsewhere`'s spans (the 80 % floor leaves no bar above
what random sequence reaches). What is left is one whole-consensus alignment
per unplaced read per round, ~10 ms each, most of it the check region of a
partial overlap.

Node 24, this workstation at load 0.3-1.3, minimum of three runs:

| Case                                           | Before               | After   |
| ---------------------------------------------- | -------------------- | ------- |
| 32 reads of 5 kb + 8 unrelated, one assembly   | 18.55 s              | 9.53 s  |
| oracle "deep, 14 reads" scenario, 8 replicates | 14.04 s              | 11.03 s |
| oracle file, serial (11 scenarios + the 32+8)  | 70.0 s               | 55.3 s  |
| oracle as four parallel files, wall clock      | (single file, ~48 s) | 16.4 s  |

On CI the oracle ran under coverage on a shared runner (291 s); it is now four
files (`sangerAssembly1-4.test.ts` over `sangerAssemblyHarness.ts`) of about
equal weight, so the runner's cores share it. Same scenarios, same 8
replicates, same gates.
