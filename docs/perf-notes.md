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
ordered pair of parts, so it is `maxOverlap` string comparisons per pair.

| Date       | Reaction                        | Product   | Time   |
| ---------- | ------------------------------- | --------- | ------ |
| 2026-09-22 | 6 parts of 2 kb, 30 bp overlaps | 12,000 bp | 1.0 ms |

Node 24 (V8), `gibson.test.ts` perf, mean of 10 runs, including building the
product document. Six parts is the practical ceiling of the one-step
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
the two primers also prime in enough other places to give six more products. Linear in the length, as
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
