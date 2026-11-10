# 144. Duplication scan (#432)

What was asked: find logic written several times and say which copies are
worth a shared helper, before changing anything. This note is the scan and
the first triage. Nothing is changed here; the per-candidate review and the
extractions follow as their own commits.

## The scan

Two kinds of search, because they find different things.

**Literal clones.** `jscpd@4`, run with `npx` (not a dependency), tests,
`src/test/` and `.d.ts` excluded:

    npx jscpd@4 src --min-lines 8 --min-tokens 70 --format typescript,tsx \
      --ignore "**/*.test.ts,**/*.test.tsx,**/test/**,**/*.d.ts"

52 clones, 1,512 duplicated lines of 128,117 in 640 files (1.18%). A second
run over everything but `src/app/`, at `--min-lines 5 --min-tokens 50`, finds
15 clones and 149 lines (0.3%).

| Where both copies are      | Clones | Lines |
| -------------------------- | ------ | ----- |
| `src/app/components/`      | 43     | 1,438 |
| `src/core/`                | 3      | 46    |
| `src/core/` and `src/io/`  | 1      | 17    |
| `src/io/`                  | 2      | 26    |
| `src/app/state/`           | 2      | 25    |
| `src/app/` (batch runners) | 1      | 12    |
| `src/view/`                | 0      | 0     |

So the literal copying is in the components, as #432 expected, and almost
nowhere else.

**Rules written again.** A clone detector matches tokens, so it cannot see a
domain rule that two modules each wrote in their own words. Those were
searched for by pattern (`grep`), one rule at a time: wrapping a position,
1-based ends, GC content, IUPAC sets, complement tables, reading round the
origin, interval overlap, strand flips. The greps are single-line and by
shape, so each count below is a floor.

## Core: rules with more than one implementation

Ranked by risk, which is what #432 asks of the core.

