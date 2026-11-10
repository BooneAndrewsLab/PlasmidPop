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
   `cloning/cloningEnds.ts` (8 calls). **At the scan nothing exported it.**
   `range.ts`'s `normalizePosition` is not this: it maps only
   `position === length` to 0. The sites differ in what they do with a
   zero length (`x % 0` is `NaN`): some guard it (`digest.ts`,
   `gateway.ts`, `restriction.ts`'s `wrap`), some sit behind an earlier
   return, some do neither. Which of the last can be reached with an empty
   sequence is the review's question, per site.
   - On top of it, **the short way round** (`d = wrap(b - a); if (d > n / 2)
d -= n`) is written four times: `cloning/digest.ts:86`,
     `analysis/crisprEdit.ts:326`, `cloning/cloningEnds.ts:336`,
     `app/components/crisprEditing.ts:48` (lines as at the scan; the same
     four call `shortWayRound` at `:85`, `:323`, `:332` and `:49` now).
   - **Fold on a circle, leave as it is on a line.** Found by the code
     review of the wrap, not by the scan: with the arithmetic in one helper,
     what still repeats is the topology test in front of it. As a ternary:
     `document/featureOrigin.ts:49`, `:54`, `:155`, `:260`, `:308`,
     `analysis/crispr.ts:205`, `cloning/cloningEnds.ts:1282`, `:1283`,
     `cloning/digest.ts:92`, `cloning/gateway.ts:243`,
     `primers/primerDesign.ts:396`, `primers/anneal.ts:285`. As an `if`:
     `range.ts:298`, `analysis/crispr.ts:198`, `analysis/orf.ts:144`,
     `cloning/cloningEnds.ts:317`, and the two with their own answer for a
     zero length, `fold` in `featureOrigin.ts:40` (null) and `wrap` in
     `analysis/restriction.ts:220` (0). The sites are not the same rule
     yet: three also ask for a positive length (`digest.ts`, `gateway.ts`,
     `orf.ts`), and they test `topology`, `isCircular` or a local
     `circular`. One line is in two files whole, the base at `i` or `''`
     past either end of a line: `cloning/mutagenesis.ts:159` and
     `primers/anneal.ts:284`. The before/after mutation run says where the
     tests are thin: of the 49 mutants not killed on either side of the
     wrap, 43 are on one of these topology tests or zero-length guards.
2. **The 1-based end of a range that wraps.** `range.ts` has `oneBasedEnd`
   and `formatSpan` (17 files use `formatSpan`). The same fold is derived
   again in `lineage/describe.ts:34`, `io/genbank/madeFromComment.ts:112`,
   `app/sixFrameExport.ts:15`, `app/components/StatusBar.tsx:43`, and as one
   identical line in `PrimerCandidates.tsx:31`, `CloneCheckPage.tsx:26` and
   `components/primerDesign.ts:103`. They agree with `oneBasedEnd` for every
   non-empty range on a non-empty sequence (`end >= 1`, length >= 1; run for
   every length to 40 and every `end` to twice the length and two more), which is all these
   sites format. They part at the corners: on an empty sequence the
   `Math.max(1, length)` copies give 1 and `StatusBar`'s gives `NaN` where
   the helper gives `end`, and `end = 0` on a 1-base sequence gives 1, not 0. So this is the cheapest extraction, the helper existing and tested,
   but each site's guard against an empty range or sequence is to be
   confirmed first.
   `verify/variants.ts:207` prints `end` unfolded; whether a variant's range
   can wrap is to be checked. `io/snapgene/writeSnapGene.ts:122,127` take
   `% length` unguarded. What became of both is under Done.
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
3. Fold on a circle, leave on a line (core 1, its second bullet): the
   per-site table again (which topology test, which zero-length answer),
   and tests of the linear branch and the zero length at each site before
   any helper, since that is where the surviving mutants are. A helper
   beside `normalizePosition` only for the sites that turn out to be one
   rule.
4. IUPAC tables and complement tables (core 4, 5): derive from the one
   source, or pin their agreement in a test where a typed-array table is
   kept for speed.
5. GC (core 3): decide the intended rules first; this may end as a note in
   each function's comment and no extraction.
6. `thermo.ts` and the overlap primer pair (core 7, 8).
7. Components, largest first.
8. Circular scan text (core 6) last: many sites, one line each, and the
   least to gain.

Each extraction follows #432: tests for wraparound and indexing first, a
code review, a before/after mutation run of the touched files, and a new
shared module mutated in full on its first release.

## Done

**The 1-based end (core 2).** The seven copies now call `oneBasedEnd` or
`formatSpan`. `describeLineageRange`, `rangeBounds` and `siteSpan` keep
their names and signatures, since others call them; the two local `span`
functions in `PrimerCandidates.tsx` and `CloneCheckPage.tsx` are gone.
`madeFromComment.ts` takes `oneBasedEnd` and not `formatSpan`, because a
GenBank comment must not carry thousands separators.

The guard at each site, which is what makes the swap change nothing: a
lineage step is refused unless `range.start < range.end` (`lineage.ts`),
and its two tests for a zero-length parent and for a 1-base one give the
same text from the helper; the status bar formats only a non-empty
selection; the six-frame export is reached only past the "at least three
bases" message; a binding site or a product is never empty and never on an
empty document.

Tests added before the swap and passing on both sides of it: `rangeBounds`,
the six-frame file name and header, `siteSpan` and the status bar's "7 to 2",
each across the origin and each ending on the last base (the `end % length`
mistake gives 0 there). The lineage and GenBank-comment sites had wrap
tests already.

An eighth copy was missed by the scan and found by the code review: the
`to` of the span in `app/readBatch.ts`'s `summarizeRow`, written
`wrap(range.end - 1) + 1` with the fold in a closure, so no search for the
one-line form found it. It calls `oneBasedEnd` now and keeps its own case
for a reference that does not wrap. `alignedReferenceRange` gives a range
only when `end > start`, and none for a wrap of 0, so the two agree for
everything that reaches the line. Its test (a read across the origin, one
ending on the last base, one on a line) was added first and passes on both
sides.

The two sites the scan left open:

- `verify/variants.ts`'s `whereVariant` prints `end` unfolded and is right
  to. A variant's coordinates come from a global alignment whose first side
  is the construct's text once, the clone having been turned to the
  construct's origin first (`verify.ts`), so `end` never passes the length.
- `io/snapgene/writeSnapGene.ts`'s `featureRange` is left as it is. It
  writes a segment and also the gap between two segments, whose "end" is
  the next segment's start and can be 0; `oneBasedEnd` is for the end of a
  non-empty range, and the two differ there on a 1-base sequence. A range
  segment cannot exist on an empty document (`assertValidSegment`), so it
  is never given a zero length. `primerRange` beside it is 0-based, a
  different number; whether it can see a zero length was not checked and
  is on #434.

**Position wrap (core 1).** `range.ts` now exports `wrapPosition(position,
seqLength)`. 41 inline folds were swapped for it (two of them in `range.ts`
itself) and the three private helpers (`mod` twice, `wrapMod`) removed with
their 16 calls. With the short way round below taking four of them, 51 calls
in 26 files use it now. Left as they are: `FindBar.tsx`'s three, which cycle
through a list of hits, and the reading-frame phase in
`overlapExtension.ts:399`, which is modulo 3. Neither is a position on a
sequence. Also left, and these are positions: the weaker folds, a bare
`x % length` or `(x + length) % length`, which are right only while `x`
cannot go below 0 or below `-length` (`crispr.ts:193` and `:517`,
`orf.ts:104` and `:109`, `splitCodons.ts:37`, `verify/variants.ts:154`,
`digest.ts:120`, `gateway.ts:549`, `editing.ts:97`,
`alignmentSearch.ts:115`, `CrisprPrimeEditing.tsx:248`,
`readBatch.ts:185`). They are not the helper's expression, so a swap would
not be textual: each needs its input range shown first. #434 lists them.

- **A zero length gives `NaN`, as before.** The helper is the expression
  and no more, so every swap is textual and no site's result changes for
  any input. A helper that answered 0 was considered and dropped: the sites
  that guard a zero length do not agree on the answer (null in
  `featureOrigin.ts`'s `fold`, 0 in `restriction.ts` and `gateway.ts:485`,
  the position as it came in `digest.ts`, `orf.ts`, `gateway.ts:243` and
  `alignmentVerdict.ts`). Each guard stays where it was.
  - `EnzymeTable.tsx`'s `readRange` had no guard and ended its loop on the
    `NaN`: with a 0 there it would not have ended. The code review found
    that the one site whose result hung on the `NaN`, so it now returns
    `''` for an empty document before the loop, which is what the `NaN`
    gave. No test reaches it: `readRange` reads round a cut site, and an
    empty document has none.
- **Can a zero length reach an unguarded site?** Twelve files guard at the
  site or return before it (`methylation.ts`, `restriction.ts`, `orf.ts`,
  `digest.ts`, `gateway.ts`, `anneal.ts`, `checksum/align.ts`,
  `readAlignment.ts`, `alignmentVerdict.ts`, `editing.ts`,
  `components/primerDesign.ts`, `EnzymeTable.tsx`), as do `fold` in `featureOrigin.ts` and
  `primerDesign.ts:396`. In `translated.ts`, `bidirectional.ts:53` and
  `mutagenesis.ts` the `NaN` indexes an empty text and reads as past the
  end, which is right. The rest (`featureOrigin.ts` after `fold`,
  `crispr.ts`, `crisprEdit.ts`, `bidirectional.ts`'s `before`, `pcr.ts`,
  `cloningEnds.ts`, `checkPrimers.ts`, `primerDesign.ts:335`,
  `alignmentSearch.ts`, `crisprEditing.ts` and the three
  renderers' mismatch marks) fold a position taken from a hit, a site, a
  guide or a mark, which an empty sequence has none of. That was checked
  by run and not by proof: with the helper made to log every call with a
  length that is not positive, the whole suite (8,421 tests) logged none
  but the helper's own test.
- **The short way round** is `shortWayRound(offset, seqLength)`, the offset
  folded into `(-length / 2, length / 2]`, at the four sites listed above.
  All four had the same tie rule. `crisprEdit.ts:215` folds the other way
  at the tie (`[-half, length - half)`) and is left alone.
- **Cost.** 12 million folds in a loop, inline against the imported
  helper, Node 25 on `ridiculousbuild`: 232 ms and 233 ms. V8 inlines it.
  Only V8 under Node was measured, not Firefox or Safari;
  `docs/perf-notes.md` has the set-up.
- **Tests.** `range.test.ts`: positions on the sequence, at and past the
  end (0-based: position `length` is base 0), negatives, multiples of the
  length (0 and never -0), the forward distance, a sweep of every position
  three turns either way for five lengths, and the zero length; the same
  for `shortWayRound` with the tie on even and odd lengths. No site's own
  tests changed.
- **Mutation.** Both helpers are new lines in `range.ts`. The three private
  helpers' mutants and the inline arithmetic's at each site are removed by
  the refactor, not killed; the run below reports them apart from kills.

**Before/after mutation run, both refactors as one diff.** `8da3dfa`
against `35f2cdc`, so without the `readRange` guard and the `readBatch`
swap, which the review brought after. On each side Stryker mutated only the
lines the other side does not have (the lines taken away, before; the lines
put in, after), every mutant run and none read from the incremental file,
with the tests `mutate:changed` picks for those files (431 and 433 test
files), in a worktree of its own so the release baseline in
`reports/mutation` was not touched.

| Changed lines | Before | After |
| ------------- | ------ | ----- |
| Mutants       | 378    | 185   |
| Killed        | 271    | 121   |
| Survived      | 91     | 51    |
| No coverage   | 12     | 12    |
| Timed out     | 2      | 1     |
| Ignored       | 2      | 0     |

- **Killed by tests: none new.** 136 mutants have the same text on both
  sides and every one kept its status (87 killed, 44 survived, 4 without
  coverage, 1 timed out). No site's tests changed, so this is as expected.
- **Removed by the refactor: 242** (184 killed, 47 survived, 8 without
  coverage, 2 ignored, 1 timed out). Of the 47 survivors, 7 are still there
  under another text (the helper's name inside the mutated expression) and
  40 went with the arithmetic they mutated: the two `span` functions (14),
  `StatusBar` (3), the two renderers' mismatch marks (6),
  `components/primerDesign.ts` (3), `checkPrimers.ts` (4),
  `primers/primerDesign.ts` (2), `editing.ts`, `alignmentSearch.ts`, and the
  short way round in `cloningEnds.ts`, `crisprEdit.ts` (4) and
  `crisprEditing.ts`. The 8 without coverage are back under the new name
  too (`cloningEnds.ts:1299`).
- **New code:** the helpers' 16 mutants in `range.ts`, all killed. No new
  survivor anywhere.
- **Survivors, 91 to 51:** 51 unchanged, 40 removed, none killed.
- **The score on these lines goes down, 72.6% to 65.9%**, and that is not a
  loss of testing: most of what was removed was killed, so what is left is
  weighted to the survivors both sides share.
- **What the smaller number hides.** The 40 were gaps in the sites' tests
  as they stood before (nothing asserted what the two `span` functions
  wrote; nothing reached the far half in `crisprEdit.ts`). The status
  bar's three have a test since the swap, the "7 to 2" one. The other 37
  sites have none new, so they are gaps still. The arithmetic is tested
  once, in the helper; a site that stopped calling it would not be caught
  at those sites, and Stryker has no mutant that drops a call, so the
  report no longer says so.
- **Where the shared survivors are:** 43 of the 49 mutants not killed on
  either side are on a topology test or a zero-length guard beside a fold.
  That is the next candidate (core 1, second bullet) and #434.
- **Timeouts.** `methylation.ts:301` (`i++` to `i--`) on both sides and
  `EnzymeTable.tsx:73` before are loops that do not end, stopped by the hit
  limit. `checkPrimers.ts:167` (`norm` to `() => undefined`) was killed
  before and timed out after with nothing but the clock against it; run
  alone it is killed by the same test, and the table counts it so.

**Code review** of both refactors (`8da3dfa..35f2cdc`, one independent
reviewer, high effort). It found no change of behaviour. Its ten findings
and what became of each:

1. The eighth 1-based-end copy in `readBatch.ts`: swapped, above.
2. No outcome written for `whereVariant` and `featureRange`: written, above.
3. This note's line numbers for the short way round were the scan's, and
   "nothing exports it" was in the present tense: both corrected.
4. The timing was only here and only for V8: now in `docs/perf-notes.md`,
   which says what was not measured.
5. `readRange`'s loop ended on the `NaN`: guarded, above.
6. About fifteen sites fold with no zero-length guard, shown safe by a run
   and not by proof, while an empty circular document can be made ("Make
   circular" on an empty one): #434, a test per entry point, a guard only
   where a `NaN` gets out.
7. The weaker folds were left and not named: named above and on #434.
8. Two things still repeat. The one-line closures (`norm` four times in
   `checkPrimers.ts`, once in `primers/primerDesign.ts`, `wrap` in
   `components/primerDesign.ts`) stay: each is shorthand in a function that
   folds several positions onto one length, and holds no arithmetic now.
   The topology test in front of the fold is a new candidate (core 1,
   second bullet; step 3 of the order).
9. The tests expect English thousands separators and nothing pins the
   locale of the run. The new tests follow the old ones in this: #435.
10. The reasoning for the wrap reached this note five commits after the
    first code that cites it. The branch is consistent at its tip and the
    history is left as it is.

**Call sites no test reached (#436).** Stryker has no mutator that drops a
call, so a site that calls `wrapPosition`, `shortWayRound`, `oneBasedEnd` or
`formatSpan` has no mutant for the helper's arithmetic, and the before/after
run above could not show whether a site still calls it.
`scripts/dropCallProbe.mjs` is the check: for each call outside `range.ts` it
puts the call's first argument in its place (for `formatSpan` the text
unfolded, `start + 1` and the raw end), runs `vitest related` on that file,
puts the file back (also on SIGINT/SIGTERM) and says whether anything failed.
It took 96 sites: 51 of `wrapPosition`, 4 of `shortWayRound`, 8 of
`oneBasedEnd` and 33 of `formatSpan`, about an hour on an idle machine
(`node scripts/dropCallProbe.mjs`, `--helper`, `--file`, `--list`).

- **First run:** 46 of the 96 survived: 27 of `formatSpan`, 17 of
  `wrapPosition` (one, `alignmentSearch.ts:41`, was first a harness fault and
  a rerun showed it survived), 1 of `shortWayRound` and 1 of `oneBasedEnd`.
  Of the sites the issue names, about half were already killed (`crisprEdit`,
  `cloningEnds` apart from `:332`, `editing.ts:74` and `:232`, `checkPrimers.ts:379`,
  `primerDesign.ts:335`); most survivors were `formatSpan` sites of the panels,
  which no test fed a wrapping range.
- **Tests added** for 38 of them, each through the site's own entry point with
  a range through the origin, a position at or past the length, or an offset
  over half the circle, the linear case beside it, and where the site numbers
  for the user the value on the last base (`L`, not 0): the panels'
  selection, feature and window texts, the guide, pair and pegRNA tables, the
  clone-check and cloning pages, `selectionAfterOp`, `designPegRnas`,
  `partJunctions`, the cloning ends with the origin inside, at and next to
  each cut, `rejoinPieces` and located qualifiers, the linear view's and the
  strip's mismatch marks. A test that "kills" a site is checked to pass first
  (a failing test makes every site look killed).
- **Left, each with a reason (8 sites, still not failing under the probe).**
  None is a bug; each is equivalent for every input its entry point can make.
  - `ProteinPanel.tsx:70` (`formatSpan`): a protein document is always linear
    (`SeqDocument` throws otherwise), so a selection never ends past the
    length and `oneBasedEnd` returns its argument.
  - `view/linear/joinGaps.ts:120` (`oneBasedEnd`): `JoinGap.end` is the
    folded boundary in `(0, seqLength]` by construction (`joinGaps` folds an
    earlier segment that wraps), so the call returns its argument.
  - `core/cloning/cloningEnds.ts:1299`: the cut sites come from
    `findCutSites`, which folds every circular cut into `[0, L)`, so the fold
    is the identity there. A hand-built context with an unfolded cut would
    differ; none is made.
  - `core/cloning/pcr.ts:181`: `findAnnealingSites` gives starts in `[0, L)`
    and ends at most one primer past `L`, and the `else if (span <
annealLength) span += L` on the next lines adds `L` back to whatever the
    fold took below the run, which is all it changes. Checked by running the
    suite with the fold removed, and by a test of a reverse primer behind the
    forward one that passes either way.
  - `core/cloning/checkPrimers.ts:449`: the fold is in the key of the
    specificity cache, so it only decides whether a candidate at `s` and at
    `s + L` are scanned once or twice; the verdicts are the same and `scans`
    is reported by nothing.
  - `core/document/featureOrigin.ts:155`: `at` only goes on into `toOwn` and
    `fromOwn`, which fold again, so only `at` modulo `L` is ever read.
  - `app/alignmentSearch.ts:41`: for `position` from 1 and an offset under the
    wrap, `i` is in `(-wrap, wrap)`, and `column.get(i) ?? column.get(i +
wrap)` on the next line already adds the wrap back for a negative `i`.
  - `view/circular/renderCircular.ts:838`: only feeds `angleOf`, which for a
    circular layout has no gap (`gap` is 0), so the angle is periodic and the
    tick lands in the same place with or without the fold.
- **Second run:** all 96 sites, after the tests above bar the last one: 9
  survived, the 8 above and `cloningEnds.ts:332`, which the first tests
  killed only through a case later changed and which a count of the usable
  pairs with the origin at each cut now kills; `--file cloning/cloningEnds.ts`
  was run again after that. So 8 are left, each with the reason above. Part 2
  of the issue (the 43 topology and zero-length mutants) is untouched and
  stays with #434 and step 3 of the order.

**The empty circular document (#434).** "Can a zero length reach an
unguarded site?" above was answered by one logging run. The kept answer is a
test per entry point, each calling it with a circular document of length 0
built as the app builds one (`SeqDocument.create({ sequence: '' })
.setTopology('circular')`; `seqDocument.test.ts` also records that deleting
every base of a circle leaves it circular, and that the one feature either
can hold is a site, since a range segment must cover a base) and asserting
the result: the empty list, null, the problem text, the input unchanged, and
no `NaN` in any range, segment or drawn coordinate (`src/test/noNaN.ts`
spells a `NaN` out before `JSON.stringify` writes it as `null`). The
`describe('an empty circular document (#434)')` blocks sit in each site's own
test file, so `vitest related` and the drop-the-call probe pick them up.

- **Entry points tested (23 files, 28 tests):** `originRecord`,
  `placementOf`, `pieceOrigin`, `rejoinPieces`, `extractRange`;
  `findCrisprGuides` (with a region, and as a background document),
  `designPegRnas`, `pairNickases`, `findOrfs`, `codonPieces`;
  `detectFeatures`, `splitStrands`, `inUseStrands`, `placeVariants`; `pcr`,
  `suggestEnzymePairs`, `evaluateEnzymePair`, `designCloningEnds`,
  `designCloningResults`, `longestSharedStretch`, `locateInsert`,
  `partJunctions`, `flipInsert`, `attSites`, `gateway`, `digest`,
  `partialDigest`, `designPrimers`, `findPrimerBindingSites`,
  `designAnchoredPrimers`, `annealsElsewhere`; `typeText`, `pasteFragment`,
  `deleteBackward`, `deleteForward`, `clampPosition`, `columnOfPosition`,
  `findMotif`, `runReadBatch` with `summarizeRow`, the Prime page's "Use the
  selection"; `renderRibbon`, `renderLinearView`, `renderCircularMap` with
  a primer preview left open; `writeSnapGene`.
- **Sites guarded: none.** No test showed a `NaN` in a range, a segment or a
  drawn coordinate, so no production line changed and `wrapPosition` is as
  it was. Every site is safe for one of four reasons, named in its test:
  - _returns before the fold_: `renderRibbon.ts:143` (`L === 0`),
    `renderCircular.ts:778` (`drawOverlays`), `digest.ts:136`,
    `gateway.ts:537`, `designPrimers` (`primerDesign.ts:394`),
    `findPrimerBindingSites`, `columnOfPosition` (no base in any column
    comes before the wrap), `alignedReferenceRange` (no range for a wrap of
    0, so `readBatch.ts:185` never folds), `writeSnapGene` (refuses the
    document);
  - _folds per hit, site, guide, pair, candidate or codon, of which an empty
    sequence has none_: `crispr.ts` (`pamWindows` gives no window to a
    sequence shorter than spacer and PAM), `crisprEdit.ts` (the guide list;
    note that an insertion at 0 replacing nothing passes `primeEditProblem`
    on an empty circle, so the guide list is the only thing in the way),
    `bidirectional.ts`'s `before`, `pcr.ts:181`, `cloningEnds.ts:317` and
    the simulation, `checkPrimers.ts` (`longestSharedStretch` finds nothing
    shorter than a k-mer, so the page gets no geometry), `crisprEditing.ts`'s
    `pairSpan`, `orf.ts` (`scanCircle` wants six bases), `splitCodons.ts`,
    `findMotif`;
  - _the only feature an empty document holds is a site_: `featureOrigin.ts`
    (every fold comes after `rangesOf`, which has no range for a site),
    `variants.ts:154` (`touches` is asked per feature with a range),
    `writeSnapGene.ts`'s `primerRange` (`asPrimer` passes a site over);
  - _the only selection an empty document has is the caret at 0_:
    `editing.ts:97` (a replacement takes a non-empty selection) and
    `CrisprPrimeEditing.tsx:248` (the fold is for a non-empty selection).
  - `renderLinear.ts:1142` is a fifth: the document's one row covers no base,
    so the preview's pieces clip to nothing before the marks.
  - `primerDesign.ts:335` does fold a `NaN` (the site's own 3′ end) and
    compares it with the ends of the sites found, of which there are none,
    so `annealsElsewhere` answers false and nothing carries the `NaN` on; the
    test records that rather than guarding it.
- **Weaker folds** (`a % L`, `(x - 1 + L) % L`; the Related list of #434) are
  covered by the same tests where the entry point reaches them with a zero
  length: `crispr.ts:194`, `:517`; `orf.ts:104`, `:109`; `splitCodons.ts:37`;
  `variants.ts:154`; `digest.ts:120`; `gateway.ts:549`; `editing.ts:97`;
  `alignmentSearch.ts:115`; `CrisprPrimeEditing.tsx:248`;
  `writeSnapGene.ts:122`, `:259`; `readBatch.ts:185`. None was rewritten.
- **Not covered here:** `baseEditWindow` and `pairSpan` take a guide or a
  pair as their argument and cannot be called without one, so their tests
  are of the list that would feed them. Part 2 of #436 and step 3 of the
  order (the topology tests) are still where they were.
