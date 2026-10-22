# 50. Mutation testing before a release

Done, 2026-09-24 (#77; `stryker.config.json`,
`scripts/patch-stryker-vitest.mjs`). Stryker mutates the modules added in
1.4, and since 1.6 the ones 1.6 added (the diff's feature pairing, the
history and its stored form, the made-from lineage and its GenBank block,
FASTQ, extracting a range, share links), since 1.7 the ones 1.7 added
(the primer collection, Detect features' matcher and library, the NCBI
client, base styles and their GenBank block, protein properties, Open as
protein, the alphabet and the tools it allows), and runs, for each mutant, the tests that cover it, to find code the
tests reach but do not check.

## When it runs

Only as the step before a release: `npm run mutate`, after `npm run check`
passes and before the version is bumped. It is not part of `npm test`,
`npm run check` or CI, because it takes too long for any of them. The run
is incremental: `reports/mutation/stryker-incremental.json` (gitignored,
kept on the machine that ran it) records every verdict, and a later run
retests only the mutants whose code or covering tests changed. The first
full run took 60 minutes; the incremental run after the new tests took 25.

Survivors in the HTML report (`reports/mutation/mutation.html`) are triaged
as a missing test, an equivalent mutant (no observable change), dead code
or not worth a test. Missing tests are written before the release.

## What had to be fixed first

- **`vitest.related` is off.** On, a mutant whose tests import through
  `@/core` ran no tests at all and was counted as survived.
- **Static mutants are ignored** (`ignoreStatic`). Code run while a test
  file loads needs the whole suite for each mutant, about 4 minutes, and
  thousands of them would take days. Fixtures of the tests covering these
  modules were moved from describe bodies into the tests, which turned
  most of them into ordinary mutants; 113 static ones remain.
- **Vitest 5 broke the runner** (stryker-js#6210, open). Its per-test
  filter joins a test's describe chain with `' '`, Vitest 5 matches the
  pattern against names joined with `' > '`, so every mutant ran zero
  tests and survived. `scripts/patch-stryker-vitest.mjs` rewrites both
  copies of the runner's name function (the setup file that runs inside
  the tests inlines its own) before each run, and warns when the runner
  changes. A score near 0%, or "0.00 tests per mutant", means the patch no
  longer applies.

## First results

The first full run scored 77.8%: 645 mutants survived and 82 were not
covered, most in primer design, PCR and Gibson. Triage wrote tests for
about 510 of them (exact messages, boundaries, sort orders, and a
fast-check property comparing `designPrimers` with a slow listing of
every site and pair), removed three pieces of dead code and fixed one
fault ("1 other products"). The rerun scored 94.0%, with 179 survivors and
18 uncovered left, about as many as triage judged equivalent, dead or not
worth a test.

## At 1.7

With the 1.7 modules added the run scored 91.9% (699 survived, 84 not
covered; the weakest were the feature library's file checks at 49% and the
NCBI client at 70%). Triage, one group of modules at a time, wrote tests
for about 300 of the 1.7 survivors, judged about 90 equivalent, removed
dead code in the alphabet and the anneal index, and found one fault: the
pI of a chain ending in D or E used Bjellqvist's C-terminal pKs, where
ProtParam uses 3.55 after every residue. The rerun scored 95.2% overall
and 95.5% over the 1.7 modules. The initial run also needed room for
Taq's A-tailing property tests (under a second here, over 10 s
instrumented).

## detect.ts after 1.10 (#129)

Run on `detect.ts` alone (`npx stryker run --mutate src/core/annotate/detect.ts`,
from scratch) it scored 79.08% with 126 survivors. The survivors fell into
the groups the issue guessed, and the triage convention for the ones that
cannot be killed is a `// Stryker disable next-line <mutators>: <reason>`
comment in the source, so the reason sits beside the code and the score
counts only mutants a test could see:

- **Performance only, ignored (about 70 mutants):** the present-seeds
  bitmap and the seed lists' bounds, the indel-budget filter on seeds, the
  seed windowing in `gappedHits` (window width, the seed-count prefilter,
  the band last filled, the diagonal-explained skip), `fewestEdits` as a
  whole (`keepBest` keeps one hit of a part over the same bases anyway) and
  `substitutionsFirst`'s early return. Each changes where a banded fill is
  tried or how many hits reach `keepBest`, not which hit comes out.
- **Equivalent, ignored:** `?.` on `library.parts[...]` (a hit's part is
  always in the library), the final sort's size tie-break (the list is
  already longest first and the sort is stable), `isMinIdentityChoice`'s
  `typeof` guard.
