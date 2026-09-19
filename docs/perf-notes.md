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
