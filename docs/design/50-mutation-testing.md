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

Only as the step before a release, after `npm run check` passes and before
the version is bumped: **`npm run mutate:changed`** (see "A cheap dry run
(#355)" below for what it does, its flags and the steps that follow). It is
not part of `npm test`, `npm run check` or CI, because it takes too long for
any of them. `npm run mutate` is the whole list, for a first baseline or a
change to the mutators or config that touches every file; it is not the
pre-release default. The run is incremental:
`reports/mutation/stryker-incremental.json` (gitignored, kept on the machine
that ran it) records every verdict, and a later run retests only the mutants
whose code or covering tests changed. The first full run took 60 minutes; the
incremental run after the new tests took 25.

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
disables the rerun left 58 survived and 2 uncovered in the five, none on
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
(a disable/restore pair does not work around that: a restore that ends a
block is never applied, so write the `next-line` form). The remaining survivors
are equivalent but share a line and mutator with a killed mutant: loop
bounds one past a typed array's end, the dispatch between `shiftAnd` and the
plain loop and between `matchPatterns`' index and its ambiguous path (which
only change speed), redundant guards (`n === 0` beside the IUPAC regex, the
origin's single point in `digestFragments` and `fragmentLengths`), Booth's
shortcuts in `minimalRotation` (checked exhaustively on short strings), and
`<` against `<=` where the tie is handled first.

## Keeping a pass affordable (2026-10-22)

The pass for #274-#276 took longer than the work it checked: an agent
spent about five hours and five Stryker runs chasing zero survivors in five
files, rewrote production code to make equivalent mutants go away (two
reviews were needed to catch the regressions that brought), and wrote
disables of which two were wrong. Two changes follow.

**A survivor policy.** A release pass triages only the survivors on lines
changed since the last release. A missing test is written; an equivalent
mutant is listed in this note by kind and left as a survivor. Production
code is never changed to remove a mutant. A disable comment is written
only when every mutant of the named mutator on the line is equivalent and
was checked by applying it; when in doubt, leave the survivor. One
confirming rerun, not a loop.

**Files share a module registry in a mutation run.** Stryker's Vitest
runner runs the dry run on one worker (`maxWorkers: 1`), and a fresh module
registry per file was about half of it: 10 min 9 s (300 s of tests, 309 s
of overhead). With `PLASMIDPOP_MUTATION=1` the suite is two Vitest
projects: `shared` (`isolate: false`, 258 node files) and `isolated` (89
files, found from the source when the config loads: those using `vi.mock`,
which needs its own registry, and the jsdom ones, whose late async work
failed the next file with `window is not defined` when they shared). The
dry run fell to 7 min 8 s (245 s of tests, 184 s of overhead), and
`sha1.ts` kept its verdicts (114 killed, 4 timeouts, 6 survived). Normal
runs and CI keep one project with isolation.

Measured and dropped: running only the core tests in a mutation pass. 3,270
of the 18,835 killed mutants (17%) were killed only by jsdom test files
(390 in `backup.ts`, 248 in `gel.ts`). `timeoutMS` (30 s) was left as it
is: a Timeout mutant costs at least that, but the verdicts are reused by
the incremental run, so it only weighs on mutants that are new.

## At 1.17.3

`cutSiteSet.ts` (#281), `analysisProtocol.ts` (the scan's pack and unpack),
`saveProtocol.ts` (the save worker's snapshot, #272) and `inputQuiet.ts`
(#278, on an injected clock) joined the set, 81 files. The save worker, its
client and `persistence.ts` are glue around a worker and IndexedDB and stay
out.

**The shared project broke the full run.** Stryker's setup puts the
coverage record on its global into each file's results after the file. With
shared globals that record was the whole run's so far, so every file
carried all the files before it: the dry run's runner grew past 13 GB and
crashed twice. The narrow runs of the 2026-10-22 measurement never showed
it. `src/test/setup.ts` now empties the record's two maps as each file
starts. It keeps the object, because an instrumented module goes on writing
to the record it first wrote to. A first attempt replaced the record. That
lost the coverage of every later file, and half the retested mutants
survived. Vitest has sent each file's results before the next one starts,
and the runner sums the files. A narrow run on `sha1.ts` checked the fix:
320 covering tests per mutant against 314 at 1.17.2. The full dry run now
stays near 1.2 GB but takes 21.5 minutes, since every scan test runs through
instrumented code. A narrow one takes 7.

The full incremental run scored 94.75% over 81 files (22,867 mutants;
19,204 killed, 362 timed out, 981 survived, 103 not covered; 18,117 reused,
2,540 tested; 144 minutes after the dry run). 54 survived or uncovered
mutants sat on lines changed since 1.17.2. Tests killed 26 of them:

- the sites of a set made once and kept (`of`, a view's `site(j)`);
- no site before an enzyme's first or past its last (`cutSiteSet.test.ts`);
- input-quiet's capture and passive options, a wheel with no button held,
  the idle callback's timeout, and giving up at the deadline itself on a
  clock that stands still;
- an enzyme with sites and nothing in the digest, unpacked;
- SHA-1's fallback over whole blocks, and U+10000 and U+10FFFF across a
  chunk's end.

The confirming rerun scored 94.92% (19,248 killed, 353 timed out, 947
survived, 102 not covered; 418 tested, 88 minutes). It showed one more on a
changed line: `PackedCutSiteSet.count` read as 0 for every enzyme had been
killed only by the property test's random draws. A plain test now kills it;
that was checked by applying the mutant by hand. No disable comment was
added. The 28 left on changed lines are equivalent:

- **Caching and identity only:** `counts()` and `groups()` built again
  on each call. An empty answer is the shared empty list or a new one
  (`pick` of nothing, `of` an unknown name, `pick`'s seeded list). `pick`
  merges instead of taking the one enzyme's list.
- **Names it does not know:** an unknown name already reads as a share of 0,
  in `count` and in `pick`'s test.
- **Enzymes without a site**, which `packCutSites` never lists: the
  `share > 0` tests in `counts`, `pick` and `groups`.
- **`merge`'s redundant guards:** groups made that were not asked for. The
  loop runs one past the end and reads a 0 head, whose cursor is past its
  group. A group not asked for is the empty list. `groups[k]` and the site
  are always defined. Also a write past `offsets`' end, which a typed array
  drops, and `?? ''` for an enzyme index that is always in range.
- **SHA-1's chunk end:** `end++` keeps a pair whole in the earlier chunk
  rather than the later. Dropping `last >= 0xd800` moves a chunk's end back
  one before any code unit, which splits nothing.
- **`kmers` on a circle:** `text + text` and `slice(0, K + 1)` add only
  K-mers that start at the origin again.
- **`unpackScan`'s default pause:** `await undefined` instead of
  `await Promise.resolve()`.

## At 1.17.4

The pass was scoped to the 95 survivors on lines changed since 1.17.3, all
in `detect.ts` (37), `hits.ts` (4) and `library.ts` (54): the touching-copies
chain of #284/#288, the segment rule of #282, antisense CDS (#285), the
variant name note, and the library's `variant`, `complementOf`, `segmentOf`
and `components` parsing. Tests killed 70 of them: `library.test.ts` now
reads each kind of variant, every position error with its exact message,
the regex's anchors and the bounds of `to > limit`, and the part a bad
field was found in; `detect.test.ts` chains across the origin of a circle
only from the copy that ends it (and not on a linear sequence), a
tandem running over the origin from its first copy, a ring of copies, two
different tags side by side, copies cut off by a linear end, copies found in
the translation or under the family name beside one that was not, the sum
of ambiguous bases, a chain listed before a shorter part starting with it
(before homologues re-sort), copies of two parts over the same bases, and a
segment as long as its gene; `hits.test.ts` an own-strand CDS that touches
none of the hit and the family note's name. The narrow rerun (three files,
29 minutes, a dry run of about 2) left 32 on those lines; the 8 that were
new to the list had been reported killed in the full run, and by hand they
survive the whole suite with the code as it stood, so that earlier verdict
was stale. Two of them (`list.push` and the `list === undefined` test in the
start/end index) were killed by a new test, five were equivalent and
disabled (below), and `k !== h` in the finest-fit filter was left.

Tests of this module that draw from the file's shared `rand` shift every
later test's random fixtures, and in a mutation run the draws also depend
on which tests were selected. The new tests seed their own generator.

Equivalents disabled, with the reason beside each (5 comments, 7 mutants):
the `?.` on `protein` in `parseVariant` (a spec is only read when the part
has a protein); `ordered`'s sort in `withRepeats` (the hits come in
sequence order and the result is sorted again); the pairs of `order`
(it only ranks several candidates for one copy, and there is never more than
one); the `?? []` of `listed` (a stray entry follows nothing); and
`inChain.add(next)` (a chain only comes round to its first copy).

Equivalents left as survivors, each sharing a mutator with a killed mutant
on its line (24 on changed lines):

- **Redundant by the start/end index:** `follows`' adjacency test (the
  candidates are listed by where they start or end, so all of the range test
  and its wrap clause hold already: 6 on line 528), `b !== a` (a copy that
  is the whole circle follows itself, and the fallback pass chains it just
  the same), `after`'s extra candidate at 0 where the copy does not end the
  circle (`follows` rejects it), and `!chainable(first)` (a lone hit comes
  out the same).
- **Never more than one candidate:** the choice of the first of several
  following copies (6 on line 579); two copies of one part cannot both start
  or both end at one base after `keepBest`.
- **Never reaches `withRepeats`:** `similar === undefined` in `chainable`,
  since homologues are added after the chains are made.
- **Typed away:** `?? ''` for a part not in the library, `k !== h` in the
  finest-fit filter (a hit's identity is not greater than its own), and
  `seg.kind !== 'range'` in `antisenseToCds` (a site's NaN bounds share
  nothing either way).
- **Unreachable in the parser:** `positions` always has an entry, so the
  "no positions" throw never runs (2), and `protein === ''` beside
  `undefined` (2): an empty protein is refused earlier as nothing or as
  malformed.

## At 1.18: `designAnchoredPrimers` and `fetchRegion` (#299)

The mutants on lines changed since v1.17.6 were triaged (39 in
`primerDesign.ts`, 17 in `efetch.ts`). Each was applied by hand and the
tests rerun, so "equivalent" below was tried, not argued. 45 were real
gaps and got tests: `designAnchored.test.ts` now restates the criteria and
picks the pair the slow way (every forward length against every reverse
length) and the fallback ends the slow way, and `ncbi.test.ts` pins the
wording of `fetchRegion`'s refusals, the window at exactly the cap and a
one-base range, the `REGION:` line anchored to a line start, and the error
for an HTTP status that is not a rate limit.

Equivalents left as survivors:

- **Duplicated check:** the `status >= 500` branch of `ncbiRequest` (3
  mutants): a 5xx that gets past it is refused by `fetchGenBank`'s
  `!response.ok` with the same error kind and text.
- **Tie-break order:** `penalty < best.penalty` as `<=`. Two pairs score
  exactly alike only for mirrored primers, and the pair with equal lengths
  (Tm difference 0) wins either way.
- **Unreachable guard:** `longest < c.minLength` (with fewer than two
  candidate lengths the lists are empty and the fallback returns null
  anyway); `?.` on `[0]?.report` and the `forward === undefined ||
reverse === undefined` check (5 together), since the lists hold the `minLength`
  candidate whenever the first guard passes.
- **Case already folded:** `toUpperCase()` read as `toLowerCase()` on the insert,
  since `analyzePrimer` upper-cases the primer it is given.

## At 1.19: the guide's Markdown, `overlapPrimers`, backup parents, linear export scope

The 28 survivors on lines changed since v1.18.0 (18 in `staticGuide.ts`, 1 in
`overlapPrimers.ts`, 8 in `backup.ts`, 1 in `exportLinear.ts`) were applied by
hand where a test was in doubt. Tests killed all but the equivalents below:
`staticGuide.test.ts` writes small Markdown inputs through the real parser and
asserts the exact HTML (task items, a nested block's lines, `start`, quotes and
the folded tip, the `download` attribute with and without an anchor and for
`.gb.bak`, the dev server's file and redirect anchors); `overlapPrimers.test.ts`
warns for a vector whose only sticky end is the right one; `backup.test.ts`
restores rows with no, one or both halves of a parent and reads the stored row
and its summary; `svg.test.ts` leaves `translationScope` unset and expects the
output of `'all'` (an unknown scope would act as `'gene'`).

Equivalents left as survivors:

- **Output of `undefined` joined:** the `?? []` of an item's details read as a
  one-element list: `block` of a string returns `undefined`, and `[undefined]`
  joins to the empty string.

## Cutting the pass down (#320, 2026-10-29)

The 1.19.0 pass was 4 h, 71 min and 76 min over three runs for a few changed
files. Where it went, measured from the Stryker logs: the dry run is one
process, so workers do not shorten it, and it took about 30 min with all 81
files instrumented against 8 min 41 s with two (6,367 tests, 301 s of tests,
220 s of overhead); the rest was a last mutant that waited out its timeout.
Changes, all in `scripts/mutate-changed.mjs` (`npm run mutate:changed`) and
`vite.config.ts`:

- **Only the changed files.** The script takes the files of the `mutate`
  list that differ from the latest tag (or a ref given as its first
  argument) and passes them as `--mutate`. The incremental file still reuses
  the verdicts of unchanged mutants: the two-file run reused all 661 and
  finished in 8 min 52 s, almost all of it the dry run.
- **`--skip-loops`** leaves out `UpdateOperator` (`i++` to `i--`). In the
  1.19.0 report 150 of its 253 mutants were timeouts (a loop that never
  ends, 43 % of all 350 timeouts), 90 were killed by a test and 2 survived.
  It is a flag, not the default, because those 90 are real kills on loop
  counters; use it when the wait matters more than that signal.
- **`--unit-only`** leaves out the jsdom test files (109 of 408) through
  `PLASMIDPOP_MUTATION_UNIT=1`: 5,236 tests, 2 min 53 s (152 s of tests,
  21 s of overhead). Not the default for the reason already measured above:
  a mutant only a component test kills becomes a survivor (17 % of the
  killed mutants at 1.17.4), which triage then answers with a unit test or
  lists. Good for iterating on survivors, not for the final pass.
- **Concurrency** defaults to the cores minus two. Contention turns slow
  mutants into timeouts (6 in 333 mutants on an idle machine, 82 in 402 with
  the suite running beside it), and each costs its full budget.
- **Every run keeps** a copy of the incremental file taken before it
  (`reports/mutation/logs/incremental-before-<time>.json`; an interrupted
  Stryker writes its report only at the end) and its own log, and the script
  kills the orphaned `child-proxy-process-proxy-worker` processes of this
  checkout when Stryker ends.

**The long wait at the end.** Stryker kills a timed-out runner's whole
process tree with SIGKILL (`child-process-proxy.js`, `tree-kill`), so a
timed-out mutant does not keep spinning in a run that ends normally; only an
interrupted run leaves orphans (hence the cleanup above). What stalled the
runs is the timeout itself: Stryker's budget is the net time of the tests
covering a mutant times 1.5 plus `timeoutMS`, and a loop mutant in code that
hundreds of tests cover gets a budget of many minutes, then waits for it.
The 1.19.0 report has hundreds of such timeouts across `src/core`,
`src/io` and `src/storage`, not one mutant to exclude, so no mutant was
excluded; `--skip-loops` removes the bulk of them. This is a reading of the
code and the logs: the budgets themselves are not in the report.

**Measured and ruled out: `coverageAnalysis: off`.** Without per-test
coverage every mutant runs the whole suite (about 5 min of test time on a
quiet machine even with four files instrumented), so 661 mutants would take
days, not the 52 s the mutant stage took with `perTest`.

**A second machine.** A 12-core, 31 GB workstation was set up as a mutation
runner: a conda env with Node 24 and a clone of the repository (public, so no
credentials), `npm ci`, then the same command. The same two files, from
scratch (no incremental file), ran the dry run in 5 min 21 s and the whole
661 mutants in 6 min 17 s, and gave the same verdicts as the main machine
(`staticGuide.ts` 318 killed, 1 timeout, 1 survived; `exportLinear.ts` 224
killed). Its dry run was quicker than the main machine's 8 min 41 s, but the
main machine was busy updating at the time, so the two are not a fair
comparison. The use is a second, quiet machine, so a pass runs beside other
work without the contention above. Copy `reports/mutation/stryker-incremental.json` over
first to keep the reuse.

## At 1.20

The first full pass after the #320 changes (`npm run mutate`, 20,052 killed,
351 timeouts, 976 survivors, 94.96 %; 273 min, with another analysis using the
workstation's CPU for most of it, so the 163 timeouts of its re-tested mutants
are partly contention). 21 survivors were on lines changed since v1.19.0, in
three files, and were applied by hand: the check-primer pairs of `protocol.ts`
and `protocolText.ts` (#311) and the binding scan of `primerDesign.ts`.
`protocol.test.ts` now has a reaction primer reused by two check pairs (its
`usedFor` gains the check once) and `protocolText.test.ts` asserts the table's
header cells in Markdown and HTML.

Equivalents left as survivors:

- **Scan speed-ups in `findBindingSites` (10):** the code array, the plain-base
  array, the order of the 3′ anchor first, and the `charCode === code &&
plain` shortcut (`() => undefined`, `''`, `true`/`false`, `!==`). Each only
  changes how soon a position is refused, not whether: a mismatch still goes
  through `pairsWithCode`, and every mismatch is counted whatever the order.
  Applied one at a time, no test in `src/core/primers/` fails.
- **`prior !== undefined` read as `true` (1):** `findIndex` returned a valid
  index, so the entry exists; the check only narrows the type.

`vitest` 5.0.1 leaves its root temp folder in `os.tmpdir()` after every run
(and a killed run's project folders). The test and mutate scripts now run
through `scripts/with-tmp.mjs`, which gives each run its own
`node_modules/.vitest-tmp/<pid>` as `TMPDIR`, removes it at exit and prunes
those of dead processes at the next start.

## Score and coverage floors (#334)

The mutation score has a floor: `thresholds.break` in `stryker.config.json` is
90, so `npm run mutate` exits non-zero below it. Only that pre-release run
checks it; CI never runs Stryker. The last full run scored 95.0% over 81
files. Equivalent survivors stay under the survivor policy above, so the floor
sits below the score rather than at it.

Coverage has a floor too: `test.coverage.thresholds` in `vite.config.ts`,
statements 90, branches 82, functions 89, lines 92, each about 2 points under
what `npm run test:coverage` measured on 2026-10-30 (92.8, 84.99, 91.86,
94.66; the run had a few load-flaky timing tests failing, which can only
understate it). A threshold fails only when coverage is on, so CI's Test step
and `npm run check` run `test:coverage`; `npm test` stays without coverage for
quick local runs. The floors are global, not per file. Raise them when coverage
rises; lowering one needs a reason in the commit.

The principal scientific computations join the `mutate` list (#333):
`src/core/alignment/pairwise.ts`, `banded.ts`, `quality.ts`, `msa.ts` and
`src/core/primers/thermo.ts`. They have no baseline in the incremental file,
so the first release run with them mutates them in full, which takes longer
than an incremental run. `strands.ts` (picks the strand by k-mer counts and
delegates the scoring) was left out as orchestration, not scoring.

## At 1.21: the primer structure model, criteria and designer

The pre-release run on changes since v1.20.0 scored 93.11. Of the survivors in
`primers/structure.ts` (16), `criteria.ts` (5) and `primerDesign.ts` (13), 19
were gaps and are killed by new tests; 15 are equivalent. Each was checked by
applying it by hand.

Killed: the fractional `hairpinDg`, `hairpinTm` and `dimerDg` limits and the
`hairpinTm` key in `normalizePrimerCriteria` (`criteria.test.ts`); U read as T
in `codes`, a mismatch against an unknown base taking no stacking term, and the
interior loop table extended by Equation 7 past 11 unpaired bases, reached
with a loop limit of 8 (`structure.test.ts`, "what the fold reads and weighs");
the cross-dimer ΔG at exactly its limit in `designPrimers`
(`primerDesign.mutation.test.ts`) and `designAnchoredPrimers`, and its 3′
cross-dimer rule (`designAnchored.test.ts`). The anchored designer returns its
least bad pair when none passes, which may be the very pair that was ruled
out, so those tests assert on `withinCriteria` as well.

Equivalent, by kind:

- **Performance only.** `structure.ts` L177, `memo.clear()` when the memo is
  full, only bounds memory. `primerDesign.ts` L293, L294 and L296, the GC,
  homopolymer and Tm tests of `failsBasics`: a prefilter that
  `candidatePenalty` repeats line for line, so a mutant that lets more through
  changes the time and not the pairs (all eight mutants applied, none caught).
- **Unreachable.** `structure.ts` L308, the `up === 0 && down === 0` stack in
  `loopEnergy`: both callers take that case themselves before calling it, and
  the function is not exported (four mutants applied).
- **Value always defined.** `structure.ts` L235 `?? -1` to `?? +1`: the index
  is inside a 25-entry `Int8Array`, so it is never undefined. L552 `?? 'N'` to
  `?? ''`: the tail is a 3′ match, whose only unpaired characters are N, and N
  pairs with nothing, so the partner's N changes no energy.

### At 1.21: the overlap screen and the k-mer window count

Of the survivors in `assembly/overlapBound.ts` (29) and `alignment/msa.ts` (7),
28 were gaps and are killed by new tests; 8 are equivalent. Each was checked by
applying it by hand.

Killed: the bar at its edge, an 18-base run kept and a 17-base run refused, at
the start and the end of the screened read and on both strands, which also
pins `v >= bar`, the last column, the `ceil` rounding and the coefficient of the
bar; a gap in either direction (ten bases, a gap, ten bases reaches the bar
exactly); the clamp at zero after a stretch of mismatches; an ambiguity code
matching nothing, even another one; an identity of 0, above 1 and exactly 1,
and a `minOverlap` of 0 with no base in common (the bar guards at L88 and L91)
and an overlap of 20 columns with two substitutions, whose bar sits on an
integer so the `1e-9` allowances count (`overlapBound.test.ts`, "the bar,
exactly"). In `kmerDistances`, exact distances for tiny sequences, in both
orders, with multiplicity and with an ambiguity code (`msa.test.ts`). All of
these are fast direct tests; none relies on a suite the mutation run skips.

Equivalent, by kind:

- **Value always defined.** `overlapBound.ts` L41 `i <= seq.length` (the extra
  write to a typed array is dropped), L43 `c < 128` to `true` or `c <= 128`
  (`CODE[c]` is undefined past 127, and `?? 4` is what the guard gives).
- **Tie, same value.** L60 `above >= left` (the two are equal, so either is
  taken), L61 `gap >= v` (equal values), L62 `v <= 0` (a zero is set to zero,
  and `bar > 0` there, so the `v >= bar` test it skips fails anyway).
- **Guard covered by another guard.** L88 `PENALTY / (1 + PENALTY) - 1e-9` and
  `<` for `<=`: they differ only for an identity within 1e-9 of 2/3, where the
  bar is 0 and L91 returns true just the same.

### At 1.21: the Sanger read assembler, to line 650 (`assembly/assemble.ts`)

Of the 76 survivors on changed lines up to L650, 59 were gaps and are killed
by new tests in `assemble.test.ts`; 17 are equivalent. Each was applied by hand
and run against `src/core/assembly`; the oracle suites the mutation run skips
(`sangerAssembly[0-9]*`) were not needed, since no survivor was left that only
they could kill and none of the 17 is a behaviour they could pin.

Killed: the stretch `core` keeps of a local alignment that runs on past the
overlap (what it starts and ends at, how it counts the bases a gap column
leaves out on each side, and what it scores, which decides between two places
a read fits; "the stretch of an alignment that holds the identity", with the
exact ties at a minimum identity of 0.5, where a mismatch costs one match and
the floats are exact; at 0.9 the cost is 9.000000000000002 and a run never
lands on zero); `explainedByQuality` (three alignments of 26 to 30 columns
whose expected miss counts the mutants of each line turn over, found by
searching over a copy of the function, and an identity of exactly 0.8); the
ends of the consensus and of the read that `findPlacements` aligns (the
aligner's arguments are recorded, forwards and reverse), the shift of a
stretch of the read into the whole read, a read lying inside the consensus
trying no corners, `fitsElsewhere` looking at a stretch of exactly `minOverlap`
and at none shorter, and which reads wait to be tried again (`unrelated`).

Equivalent, by kind:

- **Dead data.** `placeStretch` returns `used` (L576-579, eight mutants over
  three lines), and nothing reads it.
- **Value never read.** L447 `ambiguous` of a cut alignment (the field is
  unread in the assembler) and L187, the initial `ambiguous` list: a string
  entry matches no read index.
- **Cannot differ.** L427 `c <= a.columns`: the extra column is a non-match,
  which only lowers the run. L446 `line.match(/\|/g)?.length`: the stretch has a
  match, so the match is never null. L462: the identity of a cut stretch
  exceeds `minIdentity` by construction, so a larger value passes the same
  tests. L561 `identity <= minIdentity`: at equality `passes` is true unless
  the overlap is short, and cutting a short alignment only shortens it.
- **Performance only.** L539 and L542 `from === 0 && to === read.bases.length`:
  `slice(0, length)` is the same string.
- **Tie.** L519 `miss <= expected + ...`: an exact tie needs the sum of the
  error probabilities to hit an integer threshold, which no sum of the
  powers of ten involved does.

### At 1.21: the Sanger read assembler, from line 650 (`assembly/assemble.ts`)

Of the 63 survivors on changed lines past L650, 42 were gaps and are killed by
new tests in `assemble.test.ts`, 7 were killed already by the part-A tests (L811
`unrelated.has`, both L813 and three of the four at L818, which the pre-release
run predates), and 14 are equivalent. Each was applied by hand and run against
`src/core/assembly` and, for the equivalent ones, the four
`sangerAssembly[0-9]*` oracle files the mutation run skips; they survive all of
them, and none was killed only by a skipped suite.

Killed:

- The second pass (#349): the aligner's calls with a default cutoff equal those
  of a run with no trim when the reads made one contig (L758), and are doubled
  when they made two, but not at a cutoff of 0.2 (L760, both mutants); a pair
  joined only through tails at Q8 stays two contigs at the default cutoff, whose
  doubled 0.1 trims them, so the second pass is not at the ceiling (L764).
  "the second pass at a looser trim, and how far it goes".
- Which reads are tried again after a join (L848-853), seen by what the aligner
  is asked: a read that cannot overlap the joined one is not aligned to it (the
  screen, L848 `false`, L850), one that fits nowhere is tried against the
  consensus again after a join when its alignment with the joined read is 25
  bases (not 24, and not 20 bases at 10-30, L853), at an identity of exactly the
  minimum (not below it), and when only a stretch of a poorer alignment holds the
  identity (L852); an alignment with nothing in common is `core` null, which the
  `a !== null` test keeps from being read (L853).
- A tie between two places a read fits at the same score keeps the first
  (L818 `>=`).
- The collapse warning, from depth profiles built of reads of unique sequence (a
  backbone read and short reads laid inside it): 100 bases is a stretch and 99
  is not; one that starts at the first base and one that ends at the last; depth
  3 joins the stretch and 2 does not; a peak of 4 and not of 3; a median of 2,
  where 4 deep is under 3 times it, 6 deep is exactly 3 times it and a mean of
  5.99 is under it though the base after the stretch is 2 deep (L965 `i <= to`);
  and the mean said to a tenth, with the stretch counted from 1 ("the warning that
  reads may have piled onto one copy of a repeat").

Equivalent, by kind:

- **Performance only.** L805 `pool.length >= 0` (the extra round finds no pick
  and breaks); L848 `unrelated.size > 0` to `true` and to `>= 0` (a screen is
  built over an empty set that nothing uses).
- **Unreachable.** L811 `read === undefined` and L921 `r === undefined` (the
  index is in range; the read is always among the rows); L850 `joined.mayOverlap`
  (`joined` is null only when `unrelated` is empty, and then the loop has no
  turn).
- **Guard covered by another guard.** L823 `picks.length === 0` to `false`
  (`chosen` is then undefined and L837 breaks), and L837 `chosen === undefined`
  to `false` (reached only with no pick, which L823 has taken). L853
  `a.identity >= minIdentity`: `a` is the alignment itself at that identity or
  what `core` keeps of it above that identity. L955, five mutants of
  `readCount < 4 || depth.length === 0`: with three reads the depth is 3 at most,
  which the peak of 4 refuses, and an empty depth has no stretch.
- **Tie.** L824 `p.at - q.at` to `p.at + q.at`: the picks are made in order of
  `at`, and the sort is stable, so the tie-break repeats the order they already
  have (a test pins it, but the mutant leaves the order alone).

### At 1.21: mutants that timed out

A timeout counts as detected, so it hides whether any assertion would have failed. Of the 43 timeouts on lines changed since 1.20, about 19 were loops that cannot end (loop counters flipped, a `while` body emptied, a `splice` dropped): sound kills. About 19 only made the code slower and left the answer alone: the memo lookup, clear and store in `remembered`, the cached-parameters shortcut in `hairpinFold` and `dimerEnergy`, the `failsBasics` prefilter in `primerDesign.ts`, the ASCII fast path of `codeMask` in `search.ts`. The last five changed the fold itself.

Applied by hand, three of the cached-parameters shortcuts survived the unit tests (a custom loop limit or parameter set reaching the cache, which is keyed on the sequence alone) and one `maxLoop` bound on the second strand did too. `structure.test.ts` now has a describe, "the fold cache is keyed on the sequence only for the default model", that folds one bulged pair with two loop limits and two parameter sets, on either strand, and expects each its own energy. The memo, prefilter and fast-path mutants stay: slower, same answer, equivalent. The machine ran at a load of about 14.6 on 16 threads, so some of the slower ones may have been tipped over the limit by contention.

**A standing step of the pre-release triage.** After the survivors, list the timeouts on lines changed since the last release (`mutation.json`, status `Timeout`, filtered by `git diff -U0 <tag> HEAD`), grouped by file and mutator. Loop-counter flips (`UpdateOperator`) and emptied or unreachable loop bodies are sound kills; leave them. Every other timeout (a cache, shortcut, prefilter or predicate changed) is applied by hand and run against that file's tests: if the answer changes, a test is missing; if it only runs slower, it is equivalent and goes in the list by kind. The 1.21.0 list was `scratchpad/timeouts-changed-lines.txt` and found four gaps among 43. Making this a script is part of #355.

**Where earlier timeouts are.** The incremental file keeps every mutant's last status, so `reports/mutation/stryker-incremental.json` (and the per-run copies in `reports/mutation/logs/`) hold the timeouts of all earlier runs: 350 across 51 files at 1.20, 435 across 55 files after the 1.21.0 run. The copy kept on the offload host can be thinner than the workstation's (duncan's held 661 mutants, so its run reused 543 of 26,481 and retested nearly everything); copy the workstation's incremental file over before a run elsewhere.

### At 1.21: the confirming rerun (targeted)

The rerun mutated only the 50 line ranges that had survivors (481 mutants in 6 files; 12 min dry run, 57 min in all; score 93.65). Against the first run: 137 of the 209 survivors and 10 of the no-coverage mutants were killed by the new tests, 7 timeouts became real kills, 50 survivors stayed (the equivalents listed above), and 20 mutants that the first run had called Killed or Timeout now survived.

Those 20 are an artefact of the first run, not a regression. Their kills had come almost entirely from two slow tests (the Against picker test in `ligationCheck.test.tsx`, 30 s, and the primer pair oracle, 60 s) that timed out under instrumentation; once their mutation-mode limit was raised (a0fae00, cdc0673) the mutants that only slow the code down survive, as they should. Applied by hand, they sort as: equivalent, guard covered by another guard or table default (`structure.ts` 217 x5, since `a + b === 3` already excludes the value 4; 235 x6, since `MISMATCH[...] ?? -1` gives -1 for an unknown base; 308, unreachable; 552, extra unknown bases add no energy; 497 `pi >= 0` to true, a negative index reads INF) and performance-only (177 x2, the memo; primerDesign 293 and 296, the `failsBasics` prefilter). Three were real: the loop bound at 497 and 499 written `>` for `>=` passed because the bulge tests only compared two energies; `structure.test.ts` now pins -12.34 and -21.65 for loop limits 0, 1 and 2, on either strand. One stays undecided: the first row of `foldDimer` started one row too far down (`let pi = i + 1`) survives every test; a fold that reads a not-yet-computed row gives INF, so the path may simply never win.

Lesson for the script of #355: a short test timeout in mutation mode turns every slower mutant into a kill, so the limits of the slow tests must be raised before a run, not after.

## A cheap dry run (#355, #320, 2026-11-05)

The 1.21.0 pre-release `npm run mutate` took 53 minutes in its dry run alone
(1.20: 21.5), after ten suites had been skipped and several timeouts scaled.
The dry run runs every test once on one worker with the instrumentation on, so
it grows with both the number of tests and the number of instrumented files
(#320: 252 s with 4 files instrumented, 1,558 s with 81).

**`mutate:changed` already avoided most of that**, since #320: it instruments
only the files changed since the tag, and a two-file run's dry run took
8 min 41 s (5 min 21 s on the second machine). What it still did was run all
~6,300 tests. Now it is the pre-release default and does three more things:

- **Only the changed lines are mutated.** `git diff -U0 <tag> HEAD` gives each
  file's new-side line ranges, passed as `--mutate src/a.ts:10-20,...`. That
  is what the survivor policy triages anyway, and the dry run instruments
  fewer sites. The incremental file keeps the verdicts of every other mutant
  (Stryker's differ carries old mutants outside the mutated scope into the
  new report), so the score still covers the whole list. A file of the list
  with no result in the incremental report (new to the list, or a thin report)
  has no baseline, so it is mutated whole; with no incremental file at all the
  script says it is a full run. `--whole-files` mutates the whole of each
  changed file instead. Not done: a test change in unchanged lines does not
  retest the mutants there; use `--whole-files` or a full run when the tests
  of a file were reworked rather than added to.
- **Only the tests that can reach those files run in the dry run.**
  `relatedTests` (`scripts/mutationTools.mjs`) follows imports (static,
  dynamic, `vi.mock`, worker URLs, the `@/` alias, barrels, the setup file's
  imports) backwards from the changed files; the script hands the list to
  `vite.config.ts` in `PLASMIDPOP_MUTATION_TESTS` and everything else is
  excluded from both projects. It names a superset of the tests that cover a
  mutant, so no kill is lost; checked against Vitest's own `--changed` on the
  89 files changed since 1.21.0, it found all 334 tests Vitest did and 7 more.
  How much it saves depends on the file: `exportLinear.ts` is reached by 24 of
  the 448 test files and `staticGuide.ts` by 2, but a core module such as
  `digest.ts` or `structure.ts` by about 320, because the app tests import the
  `@/core` barrel. That is a limit of the method, not a fault: Vitest's own
  `related` selection gives the same sets. `--all-tests` runs everything.
- **The ceiling for the dry run** is 45 minutes (`--dryRunTimeoutMinutes`),
  since `stryker.config.json`'s 20 is for a run of a few files and a ceiling
  costs nothing when it is not reached.

Also in the script: workers are the config's `concurrency` (8) but never more
than the cores minus two (it was cores minus two even above the config, which
on the 16-thread workstation meant 14); a warning when the one-minute load is
above a quarter of the threads, since contention turns slow mutants into
timeouts (6 in 333 on an idle machine, 82 in 402 beside other work) and each
timeout costs its full budget, so run it on an idle machine; the incremental
file is copied to `reports/mutation/logs/incremental-before-<time>.json` and
the output to `mutate-<time>.log` before and during every run;
`--incremental-from <file>` copies a report (the workstation's) over the local
one first, for a run on the second machine; and the run ends with the listing
of `npm run mutate:triage`.

**`npm run mutate:triage [-- <ref>]`** reads `reports/mutation/mutation.json`
and the lines changed since the ref and prints (a) the survivors and
uncovered mutants on changed lines per file, with the skipped suites (below)
that import the file or a module that does, and (b) the timeouts on changed
lines, per file and mutator, with loops split off. A timeout counts as
detected and so hides gaps; the standing step "At 1.21: mutants that timed
out" above is what to do with the second list. The split is a heuristic: a
loop is an `UpdateOperator` mutant or any mutant on a line that opens a
`for`, `while` or `do` (a one-line `for` with its body on the same line is
miscounted as a loop). The unit tests are in
`src/test/scripts/mutationTools.test.ts`.

### The pre-release steps

1. `npm run check` passes and the working tree is the commit to release.
2. Add the modules the release added to `mutate` in `stryker.config.json` (a
   new file is mutated whole, as it has no baseline), and put the slow tests
   of changed files in `PLASMIDPOP_MUTATION` mode with a limit that does not
   turn slowness into a kill (#355's lesson: a short test timeout in mutation
   mode makes every slower mutant a kill).
3. On an idle machine: `npm run mutate:changed`. On the second machine, copy
   the workstation's `stryker-incremental.json` first
   (`--incremental-from`). Do not start it alongside other work.
4. Triage per "Keeping a pass affordable": survivors on changed lines (the
   listing above), then the timeouts that are not loops. Write the missing
   tests, list the equivalents in this note by kind.
5. One confirming rerun of `mutate:changed` (it reuses what it can), then the
   version bump.

### What a mutation run skips, and what that means for survivors

A mutation run never runs the suites in `MUTATION_SKIP`
(`scripts/mutationTools.mjs`, used by `vite.config.ts`). They run in `npm
test` and CI as always, but a mutant that only they would kill is reported as
a survivor.

| Skipped suite                                                                                                                                           | Why                                                                                                                | Mutants it can kill (from its imports)                                                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `src/test/oracle/sangerAssembly[0-9]*.test.ts` (4 files, through `sangerAssemblyHarness.ts`)                                                            | 20 s plain, 5-11 min instrumented, per file; `perTest` coverage would rerun them for every mutant of the assembler | `assembly/assemble.ts`, `consensus.ts`, `overlapBound.ts`, and the alignment they call: the Sanger read assembler against simulated reads |
| `src/test/oracle/alignment.test.ts`                                                                                                                     | the Biopython alignment oracle, ~5,000 s instrumented                                                              | `alignment/*` (through `@/core/alignment`), `app/alignmentStack.ts`, `alignmentTrack.ts`, `readAlignment.ts`, `readBatch.ts`              |
| `src/test/oracle/msa.test.ts`                                                                                                                           | the MSA oracle                                                                                                     | `alignment/msa.ts` and what it uses                                                                                                       |
| `src/core/alignment/banded.test.ts`                                                                                                                     | 9 s plain, ~2,400 s instrumented                                                                                   | `alignment/banded.ts`                                                                                                                     |
| `src/core/alignment/strands.test.ts`                                                                                                                    | slow instrumented                                                                                                  | `alignment/strands.ts`, `pairwise.ts`                                                                                                     |
| `src/app/readAlignment.test.ts`, `readAlignment.mapping.test.ts`, `readBatch.timing.test.ts`, `alignmentOrigin.test.ts`, `alignmentOriginIndel.test.ts` | the read-alignment and origin batches                                                                              | `app/readAlignment.ts`, `readBatch.ts`, `alignmentStack.ts`, `alignmentTrack.ts` and the alignment they call                              |
| `src/core/cloning/mutagenesis.property.test.ts`, `overlapPrimers.property.test.ts`                                                                      | property tests, many runs each                                                                                     | `cloning/mutagenesis.ts`, `overlapPrimers.ts`, and `digest.ts`, `ligate.ts`, `pcr.ts` through them                                        |

So in `alignment/*` and `assembly/*` the survivors of a pass include mutants
that these suites would kill, and the unit tests that do run are the only
check inside a mutation run. Triage them like any survivor, but before calling
a survivor in those directories a gap or an equivalent, apply it by hand and
run the skipped suites that name the file, plainly (`npx vitest run
src/test/oracle/sangerAssembly1.test.ts ...`, the `PLASMIDPOP_MUTATION` limits
are not needed without instrumentation): if one fails, the mutant is killed
and only the mutation run could not see it; if none does, it is a real
survivor. This is the "run the heavy suites uninstrumented" option of #355,
done by hand and only for the survivors, which is a handful of runs of 20 s
rather than 50 minutes of instrumented ones. Only the mutants of those few
files need it; `mutate:triage` prints the skipped suites that import a
survivor's file, and for `assembly/*` they are the four `sangerAssembly`
files (the harness reaches the assembler three imports away, too far for the
listing).

### What is not decided: to measure with a real run

None of these was run (no mutation run was started in this work); each needs
one pass on an idle machine, and the first four of #320's ideas depend on
them.

1. **The dry run with the allowlist and ranges.** Run `npm run mutate:changed`
   on the changes of a real release and note from the log: files and ranges,
   test files in the dry run, the dry run's wall time and its net time, mutants
   run and reused. Expectation, not a result: well under the 8 min 41 s of the
   two-file run for a few leaf files, close to it for core ones. If a core
   change still costs 20+ minutes, the next step is selecting tests by the
   previous report's coverage (`coveredBy` of the old mutants in the changed
   files, plus the tests new or changed since the tag), which is tighter than
   imports but unsafe for new code, so it needs a fallback.
2. **The last mutant that stalls (#320 idea 2).** The reading so far (note
   "Cutting the pass down") is that the wait is a loop mutant's timeout, whose
   budget is the net time of its covering tests times `timeoutFactor` (1.5)
   plus `timeoutMS` (30 s), tens of minutes when hundreds of tests cover it;
   the report does not hold the budgets. To confirm: when one mutant is left,
   look at the runner child's CPU (`ps -eo pid,ppid,pcpu,etime,args | grep
child-proxy`): busy is a loop waiting out its timeout, idle is a hang. Then
   interrupt once (Ctrl-C): Stryker writes a partial incremental report, and
   the mutant still without a verdict in
   `reports/mutation/stryker-incremental.json` (compare with the copy taken
   before the run) is the stalled one; its file, line, mutator and replacement
   are what to record here and in #320. Not verified that an unfinished
   mutant shows as such in the partial report; if not, run again with
   `--logLevel trace` and read the mutant ids the runner starts, last
   one first. Whether it is excluded (in `stryker.config.json`, never by
   editing production code) or `timeoutFactor` is lowered depends on that: the
   1.19.0 report points to hundreds of loop timeouts, not one mutant, so
   `--skip-loops` or a lower `timeoutFactor` is the likelier fix.
3. **`timeoutFactor`.** Not changed, on purpose: a lower factor turns
   slowness under load into kills, and the issue's evidence (6 timeouts idle,
   82 loaded) is about load, not about the factor. To measure: the JSON report
   has no test durations, so run once with `--logLevel debug` and read the
   per-mutant budget and the time of each mutant that finished, if Stryker
   prints them (not checked); the question is how close the slowest mutants
   that were killed by an assertion came to their budget. Repeat once on a
   loaded machine (a test suite beside it) to count the false timeouts a given
   factor makes. Keep 1.5 unless the gain is more than a few minutes and the
   loaded run shows no false timeouts.
4. **`--skip-loops` as the default.** It cuts the timeouts that wait out
   their budget (43 % of all 1.19.0 timeouts) at the price of 90 kills on loop
   counters. Decide after item 2 shows how much of the wait is loops.
5. **A bigger machine (#320 idea 6).** Done on the second machine, which has
   Node installed since 2026-10-29; the open point is that its incremental file
   was thin (661 mutants). `--incremental-from` fixes that; check that the
   first run there reuses nearly everything (the log's "mutant result(s) are
   reused" line).