- **Shadowed by `keepBest`, tested:** the one tie that can be built is a
  part found by its bases and another by its translation over the same
  bases, of one type; the match on the bases must win before library order
  does.

The rerun scored 88.50% with 55 survivors. What is left is mostly
`substitutionsFirst`'s filter and the `explained` diagonal check, which
guard each other (either alone keeps a substitution-only copy ahead of a
gapped reading of it, so a fixture has to defeat the one and reach the
other), the seed walk's reset on an ambiguity code (`forEachSeed`), and
the circular overhang arithmetic in `check` and `gappedHits`, where the
duplicate is dropped later by `keepBest`. Those are left to a later fixture
rather than ignored, since a test could in principle see them.

## At 1.11.2

The incremental run before 1.11.2 scored 91.99% (963 survived, 92 not
covered). Triage was scoped to the 229 survivors on lines changed since
1.11.1, the audit's fixes, one group of modules per agent; the rest had
been triaged at earlier releases. About 135 got tests and the others
`Stryker disable` comments (type-narrowing guards, `?? ''` fallbacks for
the type, bounds whose extra iteration reads nothing). No fault turned up.
The rerun scored 93.60%, with 8 of the 229 still reported. Two of those
(`collection.ts` header columns) fail the tests when applied by hand, so
the report can lag on a mutant; check one by hand before writing a test
for it.

Agents running narrow Stryker runs side by side in one tree break each
other: each sandbox copies the others' `.stryker-tmp-*` directories
mid-write, and every dry run runs the whole suite, so one agent's
half-written test fails all of them. Run them one at a time, in their own
worktrees, or check mutants by applying them by hand.

## At 1.12

`crispr.ts`, `gcContent.ts`, `assemble.ts` and `consensus.ts` joined the
set. The first full run scored 90.6% over `core`; the new modules were
weakest (`assemble.ts` 65%, `crispr.ts` 76%, 185 and 117 survivors).
Triage wrote tests for about 170 of them and removed two dead guards; the
single-file reruns scored `assemble.ts` 90%, `crispr.ts` 91%,
`consensus.ts` 95% and `gcContent.ts` 89%, the rest equivalent (unreachable
`??` fallbacks, loop bounds that read nothing, sort tie-breaks over
already-sorted input).

Two things to know before the next run. A property test with its own
timeout overrides the 60 s mutation-mode `testTimeout`, so a slow one
fails the dry run (`overlapPrimers.property.test.ts` did, at 10 s). And
`.stryker-tmp` and `reports` are in ESLint's ignores: left in the tree
after a run, the instrumented copy made `eslint .` run out of memory.

## At 1.16

