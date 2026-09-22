# Performance notes

Measurements that back the "plain TS first, WASM only when justified" rule
in CLAUDE.md. Re-run the quoted test and update this file when the
implementation changes.

## Pairwise alignment (Gotoh affine, global)

| Date       | Input            | Cells | Time   | Where                                 |
| ---------- | ---------------- | ----- | ------ | ------------------------------------- |
| 2026-09-17 | 3,000 × 2,940 bp | 8.8 M | 278 ms | Node 24 (V8), `pairwise.test.ts` perf |
| 2026-09-18 | 3,000 × 2,940 bp | 8.8 M | 1.8 s  | GitHub Actions ubuntu-latest runner   |

About 30 ns per cell including traceback bookkeeping, ~3 bytes per cell of
traceback memory. Extrapolated: 5 kb × 5 kb ≈ 0.8 s and 75 MB; 10 kb × 10 kb
≈ 3 s and 300 MB. The in-browser limit is set to 30 M cells (roughly
5.5 kb × 5.5 kb) and alignment runs in the analysis worker so the UI never
blocks.

Decision: no WASM for v1. Plasmid-scale alignments finish in well under a
second. Revisit (Rust/WASM plus a banded or linear-space algorithm) if
alignment of >10 kb inputs becomes a requested workflow.

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