1. **Wrapping a position onto a circle**, `((x % n) + n) % n`. At least 44
   inline occurrences in 28 files (`cloning/checkPrimers.ts` 5,
   `primers/anneal.ts` 3, `cloning/gateway.ts` 3, `app/editing.ts` 3, two each
   in `range.ts` itself, `primerDesign.ts`, `digest.ts`, `bidirectional.ts`,
   `crispr.ts`, `crisprEdit.ts`, and one each in 18 more, three of them in
   `src/view/`). Three files have a private helper for it: `mod` in
   `document/featureOrigin.ts` and in `analysis/crisprEdit.ts`, `wrapMod` in
   `cloning/cloningEnds.ts` (8 calls). **Nothing exports it.**
   `range.ts`'s `normalizePosition` is not this: it maps only
   `position === length` to 0. The sites differ in what they do with a
   zero length (`x % 0` is `NaN`): some guard it (`digest.ts`,
   `gateway.ts`, `restriction.ts`'s `wrap`), some sit behind an earlier
   return, some do neither. Which of the last can be reached with an empty
   sequence is the review's question, per site.
   - On top of it, **the short way round** (`d = wrap(b - a); if (d > n / 2)
d -= n`) is written four times: `cloning/digest.ts:86`,
     `analysis/crisprEdit.ts:326`, `cloning/cloningEnds.ts:336`,
     `app/components/crisprEditing.ts:48`.
2. **The 1-based end of a range that wraps.** `range.ts` has `oneBasedEnd`
   and `formatSpan` (17 files use `formatSpan`). The same fold is derived
   again in `lineage/describe.ts:34`, `io/genbank/madeFromComment.ts:112`,
   `app/sixFrameExport.ts:15`, `app/components/StatusBar.tsx:43`, and as one
   identical line in `PrimerCandidates.tsx:31`, `CloneCheckPage.tsx:26` and
   `components/primerDesign.ts:103`. They agree with `oneBasedEnd` for every
   `end >= 0` (checked by hand: the guard differs, the value does not), so
   this is the cheapest extraction: the helper exists and is tested.
   `verify/variants.ts:207` prints `end` unfolded; whether a variant's range
   can wrap is to be checked. `io/snapgene/writeSnapGene.ts:122,127` take
   `% length` unguarded.
3. **GC content: six implementations, three rules.**
   `analysis/gcContent.ts` weighs IUPAC codes and leaves N out of the
   denominator. `primers/thermo.ts`'s `gcFraction` counts G, C and S over
   every base. `cloning/yeastAssembly.ts`'s `gcPercent`,
   `analysis/recode.ts`'s `gcCount`, `analysis/crisprEdit.ts:245` and
   `analysis/crispr.ts:434` count G and C only (the last three on text
   already upper-cased and, in `crisprEdit.ts`, already ACGT-only).
   `primers/primerDesign.ts:113` has a fourth reading, a min and max over a
   degenerate primer. The review decides which differences are meant (a
   primer's GC and a window's GC need not be one number) and which are just
   separate.
4. **IUPAC code to bases.** `analysis/codons.ts` exports `IUPAC_SETS`, and
   `analysis/search.ts` (the bitmasks restriction and find use) and
   `primerDesign.ts` derive from it. Written by hand again:
   `assembly/assemble.ts:1181` (as strings), `alignment/scoring.ts:89` and
   `annotate/detect.ts:181` (as bitmasks, same bits as `search.ts`), and
   inverted in `assembly/consensus.ts`. Four tables that must agree and are
   not tied together.
5. **A, C, G, T complement table**, three private copies beside
   `sequence/alphabet.ts`'s full one: `annotate/bidirectional.ts:47`,
   `primers/thermo.ts:44`, `primers/structure.ts:538`.
6. **Reading past the origin for a scan.** `text + text.slice(0, k - 1)` in
   nine files (`verify/verify.ts` twice, `analysis/search.ts`, `orf.ts`,
   `restriction.ts`, `crispr.ts`, `primers/primerDesign.ts`,
   `cloning/yeastAssembly.ts`, `app/readAlignment.ts`), a whole doubling in
   five more, and the typed-array form three times in `annotate/`
   (`protein.ts:247` and `homologue.ts:265` identical, `detect.ts:351` a
   variant). Each is one line; what repeats with it, and matters more, is
   the rule for hits that start past the length.
7. **Nearest-neighbour sum**, `primers/thermo.ts:56` and `:103`: 17 lines of
   `meltingTemperature` repeated in `q5MeltingTemperature`.
8. **A primer pair for one insert**, `cloning/overlapPrimers.ts:151` and
   `overlapAssembly.ts:140` (17 and 11 lines): the multi-insert design
   repeats the single one's annealing growth and primer records.

Small, low risk: the `LineageOp` name table in `lineage/lineage.ts` and
`io/genbank/madeFromComment.ts` (both `Record<LineageOp, true>`, so the
compiler already makes them agree); `nameFromFilename` in `io/detect.ts` and
`io/abif/parseAbif.ts`; a `slug` in `analysis/codonUsage.ts` and
`cloning/moclo.ts`; the head of `parseRange` and `parsePrimerRange` in
`io/snapgene/parseSnapGene.ts`; the seed loop twice in
`annotate/homologue.ts`. Listed by jscpd and not yet read: `lineage.ts:360`
with `storage/historyFormat.ts:164`, `workers/analysisClient.ts:123` with
`saveClient.ts:57`, and same-file pairs in `featureOrigin.ts`,
`primerDesign.ts`, `orf.ts` and `storage/historyCodec.ts`.

**Looked for and found shared already:** reverse complement (one
implementation, `alphabet.ts`); splitting a wrapping range (`rangePieces`,
used in 21 files; three places slice by hand, `checkPrimers.ts:252,353` and
`primerDesign.ts:207`); interval overlap (`rangesOverlap`; two hand copies,
`view/linear/lanes.ts:47` and `app/alignmentDifferences.ts:212`); flipping a
range (`flipRange`); downloads (`app/saveFile.ts`; the one other
`createObjectURL` is the map PNG).

**Not searched:** 0- to 1-based conversion on input (it is one `- 1` at each
parser and has no shape to grep for), and codon reading round the origin on
either strand, which `annotate/bidirectional.ts` and `translated.ts` each do.

## Components

By lines, with what the copy is:

1. `GibsonPanel` / `YeastAssemblyPanel`: 122 + 54 + 33 + 27 + 15 + 13 lines.
   `GibsonPanel.tsx` is 288 lines, so most of it is in both: `PartRow`,
   `JoinRow` and the panel body.
2. `CloningCandidates` / `GoldenGatePartResult` / `HomologyEndsResult`:
   169 + 53 + 33 + 28 + 15 + 15 lines between the first two (`OligoRow`
   whole, the detail body, the `BLAST_ANNEALING` constant), 24 + 13 + 11 with
   the third.
3. `CrisprPairedNickases` / `CrisprPrimeEditing`: 165 lines, the virtualised
   table (`Spacer`, `ROW_ESTIMATE`, the scroll body).
4. `EmptyState` against itself: 95 + 73 lines, two overlapping reports of
   one repeated block.
5. `AlignmentCopyPanel` / `MsaCopyPanel`: 28 + 21 + 19.
6. `OverlapPrimerDesign` / `SoePanel` / `MutagenesisPanel`: 31 + 22 + 12 + 12.
7. `BatchProtocolDialog` / `ProtocolDialog`: 31 + 19.
8. `CircularMapView` / `DiffMap`: 28 + 22.
9. `EnzymeImport` / `FidelityReport`: 34 + 15 + 12.
10. `app/state/myParts.ts` / `primerCollection.ts`: 14 + 11.

None of these was read past its outline. For each, the review has to say
whether a shared component is simpler than the two copies or only more
props.

## Order for the review

1. The 1-based end (core 2): replace the seven copies with `oneBasedEnd` /
   `formatSpan`. No new module, so no new mutation surface.
2. Position wrap (core 1): the per-site table first (input range, can the
   length be 0), then one exported helper in `range.ts` with tests for
   negatives, multiples of the length and a zero length, then one commit per
   module. `range.ts` is a new mutation surface only for the helper's lines.
3. IUPAC tables and complement tables (core 4, 5): derive from the one
   source, or pin their agreement in a test where a typed-array table is
   kept for speed.
4. GC (core 3): decide the intended rules first; this may end as a note in
   each function's comment and no extraction.
5. `thermo.ts` and the overlap primer pair (core 7, 8).
6. Components, largest first.
7. Circular scan text (core 6) last: many sites, one line each, and the
   least to gain.

Each extraction follows #432: tests for wraparound and indexing first, a
code review, a before/after mutation run of the touched files, and a new
shared module mutated in full on its first release.