`exportFigure.ts`, `exportJob.ts`, `pdfWriter.ts`, `help/staticGuide.ts` and
`view/svg/exportLinear.ts` joined the set (the export dialog's size and page
rules, the export job's yielding and cancelling, the PDF writers, the static
guide and sitemap generator, and the sequence view's page layout). The
primers panel and Format menu changes of 1.16 are React components with no
logic module of their own, and the export worker and its client are glue, so
they are not mutated. The first full incremental run scored 93.48% over all
71 files (20,948 mutants, 86 minutes with a 45-minute dry-run timeout); the
new modules were `staticGuide.ts` 47.7%, `exportLinear.ts` 71.8%,
`pdfWriter.ts` 76.7%, `exportJob.ts` 86.1% and `exportFigure.ts` 86.4%,
with 219 survivors and 19 uncovered among them.

Triage wrote tests for nearly all of them: exact messages and boundaries of
the size advice, the yield limit and the cancel point, the PDF writer's font
weights (read from the fonts the content stream selects), page sizes and
compression, the generated guide pages as exact HTML, the page-filling rule
of the sequence view checked against each row's own height over a range of
text sizes, and the 100,000-base limit counted per stretch of a range. The
narrow reruns (`--mutate` on the five files, about 10 minutes each) end with
`exportFigure.ts`, `exportJob.ts`, `pdfWriter.ts` and `exportLinear.ts` at
100% and `staticGuide.ts` at 99.6%; the one survivor left there is the
equivalent noted below, disabled after the last run. The whole-set score of
that last run was 94.72%.

One thing to know before writing tests for a module like these: a fixture
built in a `describe` body (not in the test) runs while the file loads, so
its mutants are static and are attributed to no test. The golden guide pages
first survived for that reason, at 48%, and scored 96% once the pages were
made in each test.

Accepted equivalents, each a `// Stryker disable` with its reason beside
the code (31 comments, one of them a disable/restore pair):

- Guards for the type: values that are only undefined for no rows or no
  pieces (`topOf`, `heightOf`, the runs of `plan`, `advice.pop() ?? ''`,
  `dest.pop() ?? ''`), and `?.` on a run that always has rows.
- Redundant by another check: the bounds of `relative`'s common-prefix loop
  (the comparison fails where either list ends), the trace option's `'off'`
  (the layout reads anything but `short` and `tall` as no trace), the residue
  numbering and the translations without `showTranslations` (nothing draws
  them), `kind === 'heading'` beside `level === 1`, and the empty filters
  and joins in `relative` for the one-level page paths.
- Floating-point equality: `used + cost > room` against `>=`.
- Last chunk and last page of `paginate`, which are never empty.
- Where the library fills the same value in: svg2pdf reads an empty
  font weight as normal, jsPDF finds PNG from the bytes, a square page has
  one orientation, the numeric region of a locale never names a Letter
  country, and a scale below the current one is over the budget already.
- `matchStaticRequest`'s `q <= 0`, which cannot occur for a path under the
  base.

## At 1.16.2

The incremental run before 1.16.2 scored 94.65% over 71 files (21,023
mutants, 17,634 reused, 1,283 tested, 154 minutes). Triage was scoped to the
16 survivors on lines changed since 1.16.1: the `single` mark on range
segments (#255) in `historyCodec.ts` (copy and `segmentEqual`) and
`historyFormat.ts` (the segment validator), and `keepBest`'s close-variant
rule (#257) in `detect.ts`.

All 16 were killed by tests, none disabled: a history round trip that keeps
`single` on a stored feature and adds none to a segment without it;
`segmentEqual` telling a segment apart by the mark put on and taken off;
the validator accepting `single: true` and rejecting `false` and `'true'`;
and the overlap rule at exactly 90% of the shorter variant and at 91%
(which separates `Math.min` from `Math.max`). The narrow rerun
(`--mutate` on the three files) left none of the 16: `historyCodec.ts`
92.80%, `historyFormat.ts` 99.69%, `detect.ts` 96.93%. Beside line 762 it
still showed survivors on the length-closeness conditions of the same
rule (gap against 2% of the longer, a gap of exactly five bases, the
2% boundary, the strand and the `k.identity > h.identity` test); tests for
those were added after the rerun and checked by hand-applied mutants.

#258 and #259 joined the patch after that run, both in `writeSnapGene.ts`.
A narrow rerun on that file (16 minutes; the merged report kept all 71
files) scored 99.59%, with three survivors on the new lines, all equivalent
and disabled: the `^` of `/^ss-/` and `/^ds-/` (INSDC molecule types only
ever begin with those) and the `note` test in the empty-primer-note count
(`asPrimer` lets only notes through).

A full incremental run after those tests, the last before the release,
scored 94.75% over the same 71 files (21,084 mutants, 1,136 tested, 160
minutes with the 45-minute dry-run timeout, alongside a system update). It
left no survived or uncovered mutant on any line changed since 1.16.1,
the length-closeness survivors in `detect.ts` included.

## The scans of #274-#276

`search.ts`, `restriction.ts`, `enzymeDigest.ts`, `seguid.ts` and `sha1.ts`
joined the mutated set with #274-#276 (items 99-101). The first narrow run
over them and `alphabet.ts` left 213 survived or uncovered mutants in the
five files and five on the new lines of `alphabet.ts`; after tests and
disables the rerun left 57 survived and 2 uncovered in the five, none on
the new lines of `alphabet.ts`.

The tests are behavioural: empty and over-31-base patterns through
`matchPositions`' plain loop, ambiguity codes where `matchPatterns`' index
cannot spell the window, the Type IIS and `siteStillMatches` boundaries,
ties ordered by name, `sha1Base64UrlAsync` against a stubbed
`crypto.subtle`, and a fresh import of `alphabet.ts` so the byte table is
built while a mutant is active. Production code was left as it was apart
from three rewrites that change nothing (the scan plan in `cutSites`,
`undefined` for an unknown enzyme in `enzymeDigest`, the table built by
`Uint8Array.from`).

A `next-line` disable silences every mutant of the named mutator on its
line, so one went only where every such mutant on the line was equivalent
(35 comments, one of them a disable/restore pair). The remaining survivors
are equivalent but share a line and mutator with a killed mutant: loop
bounds one past a typed array's end, the dispatch between `shiftAnd` and the
plain loop and between `matchPatterns`' index and its ambiguous path (which
only change speed), redundant guards (`n === 0` beside the IUPAC regex, the
origin's single point in `digestFragments` and `fragmentLengths`), Booth's
shortcuts in `minimalRotation` (checked exhaustively on short strings), and
`<` against `<=` where the tie is handled first.
