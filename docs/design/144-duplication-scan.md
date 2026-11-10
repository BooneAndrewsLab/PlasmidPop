# 144. Duplication scan (#432)

What was asked: find logic written several times and say which copies are
worth a shared helper, before changing anything. This note is the scan and
the first triage; extractions follow as their own commits.

## The scan

`jscpd@4` over `src/`, run once with `npx` (not a dependency), tests,
`src/test/` and `.d.ts` excluded, `--min-lines 8 --min-tokens 70`:

    npx jscpd@4 src --min-lines 8 --min-tokens 70 --format typescript,tsx \
      --ignore "**/*.test.ts,**/*.test.tsx,**/test/**,**/*.d.ts"

Result: 52 exact clones, 1,512 duplicated lines of 640 files (1.18%). The
repo is not copy-pasted at large. Exact-token matching sees only literal
copies, so the second half of this note is a grep for reimplemented domain
rules, which jscpd cannot see.

## Where the clones are

| Area                       | Clones | Largest   | Note                        |
| -------------------------- | ------ | --------- | --------------------------- |
| `src/app/components/`      | 43     | 169 lines | all but a handful of the 52 |
| `src/core/`                | 6      | 17 lines  | small                       |
| `src/io/`                  | 3      | 17 lines  | small                       |
| `src/app/` (non-component) | 3      | 14 lines  | state stores, batch runners |

Components, ranked by lines times sites:

1. `CloningCandidates` / `GoldenGatePartResult` / `HomologyEndsResult`: a
   shared candidate-result body, 169 + 53 + 33 + 28 + 15 + 15 lines across
   the first two.
2. `GibsonPanel` / `YeastAssemblyPanel`: 122 + 54 + 33 + 27 + 15 + 13 lines,
   the same assemble-panel shell.
3. `CrisprPairedNickases` / `CrisprPrimeEditing`: 165 lines.
4. `EmptyState` against itself: 95 + 73 lines (two variants of one block).
5. `AlignmentCopyPanel` / `MsaCopyPanel`: 28 + 21 + 19 lines.
6. `OverlapPrimerDesign` / `SoePanel` / `MutagenesisPanel`: 31 + 12 + 12 + 22.
7. `BatchProtocolDialog` / `ProtocolDialog`: 31 + 19.
8. `CircularMapView` / `DiffMap`: 28 + 22, the map-drawing plumbing.
9. `EnzymeImport` / `FidelityReport`: 34 + 15 + 12.
10. `myParts` / `primerCollection` stores: 14 + 11.

## Core and io clones

- `core/cloning/overlapAssembly.ts` and `overlapPrimers.ts` (17 lines): both
  build the forward and reverse `OverlapPrimer` from a tail and an anneal.
  Same domain rule (strand flip via `reverseComplement`) in two files, so
  this ranks first of the core ones despite its size.
- `core/lineage/lineage.ts` and `io/genbank/madeFromComment.ts` (17 lines):
  the `LineageOp` name table. Both are `Record<LineageOp, true>`, so the
  compiler already forces them to agree; low risk, one export would do.
- `core/primers/thermo.ts` (17, internal), `core/annotate/homologue.ts` (12,
  internal), `io/snapgene/parseSnapGene.ts` (10, internal), `io/detect.ts` /
  `parseAbif.ts` (16): not yet read; review before deciding.

## Domain rules reimplemented (not found by jscpd)

**Circular position wrap.** `core/range/range.ts` exports
`normalizePosition(position, seqLength, topology)`. Inline copies of
`((x % length) + length) % length` exist in `analysis/restriction.ts:220`,
`analysis/crisprEdit.ts:326`, `cloning/digest.ts:86,97,125`,
`annotate/bidirectional.ts:86`, `verify/variants.ts:154`,
`app/components/crisprEditing.ts:48`. Eight sites in six files. They differ
at the edges (`length === 0` guarded in two, not in the others; one takes
`% length` without the add-back, valid only when the input is non-negative),
which is the kind of disagreement the issue calls a correctness risk. This
is the strongest candidate: the review must list, per site, the range of
inputs and whether `length === 0` can occur.

Not yet scanned: 0- vs 1-based conversions, strand flipping of feature
coordinates, interval overlap, IUPAC matching. Each needs a semantic grep,
not a clone detector.

## Order for the review

1. Circular wrap: per-site review, then tests for wraparound and the
   zero-length case on `normalizePosition`, then one commit per file.
2. `OverlapPrimer` construction (core, domain-relevant).
3. Component shells (1, 2, 3 above) by call sites; the issue's test is
   whether the helper is simpler than the copies or only more indirection.
4. The remaining items as time allows; `LineageOp` table last.

Each extraction follows the rules in #432: tests for wraparound and
indexing first, a code review, a before/after mutation run of the touched
files, and a new shared module mutated in full on its first release.
