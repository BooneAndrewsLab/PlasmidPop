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

## Restriction scanning

Full 130-enzyme scan of a 4.4 kb plasmid completes in a few milliseconds
(see `render.smoke.test.ts`, which runs the scan as part of the renderer
smoke test). Not a WASM candidate at plasmid scale.
