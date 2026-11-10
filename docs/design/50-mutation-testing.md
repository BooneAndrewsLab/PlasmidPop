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
trying no corners, `fitsElsewhere` (now `alternativePlacements`, #419) looking at a stretch of exactly `minOverlap`
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

### At 1.22 pre-release: `alignment/msa.ts` (#355, #357)

The 11 survivors on lines changed since v1.21.0 (the `sameCodes` helper and the
no-valid-window case of `kmerDistances`, L80-81 and L127) and three survivors of
old timeouts (`mutate:recheck-timeouts`) were each applied by hand and run
against `msa.test.ts`; `src/test/oracle/alignment.test.ts` and `msa.test.ts`
were not needed.

Killed: a different length with no valid k-mer on either side, in both orders
(`return false` to `true`, and the length check dropped); and, from the
timeout list, the radix of the k-mer words (`alphabet === 'protein'` to `true`
or `!==`: with radix 20 for bases an N counts as a word and the guide tree
changes, with radix 4 for residues nearly every word is spoilt) by the tree
`alignMultiple` returns for a base set and a residue set, and the refinement's
column cut (`.join('')`, which a join with a separator turns into garbage rows)
by a set the refinement improves, 1082.5 to 1151.5 in sum-of-pairs
(`msa.test.ts`: "counts the words on the radix of its alphabet" and "refines the
progressive alignment"). The re-check ran only `analysisClient.test.ts` for
these three (the one test file the report had for them), which is why they
survived there; `msa.test.ts` kills the `.join('')` mutant even without the new
test (the protein case), so only the two radix mutants were true gaps.

Equivalent, by kind:

- **Value always defined.** L80-81 `a?.length` and `b?.length` to `a.length` and
  `b.length`, `a?.[i]` and `b?.[i]` to `a[i]` and `b[i]`: both are `codes[x]` with
  `x < n`, never undefined (the optional chain only satisfies the type checker).
- **Tie, same value.** L81 `i < len` to `i <= len`: the lengths are equal by the
  line above, so the extra step compares `undefined` with `undefined`.
- **Guard covered by another guard.** L127, `windows[a] === 0 && windows[b] === 0`
  to `true && ...`, `... && true` or `||` (three mutants): when only one side has
  no valid window, `shared` is 0, so the general formula already gives 1, and
  `sameCodes` is false (equal codes have equal windows), which gives 1 as well.
  Only the case with none on both sides needs the special rule.

### At 1.22 pre-release: `assembly/assemble.ts` (#355)

The 19 survivors on lines changed since v1.21.0 (the read-pair code: `extentOf` and
its binary search, `extentOfCandidate`, `withPairs`, `pairWarning`, and the mate
lookup in `assembleWith`) and the two timeouts of the binary search that are not
loops were each applied by hand and run against `pairing.assemble.test.ts` (about
10 s for the file, against 70 s for `assemble.test.ts`; the Sanger oracle was
not needed). Nine were gaps and are killed by four new tests there; the 10 others
are equivalent.

Killed:

- L285 `first < 0` to `first <= 0`: a mate that lies at column 0 of the layout
  (a read hanging over the seed on the left) was treated as not placed, so its
  pair could not settle a repeat. "takes the mate at the first column of the layout".
- L293 `<` to `<=` (the search counts the consensus bases _up to_ a column, not
  before it) and L298 `before(last + 1)` to `before(last - 1)`: both move the
  mate's end by one or two bases, which the 100-base tolerance of the insert
  hides unless the insert sits exactly at its edge (template 350, insert 250 and
  450). "counts the mate from its first to its last base".
- L712 `startA - startB` to `startA + startB` and `endA + (length - endB)` to
  `endA - (...)`: a candidate place is extended by the bases of the read the
  alignment left out, which is nothing for a read that fits whole; a read with
  two foreign bases at one end, with the insert at the tolerance's edge, moves
  by 4 with the sign wrong. "counts the bases a read hangs over where it fits".
- L862 `r.index === pair.first` to `true`: the warning named the contig's first
  read, which is the first mate in every other test. With an unpaired read at the
  left, "names the mates and the distance in every warning" also fixes the
  warning's start, end and read.
- L870 `insert === null` to `true` and the template literal to ` `` `, and L880
  `template ?? 0` to `template && 0`: the insert and the distance in the
  `too-long` message were not asserted (same test; the facing-away message is
  compared whole).

Equivalent, by kind:

- **Sound timeouts, not gaps.** L292 `(lo + hi) >> 1` to `(lo - hi) >> 1` and
  L293 `lo = mid + 1` to `mid - 1`, with L291 `lo < hi` to `lo <= hi` (and the
  emptied body, L291): a binary search that no longer shrinks its interval loops
  forever, and a synchronous loop cannot fail an assertion, so only a timeout
  kills it. Applied by hand, `pairing.assemble.test.ts` hangs for all three
  (killed by `timeout`, exit 124), restored it passes in 2 s. The search is
  reached by any test that settles a repeat with a mate (the new column-0 test
  and the existing ones that settle a repeat).
- **Dead branch.** L285 `first < 0` to `false`: a placed read has an alignment,
  and an alignment has at least one column that is not blank, so `first` is
  never -1; the guard is there for the type checker and the row lookup above it.
- **Guard covered by another guard.** L833 `check.contig === null` to `false`:
  `assembly.contigs[null]` is `undefined`, and L835 skips that.
- **Unreachable defensive guard.** L835 `contig === undefined` to `false`: a
  check's contig index is one of the assembly's contigs. L864 `a === undefined
|| b === undefined` (four mutants: `false`, either operand `false`, `&&`):
  `pairWarning` is only reached with a state of `too-short`, `too-long`,
  `same-strand` or `facing-away`, which need both mates in the one contig;
  `linked`, where they are in two, returns null at the line above.
- **Dead branch.** L870 `''` to `"Stryker was here!"`: the `about` text is used
  only by `too-short`, `too-long` and `facing-away` with an insert, all of which
  need a known insert size (without one every distance is `consistent`).
- **Value unobservable.** L916 `options.pairs ?? []` to `["Stryker was here"]`:
  with no pairs `mates` gets one entry under `undefined`, and it is only ever
  read by a read's numeric index.
- **Guard covered by another guard.** L974 `mate === undefined` to `false`:
  `extentOf(undefined)` finds no row and returns null, which is what the guard
  gives.

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
  has no baseline, so it is mutated whole if it changed since the ref; one with
  no diff is reported as an unmeasured gap and left out (#400: in the 1.22
  pre-release run pairwise.ts and quality.ts, unchanged, were mutated whole
  and their dry run passed the 45 min ceiling twice). With no incremental file
  at all the script says it is a full run. `--whole-files` mutates the whole of each
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
   tests, list the equivalents in this note by kind. The timeouts left over
   from earlier releases are a separate, longer pass:
   `npm run mutate:recheck-timeouts` (below, #356).
5. One confirming rerun of `mutate:changed` (it reuses what it can), then the
   version bump.

### Re-checking old timeouts: `npm run mutate:recheck-timeouts` (#356)

A timeout counts as detected, and the incremental file keeps the timeouts of
every earlier run: 443 mutants after 1.21.0, of which the loop-counter flips
are sound kills. The rest were never looked at, and the by-hand pass of "At
1.21: mutants that timed out" found four gaps among 43. This script does that
pass for all of them.

For each `Timeout` mutant in `reports/mutation/mutation.json` and
`stryker-incremental.json` (a mutant in both is read from `mutation.json`, so a
timeout a later run killed is not re-checked) that is not a loop (an
`UpdateOperator` mutant, or any mutant on a line that opens a `for`, `while`
or `do`: the heuristic of `mutate:triage`), it applies the replacement at the
report's location, runs the test files that covered the mutant
(`coveredBy` mapped through the report's `testFiles`; the by-imports allowlist
of `relatedTests`, minus `MUTATION_SKIP`, for a mutant the report has no
coverage for), puts the file back, and records a verdict:

| Verdict        | Meaning                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| `survived`     | the covering tests pass with the mutant applied: it only made the code slower. **The list.** |
| `killed`       | a test fails: the timeout was a real kill that only needed its time to fail                  |
| `timeout`      | the tests ran out of time again (the process limit, or a test limit): sound, leave it        |
| `error`        | the mutated file did not compile or load; read it by hand                                    |
| `stale`        | the file changed since the report (the span or its lines read differently): not applied      |
| `no-tests`     | no existing test file covers it                                                              |
| `baseline-red` | the file's tests fail unmutated, so no verdict means anything; the file is skipped           |

The limit per mutant is the time of the file's covering tests run once
unmutated times 4, at least 20 s (`--timeout-factor`, `--min-seconds`; or one
`--timeout-seconds` for all). Vitest runs as `vitest run <files>
--testTimeout=<half the limit>` in its own process group, and the group is
killed at the limit, so a loop that never ends is gone, workers included.
Mutation-mode settings (`PLASMIDPOP_MUTATION*`) are removed from its
environment: a plain run, no instrumentation.

**Survivors are not all gaps.** Sort each by kind in this note: cache,
prefilter, fast path, guard (equivalent), or a missing test (write it; never
change production code; one fresh agent per file). The report is
`reports/mutation/timeout-recheck/report.md` and `report.json` (git-ignored with
the rest of `reports/mutation`), per file with the covering test files.

**It edits the real source, one mutant at a time, so it must never leave one
mutated.**

- The original text is held in memory and written back in `finally`, on SIGINT,
  SIGTERM and SIGHUP (it also kills the test process group and saves the
  state), on an uncaught error or rejection, and at process exit.
- Before a mutant is written, a copy of the file (`applied.orig`) and a journal
  (`applied.json`) go to the state folder. After a kill -9 the next start
  restores the file from them before it reads anything.
- It refuses to start if the files it would mutate have uncommitted changes
  (`git status --porcelain`), or outside a git checkout, or if another run's
  lock names a live process.
- After every mutant it compares the file with the original and runs `git diff
--stat HEAD` on the target files; if either differs it stops and says so.
- A mutant is applied only where the file still reads as the report's source
  on the mutant's lines (`stale` otherwise): 20 of the 125 in the 1.21.0
  report were stale, in six files changed since.

Flags: `--dry-run` (what it would apply, per file and line, with the number of
covering test files; no file touched, no test run, no state written), `--file
<path>` (repeatable; a path or part of one), `--limit <n>` (at most n mutants
now), `--resume` (the state file `state.json` is written after every mutant, so
an interrupted run continues; without the flag a run starts a fresh state),
`--report <file>`, `--dir <folder>`. Run it on an idle machine with nothing
else saving the files (the editor, a test run): a mutated file is on disk for
the length of each run. The unit tests
(`src/test/scripts/timeoutRecheck.test.ts`) run it end to end on a toy project
in a temporary directory with a fake runner, including a SIGTERM in the middle
of a mutant and a leftover journal; the real sources are never touched there.

Counted read-only in the 1.21.0 reports: 443 timeouts in `stryker-incremental.json`
(423 in `mutation.json`), 125 of them not loops by this heuristic, 105 of which
apply (20 files; 20 stale). The heuristic counts every mutant on a loop's
header line as a loop, so the number to re-check is smaller than the "about
245" first estimated from `UpdateOperator` alone.

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

### At 1.22 pre-release: `annotate/detect.ts` (#355)

The 11 survivors on lines changed since v1.21.0 (the `hidden` option of
`detectFeatures` and `keepBest`, item 131: L493 the `answer` shortcut, L971 the
host's name, L986 the `host !== undefined` branch, L1010-1012 `byPlace`) were each
applied by hand and run against `detect.test.ts` (new tests) and, for the
equivalent ones, all of `src/core/annotate` (552 tests, corpus included). Seven
mutants were gaps and are killed by two new tests there; the other four are
equivalent.

Killed:

- L986 `host !== undefined` to `true`: a hit dropped for another reason (a part
  inside a longer one of its type, which is no gene's segment) was returned as
  `hidden: "a segment of undefined"`. "returns only what a segment of a gene
  displaced, not every dropped hit".
- L1010-1012, `byPlace` as it orders the hidden segments (the arrow function to
  `() => undefined`, the whole expression to `true` and to `false`, `||` to `&&`,
  `x.range.start - y.range.start` to a sum; the `hidden.sort(byPlace)` call
  itself is the same gap, L1012 `hidden.sort` to `hidden`): segments are found
  longest first, so two of them in sequence order differ from that order only
  when a long one starts after a short one. "lists the segments it returns in
  sequence order, the longer first from one start" has a segment at base 100 that
  is the longest, and two from base 0.

Equivalent, by kind:

- **Value always defined.** L971 `library.parts[k.part]?.name` to
  `library.parts[k.part].name`: the part of a kept hit is in the library (the
  optional chain only satisfies the type checker, as on the lines around it).
- **Fast path.** L493 `hiddenHits.length === 0` to `false`: with nothing hidden
  the spread appends nothing, and the answer is an equal copy of `hits`.
- **Tie, already in order.** L1011 `size(y) - size(x)` to `size(y) + size(x)`:
  the hits come from `ranked`, longest first, so two from one start are already
  longer first and a stable sort leaves them. Not distinguishable for the hidden
  list either, which is also in `ranked` order. L1012 `finest.sort` to `finest`
  (kept): `withRepeats` sorts its answer by start and then longest first
  regardless of its input, and is the next step in `detectFeatures`.

The `// Stryker disable next-line ArithmeticOperator` above `byPlace` sits two
lines above the `size(y) - size(x)` it describes (the arrow's body went to its
own line when the sort was shared with the hidden list), so it disables
nothing; the survivor is reported as if it were new. Moving it onto the line of the
body would do; production code was not touched here.

### At 1.22 pre-release: `analysis/gel.ts` and `cloning/protocol.ts` (#355)

The 12 survivors on lines changed since v1.21.0 (item 132, the wrong clones:
`checkSummary` in `gel.ts`, L372-380, and `diagnosticDigests` and `buildProtocol`
in `protocol.ts`, L493-555; `protocolText.ts` had none) were each applied by hand
and run against `gel.test.ts` and `protocol.test.ts` (the equivalent one also
against all of `src/core/cloning`, 820 tests). Eleven were gaps and are killed by
seven new tests there; one is equivalent.

Killed, in `gel.test.ts` ("the edges of checkSummary"):

- L372 `c.contrast >= resolution` to `>`: a lane whose contrast is exactly the
  resolution (1,000 against 1,500 bp, resolution 1.5) was not counted as told
  apart. "counts a lane whose contrast is exactly the resolution as told apart".
- L377 `c.contrast < weakest` to `true` and to `<=`, and L380 `c.contrast ===
weakest` to `true`, `false`, `!==`, and `Math.min(faintest, c.band)` to
  `Math.max`: the summary of a set of lanes, which the existing tests compared
  with one lane of a kind. The new tests use a product of 3,000 + 1,000 bp and
  lanes that differ from it at a ratio of exactly 2 (`half`, at the product's
  1,000 bp band; `extra`, at its own 500 bp band) or of 10 (`sliver`), in both
  orders: the weakest lane wins wherever it falls (`true`), lanes tied for weakest
  keep the faintest differing band whichever comes first (`<=`, `Math.max`,
  `false`, `!==`), and the band of the weakest lane is not replaced by a stronger
  lane's (`true`, `!==` at L380).

Killed, in `protocol.test.ts` ("diagnosticDigests against wrong clones"):

- L493 `gelProfile([], gel)` to `gelProfile(["Stryker was here"], gel)`: the lane
  of a wrong clone the enzyme misses has no band and no fragment (an uncut circle
  is not drawn), and is not told apart.
- L499 `contrast >= resolution` to `true` and to `>`: `apart` on the lane of a
  clone whose digest is the product's, and on one at exactly the resolution
  (3,000 + 1,500 against 3,000 + 1,000 bp, resolution 1.5, and 1.51).
- L555 `options.wrongClones ?? []` to `&& []` (the list `buildProtocol` hands to
  `diagnosticDigests`): with clones given, no digest carried a wrong lane. The
  existing tests of the lanes call `diagnosticDigests` directly; "hands
  buildProtocol's wrong clones to the diagnostic digests" goes through
  `buildProtocol`. (With no list the mutant gives `undefined`, and the default
  parameter takes `[]`, so that side is the same.)

Equivalent:

- **Tie, same order.** L510 `wrongClones.length === 0` to `false`: the sort then
  uses `compareCheckAll` with no wrong lane at all, whose summaries are equal
  (nothing apart, weakest 1, faintest 0) and whose last rule is
  `compareDiagnostic(a.product, b.product)`, the very call the guard makes.

### Old timeouts re-checked at 1.22 (#356)

`mutate:recheck-timeouts` listed 15 survivors of old timeouts in five files; the
three in `alignment/msa.ts` are in "At 1.22 pre-release: `alignment/msa.ts`".
The other 12 were each applied by hand (an exact replacement, then `git checkout
-- <file>`) and run against the test files that covered them in `report.json`:
`search.ts` against all 98 (1,653 tests, about 27 s), `primerDesign.ts` against 4,
`structure.ts` against 17 to 22. One was a gap and is killed by a new test; the
other 11 only slow the code down and are equivalent.

Two more of the `primerDesign.ts` ones, in `shortlist()`, were gaps too: L361 `return candidates.slice(0, SHORTLIST)` to `return candidates` and L368 `if (out.length >= SHORTLIST) break;` to `if (false) break;`. Both are killed by "pairs only the best 40 forward and 40 reverse primers" in `primerDesign.test.ts` (one run each for `requireSpecific` false and true), which counts the distinct primers in the pairs of a wide design and fails with 352 and 189 under the mutants.

Killed, in `inputQuiet.test.ts`: `whenQuiet`'s wait, L90 `{ await sleep(...);
continue; }` to `{}`. The mutant does not sleep until the input has been quiet; it
falls through to `whenIdle` and asks for an idle moment on every turn, polling
until `sinceInput()` reaches `quietMs`. It is not a busy loop in the tests (each
turn waits on a fake timer or an idle callback, so it ends and gives the same
resolution time), only a wake-up on every turn in a page, which is why the covering
tests passed. "sleeps until the input has been quiet that long, asking for no idle
moment meanwhile" counts the idle requests while 900 of 1,000 quiet ms pass: none,
where the mutant has asked once already.

Equivalent, by kind:

- **Fast path.** `search.ts` L22 in `codeMask`, `c < 128` to `false` and to
  `c <= 128`: `ASCII_MASKS` is `lookupMask` of each of the 128 characters, so
  `false` sends every single character to `lookupMask` itself, the answer the
  table holds; and for code 128, `ASCII_MASKS[128]` is undefined (`?? 0`) and
  `lookupMask` of U+0080 is 0 (no IUPAC set has that key). A table lookup instead
  of an object lookup and an upper-casing, item 99.
- **Prefilter.** `primerDesign.ts` L413 and L430, `failsBasics(bases, c)` to
  `false`, and L290, the body of `failsBasics` to `{}` (returns `undefined`, the
  same as `false`): `failsBasics` applies GC, homopolymer and Tm bounds to the
  same cleaned sequence with the same measures that `analyzePrimer` reports and
  `candidatePenalty` checks first (`report.gc`, `report.homopolymer`, and
  `report.tm`, which is NaN for a degenerate window, so refused there too). What
  it rejects, `candidatePenalty` returns null for, so the candidate list is the
  same; the prefilter only spares the free-energy scans of `analyzePrimer`.
- **Cache.** `structure.ts` `remembered`: L175 `seen !== undefined` to `false`,
  L177 `memo.size >= MEMO_LIMIT` to `true` and to `memo.size < MEMO_LIMIT`, L178
  `memo.set(key, value)` removed. Each computes again where the memo would have
  answered (`true` and `<` clear it before every store, which is no memo until it
  holds 50,000 answers), and the fold is a pure function of its arguments. Nothing
  outside the module reads the memo, so only the time differs.
- **Cache key.** `structure.ts` L372 (`hairpinFold`) and L477 (`dimerEnergy`),
  `p !== STRUCTURE_PARAMS || maxLoop !== MAX_LOOP` to `true`: the condition sends a
  call with custom parameters or a custom loop limit round the memo. Always `true`
  means never using it, which is the uncached fold for every call. These are the
  safe side of the guard: the gap #356 feared (a cache keyed on the sequence only,
  so a second call with other parameters reads the first one's answer) is the
  mutant that makes the condition `false`, and "the fold cache is keyed on the
  sequence only for the default model" in `structure.test.ts` (1.21) already kills
  that one. No new test is possible for `true`: the result is the same.

**The 105 that timed out again, at 120 s.** The first pass used 20-25 s per
mutant (four times the unmutated tests). Run again with 120 s on the second
machine (`--timeout-seconds 120`), the 127 old non-loop timeouts came out as 27
killed, 16 survived and 84 still timed out. The 12 mutants that went from
timeout to killed were slow, not endless: a test fails them given the time, so
they are sound kills. The 16 survivors are the 15 above plus two in
`primerDesign.ts` (L361 and L368), the shortlist cap, now killed by the new
"designPrimers shortlist" tests. The 84 that still time out are mostly in
parsers, hashes and diffs (`io/xml.ts`, `checksum/sha1.ts`, `seguid.ts`,
`verify/variants.ts`, `diff/documentDiff.ts`, `io/ncbi/efetch.ts`), where moving
a position or dropping the step that advances it never ends. They are recorded
as sound kills by reading, not proved one by one; a longer limit would only
spend its whole budget on each.

### Measured at 1.22 (#355, #320)

All on the workstation, idle (load under 1), `npm run mutate:changed`.

1. **A core-file change costs about 7.5 minutes.** A one-line change in
   `core/sequence/alphabet.ts`, which nearly everything imports (scratch
   commit, never merged), ran 384 of 451 test files in the dry run: 6 min
   30 s for 6,438 tests (net 203 s, the rest instrumentation overhead), then
   4 mutants in under a minute; 7 min 27 s in all, no timeouts. The
   expectation of 20+ minutes for a core change did not hold, so selecting
   tests by the previous report's coverage is not needed. What made the dry
   run long before was `pairwise.ts` and `quality.ts` (use `--without`).
2. **No stalled last mutant** in the 1.22 runs (9-10 min for the whole pass).
   The 1.19.0 stall was a loop mutant's timeout over a whole-file run, not a
   hang.
3. **`--logLevel debug` cannot be used here**: the vitest runner's child
   process fails with "Converting circular structure to JSON" (the resolved
   config, key `test`). So per-mutant timeout budgets cannot be read from a
   debug log, and `timeoutFactor` stays 1.5. The 1.22 runs gave no evidence
   against it (0 false timeouts idle on the changed lines).
4. **`--skip-loops` stays opt-in.** On changed lines the 1.22 pass had no
   timeouts to save, so the default buys nothing there; it matters for
   whole-file runs only.
5. **The second machine reuses the workstation's report completely.** The
   1.22 pre-release pass (`mutate:changed v1.21.0 --without pairwise.ts
--without quality.ts --incremental-from <workstation report>`) on duncan:
   6 files, 55 line ranges, 364 of 364 mutant results reused, dry run 4 min
   56 s (5,679 tests), 5 min 10 s in all, score 92.49 as on the workstation.
   The checkout there was synced by `rsync` (with `.git`, without
   `node_modules` and `reports`), so `git diff` against the tag sees the same
   lines.
6. **Not measured:** a loaded-machine count of false timeouts. It only
   decides whether `timeoutFactor` could go below 1.5, which nothing asks for.

### Triaged at the 1.22 release (#372)

The pre-release run (`npm run mutate:changed -- v1.21.0`, score 92.22, floor 90)
left 145 survivors and uncovered mutants on changed lines: `alignment/msa.ts` 130
(the banded joins of #372 and the banded refinement), `assembly/assemble.ts` 10,
`annotate/detect.ts` 4 and `cloning/protocol.ts` 1. Every one was applied by hand
(the report's replacement put on its line, the tests run, `git checkout` of the
file) and, in `msa.ts` and `assemble.ts`, run against the skipped oracle suites as
well (`msa.test.ts` and `alignment.test.ts`, the four `sangerAssembly` files).
No mutant was killed only by a skipped suite. Only tests were added; production
files are untouched, so the equivalents below are recorded here and carry no
`Stryker disable` comment.

**Not covered by this run.** `alignment/pairwise.ts` and `alignment/quality.ts`
were left out (`--without`). They have no incremental baseline, and a dry run
with them in exceeded the 45-minute ceiling. Their survivors are untriaged.

**`msa.ts`: 74 killed, 57 equivalent or unreachable.** The new tests are in
`src/core/alignment/msaBand.test.ts`. The existing banded tests compared the
banded alignment with the full fill, so a fault in `fillBand` or `reachable` that
changed both the same way passed. The new ones pin what the code does:

- _Pins:_ for 26 sets (similar bases and residues with indels, a long
  insertion, swapped halves, identical sequences, a refinement that gains, bases
  past either end of one or two sequences, a word met 4, 5 and 2 times, exactly
  10 and exactly 9 shared words, an ambiguity code in every twelfth column,
  gaps that cost nothing or pay, an open cheaper than an extension, unrelated
  sequences, one shared core) the cells filled and the cells of the full matrix
  for every join in order, each row's gap runs, the column count and the
  sum-of-pairs score. These kill the top edge and left edge of `fillBand`, the
  tie and end-state choices, the terminal gap costs, `gapExtend * fa` on the left
  edge (needs half-gapped columns met at an end), the three conditions that stop a
  band being tried (`gapOpen <= gapExtend`, `gapExtend <= 0`, too few anchors),
  the cap on occurrences of a word (4 allowed, 5 not), the ambiguity code that
  breaks a word (code `S` is the first past the four bases), `2 * firstCells`,
  whether the guess is accepted or a second band filled (`within`), and the
  cells added up for a second fill.
- _Exact rows_ of five small sets (a base cut at either end, one added and one cut
  inside, a repeat, residues, ambiguity codes).
- _Limits:_ a join of exactly `maxCells` cells runs and one cell fewer throws; a
  join of exactly `bandAbove` cells is filled whole and one more cell is banded.

Equivalent or unreachable, by kind (57):

- **Value always defined (8).** `sameCodes` L91-92 (`a?.length`, `a?.[i]`: both
  are `codes[x]` with `x < n`; `i <= len` compares `undefined` with `undefined`)
  and L138, the no-valid-window test of `kmerDistances` (`&& true` and `||`: with
  one side empty `shared` is 0 and the general formula gives 1 as well).
- **Past the end of a typed array, or an extra turn that reads nothing (11).**
  L349 (`lo` of `wholeMatrix` is all zeros, and `?? 0` gives 0 beyond its end),
  L332, L518, L566, L567, L575 `t <= k`, L577, L582, L584, L596 (a write past
  the end is dropped, a read beyond gives `undefined`, which `?? 0` or `?? NEG`
  turns into what the loop would have read) and L624 `i <= inner.lo.length`
  (`undefined` against `undefined`).
- **Same value (4).** L394 `prevM[0] && NEG` (`prevM[0]` is 0 or `NEG`, and `NEG`
  is truthy); L525 `w * radix - best` (the word hash is the negative of the
  original from the first base on, so it is as good a key); L586 `f !== 0` to
  `true` (adds `0 * best`, finite); L533 `list.length <= MAX_OCCURRENCES` to
  `true` (a list past 5 is refused at L538 anyway).
- **The two ends of the traceback (2).** L464 `i === 0` to `false` or its body
  emptied: the top-edge entries the fill wrote (`trace[j] = 1 << 4`) make the
  general branch push the same `2`.
- **Far diagonals and very low scores (5).** L595 `sums` one shorter, and L610
  and L612 `high <= n`, `low >= -m` and the loop test to `true`: `lossA[x]` is
  `undefined` (so `Infinity`, so `fits` is false) past the end either way, and
  `fits` is only true for the far diagonals (`x >= n - 1`) when the guess scores
  below the all-gaps path, which a band of 15-base words never gives. The same
  fact makes `regionCells >= full` (L661, `> full`, `&& ...`, the emptied block,
  L662's `{}`) unreachable, nine mutants: a region as large as the matrix needs
  every diagonal from `-m` to `n`.
- **The climb from 0 (2).** L609 `Math.max(0, shift)` to `Math.min(0, shift)`, L611
  the same for `low`: `fits` has the same value for every diagonal between 0 and
  `n - m` (the same number of gap columns), and it is true for the path the guess
  found, so the loop climbs to where the original starts.
- **Float ties (4).** L601 (three mutants of `slack`) and L607 `>=` to `>`: the
  slack only absorbs rounding where the bound is exactly the score, and a
  difference of 1e-6 relative is never reached by an integer-valued score.
- **Bound only (1).** L575 `row[t] && 0`: the best of each base against a column of
  the other profile is a max, and a pure column of that base reaches it, so a
  mixed column's sum is never the max. A profile with a base in no pure column
  that still has 10 words was not built.
- **Hairline boundary (3).** L649 `n - 1` and `m - 1`, L656 `2 * firstCells >= full`:
  each changes the fallback only when twice the cells of the first band is within
  one row of the matrix. Not constructed.
- **The refinement budget (8).** L656 `firstCells > budget`, L661 `guess.cells +
regionCells > budget` (three mutants), L690 (three) and L910-915 (`REFINE_CELLS
  - spent`, `out === null`, `spent += out.cells`): a join's budget is
`REFINE_CELLS` (300 million) less the cells already spent, so they differ only
    once the refinement has filled most of 300 million cells, which needs several
    full fills of 12 kb sequences, a minute or more a test. Progressive joins
    have an infinite budget. Left for a measurement, not a unit test.

**Non-loop timeouts (5), applied by hand.** `msa.ts` L464 (`i === 0` to `true`, to
`i !== 0`) and `assemble.ts` L292 and L293 (`lo - hi`, `mid - 1`) never end, so
they are sound kills; `msa.ts` L625 (the `within` test's body emptied) is
killed by the pins, since the guess is then accepted without its second fill.

**`assemble.ts`: 10 equivalent, 0 killed.** L285 `first < 0` (a row always has
a base: reads are not empty), L833 `check.contig === null` (`contigs[null]` is
undefined and L835 continues), L835 `contig === undefined` (a check's contig
is in range), L864 four mutants of `a === undefined || b === undefined` (both
mates of a checked pair are in the contig's reads), L870 `''` for the insert
note (`about` is used only for states that need an insert size, which is then
not null), L916 `options.pairs ?? []` (iterating a string sets one useless
key), L974 `mate === undefined ? null : ...` (`extentOf(undefined)` finds no
row and gives null). L870 showed "killed" in a run made with the msa
harness running beside it and passes alone: the oracle files can time out
under load, so check a verdict that only a skipped suite gives on an idle
machine.

**`detect.ts`: 4 equivalent.** L1011 `size(y) + size(x)` and L1012 `finest`
unsorted (`withRepeats` sorts again by start, then size: the same comparator),
L971 `parts[k.part]?.name` (a hit's part is in the library), L493
`hiddenHits.length === 0 ? hits : [...]` (a copy of the same list). The first
sits on the line after the `Stryker disable` comment that covers the
`byPlace` declaration, so the comment does not reach it.

**`protocol.ts`: 1 equivalent.** L510 `wrongClones.length === 0` to `false`:
`compareCheckAll` with no wrong lanes gives `apart` 0, `weakest` 1 and
`faintest` 0 for both candidates and falls through to `compareDiagnostic`.

### Old survivors of `alignment/pairwise.ts` and `quality.ts` (#399)

Neither file changed after 1.21.0, so the 1.22 pre-release pass left them out
(see "Triaged at the 1.22 release (#372)"). Their survivors came from duncan's
run 10, which mutated both whole: 178 survivors and uncovered mutants, 151 in
`pairwise.ts` (8 of them uncovered) and 27 in `quality.ts`. They were rechecked
on 2026-11-07 against today's tests, each mutant applied by hand to the source
and run against the six direct test files (`pairwise`, `protein`, `quality`,
`banded`, `quality.property`, `strands`): 41 are killed now, 137 were not. The
new tests below kill 99 of the 137, and 38 are equivalent. Production files are
untouched, so the equivalents are recorded here and carry no `Stryker disable`
comment.

**New tests (99 killed: 21 in `quality.ts`, 78 in `pairwise.ts`).**

- `quality.test.ts`. `columnQualities` called on alignments written
  out by hand: a gap before the first read base, inside the read (the lower of
  the bases either side, with the poorer one on either side), after the last
  base, a run of gaps, a local alignment that starts inside the read.
  `readDifferences` positions after an insertion and after a deletion (the
  other sequence's position must not move). `trimByQuality` where a base scores
  exactly 0 (a stretch cannot start on it, nor grow by it) and a cutoff above 1
  (the end cannot pass the read).
- `pairwiseLimits.test.ts` (new). The text of each
  `AlignmentTooLargeError` reason and its `name`; the cells of a full matrix
  counted from both sides; a matrix of exactly `maxCells` cells runs and one
  more refuses, for `alignPairwise` and for `alignInBand` (whose own check
  `alignPairwise` normally shadows); `scoreInBand` keeps nothing and so has no
  limit; a refused allocation (the `Uint8Array` stubbed to refuse the one length)
  reports `memory`; `bandCells`; a band of the wrong length, a global band
  that stops short of the last column, a path that leaves its band; `mode` is
  global when not given; a gap in the first sequence counts and is marked.
- `pairwiseBand.test.ts` (new). 700 random small alignments, global
  and local, in a band round a random corner-to-corner path, against a plain
  reference (the same recurrence with `-Infinity` outside the band, written
  separately): `scoreInBand` and `alignInBand` give its score, the returned
  strings are the stretches they claim, their rescoring is the score, and the
  path stays in the band. 300 more with a first row that starts right of column
  0 (score only). Then 10 pinned cases of equal alignments (which of equal gap
  placements or stretches comes back: `>=` against `>` on `openX`, `extX`, `openY`,
  `extY`, `mScore <= 0`, `mScore > best`), with the band edge a path ran along
  (`touchedEdge` from the left edge, from the right edge and not from the
  matrix edge). The pins were found by trying each surviving mutant on random
  inputs until its output differed, and were then checked by the reference
  and the rescoring, so a pin that moves is told apart from a worse alignment. A
  global band that does not hold the origin cannot be traced back, and the
  fill reports its progress by the rows two million cells make.

**Equivalent (38).**

- `quality.ts` (3). L27 and L39 `typeof v === 'number'` to `true`: the guards
  `isConfidentQuality` and `isTrimCutoff` call `includes(v)` on a list of numbers,
  which is never true for a value that is not one. L142 `c < alignment.columns`
  to `<=`: the extra column reads `charAt` past the end, `''`, which is not a gap
  or a `.`, so no difference is recorded.
- **Defaults that are only compared (2).** L96 `reason = 'limit'` to `""`: the
  reason is tested against `'memory'` and `'unanchored'`, and anything else
  gives the limit message. L255 `options.mode ?? 'global'` to `""` in
  `fillBand`: `local` is the only thing it feeds (`traceBack`'s own L445 is the
  alignment's `mode`, and is killed).
- **A check done twice (3).** L169 `maxCells ?? DEFAULT_MAX_CELLS` to `&&`, L171
  `cells > maxCells` to `false`, and L171's throw removed: `alignPairwise` checks
  the full matrix, and `fillBand` checks the same cells with the same options
  and throws the same error, so an unchecked `alignPairwise` still stops. The
  rest of L169-171 is killed: `>=` by the exact boundary, the three mutants of
  the cell count by the exact message.
- **Cache hit or miss (3).** L234 (`e.a === a && e.protein === protein` to `false`),
  L235 `at < 0` to `<= 0` and `[undefined]` to `[]`: `encodedFirst` only avoids
  encoding the first sequence again; a miss encodes it again to the same codes.
- **`mismatch` as a fallback (3).** L258 (`* SCALE` to `/ SCALE`, `-4` to `+4`,
  `??` to `&&`): the variable is read only in `scores[...] ?? mismatch`, and an
  index inside the table is never undefined.
- **A sentinel written twice, or past the typed array (13).** Row 0's `lo0 > 0`
  block (L317-320: the condition as `false`, `>=` and `<=`, the block emptied,
  `prevX[lo0 + 1]`) and the `rowLo > 0 && rowLo - 1 < aboveLo` block of each
  later row (L338: false, `rowLo > 0` to `true`, `>=` and `<=`, `rowLo + 1`, the
  block emptied) write `NEG` to the cell left of the row above's band. The
  `curM[rowLo - 1] = NEG` of L348 has written it already, as `cur` of the row
  before, and row 0's block covers row 1 the other way round, so either of the
  pair alone gives the same fill. `rowLo >= 0` and `true` on L338 and L348 also
  write at index -1 of a typed array, which is dropped. (The `lo0 + 1` forms of
  `prevM` and `prevY` are not equivalent: they alter a real cell of row 0, and
  the reference kills them.)
- **Column 0 is not a path (7).** L305-309 (the `j === 0` block emptied, and
  `if (keep)` to `true` or `false` in it): `tb` at (0, 0) is never read, since
  the traceback stops when `i` and `j` are both 0, and the zeros the arrays
  start with tie with `pm` and fall to `M`. L354 (`rowLo === 0` to `false`, or
  its block emptied) and L358 (`i === 1` to `false`): the general recurrence gives
  the same values at column 0 (a gap in the second sequence from the cell above)
  for a global alignment; in local mode a path that starts with a gap scores
  no more than one that starts after it (gap open `<= 0`) and ties go to the
  `M` of the start cell; and the `X` state that `i === 1` would send to row 0 ends
  the traceback there anyway. L358 `keep` to `true` writes into a zero-length
  array when nothing is kept.
- **Guards the traceback never meets (4).** L463 `i === 0` and `j === 0` in the `M`
  branch, L470 `i === 0` in `X`, L476 `j === 0` in `Y`: the traceback only
  reaches row 0 or column 0 in a state the fill gave a finite score there, which
  is `Y` on row 0 and `X` in column 0, and `M` at the cell (0, 0) where the loop ends; a
  band with no path to the corner throws at L458 before it.

No survivor is left unclassified. The classes were also tried on 40,000 random
alignments, bands and options each (`pairwise.ts` copied and mutated outside the
repository): none changes a result or an error message.

### Triaged at the 1.23 pre-release (#411, #412, #413)

The pre-release run (`npm run mutate:changed`, floor 90) left 182 survivors and
uncovered mutants on lines changed since v1.22.0: `cloning/yeastAssembly.ts` 88
and `cloning/overlapAssembly.ts` 73 (both new in 1.23.0 and mutated whole),
`help/staticGuide.ts` 9, `cloning/gibson.ts` 6, `cloning/overlapPrimers.ts` 4 and
`cloning/protocol.ts` 2. The one timeout is a loop, a sound kill. Every survivor
was applied by hand (the report's replacement put at the report's location, the
covering tests run, the file restored) first against the tests as they stood and
again, at the end, against the tests below. The mutants of `gibson.ts` and
`overlapPrimers.ts` were also run against `overlapPrimers.property.test.ts`, the
skipped suite that names them: it kills none that the plain tests do not. Only
tests were added; production files are untouched, so the equivalents are
recorded here and carry no `Stryker disable` comment.

**124 killed, 58 equivalent, none unclassified.** (The confirming `mutate:changed`
run after the tests below scored 92.25 and left exactly these 58 equivalents.)

**Killed (124).**

- _`overlapAssembly.ts`, 67 of 73_, in `overlapAssembly.test.ts` and the new
  `overlapAssembly.guard.test.ts`. The first pins the refusals with their exact
  text and numbering (no inserts, a vector shorter than the kit's homology and
  one exactly as long, an insert one base under two primers' worth and one base
  over, a single insert shorter than the homology against a second one of 38 and
  40), the cap of half the insert on an annealing part (a 40-base A/T insert
  anneals 20 bases, not 30), the primer labels on the product, the product's
  name and circle for each kit, junction marks and yeast wording for the yeast kit
  only, the "not specific to it" refusal with the insert's number and the primers
  kept (singular and plural), the ambiguous-ends refusal, and every sticky-end
  and split sentence. The second mocks `yeastAssembly` to answer wrongly, since
  the real assembler's answers never reach the checks after it (400 random
  designs, three or four inserts, either strand, three splits, two kits, a
  third of the inserts from the vector itself: none failed and every circle was
  the asked-for order, in the vector's own orientation). It pins the fallback
  text when the assembler gives no reason, its own reason when it has one, a
  circle of the pieces in another order, a circle of the right bases and the
  wrong length (a stretch of the asked-for one), and that a rotated circle and a
  reverse-complemented one are accepted.
- _`yeastAssembly.ts`, 46 of 88_, in `yeastAssembly.test.ts`. The vector found
  among parts turned over when an earlier turned part carries its name; the
  overlap asked for in the refusal of a short vector; the junction features'
  `label` and `note`; two long junctions and two poor-GC junctions in one
  warning (the `'; '` join); a repeat that starts at the first base of a part,
  to name its part (`partAt`'s two edges and the part ends `layout` computes);
  exactly ten repeats listed and eleven with a count; a repeat inside a linear
  product (the closing overlap that is read off its ends); the free-vector-end
  sentence with the vector last; what counts as an annotation (`homology 12`,
  `a homology 1`, `homology 1 b`, a CDS named `homology 3`, an unrelated
  misc_feature); the bacterial origin and resistance warning (a primer site
  named for an origin is not one, a misc_feature origin is); and `gcPercent('')`.
  For `directRepeats`: three copies in a row (pairs first-second and
  second-third, not first-third), two repeats whose order by distance differs
  from their order by first copy, two repeats on neighbouring diagonals that a
  run must not join (a 35-base unit and a 64-base one that starts 6 bases on),
  two copies that overlap each other going round a circle, and a window that
  ends where a blocked stretch begins across the origin. Hand-derived
  positions throughout.
- _`staticGuide.ts`, 9 of 9._ The pages have the search box's style, box and
  script and the tutorials none of the three, and both end their header and
  body where they should. The tests generate the pages inside the test: work at
  load cannot be told apart per test (#77), which is why one of the nine
  (`section.search === true` to `true` at the script line, killed by an old
  assertion that ran at load) survived the run and dies when run plainly.
- _`overlapPrimers.ts`, 3 of 4_ (the yeast and Gibson sticky-end wording, exact;
  a yeast design closes a circle, named as asked, with its two junctions marked
  at 2960-3000 and 0-40) and _`protocol.ts`, 1 of 2_ (a yeast step lists its
  parts by name).

**Killed without a new test (1 of the 124).** `staticGuide.ts` L321 (`section.search
=== true` to `true` on the script line) dies to an existing test when run plainly
and was reported as a survivor by the run: it is the load-time generation of
`staticTutorials.test.ts` (#77). An earlier pass also listed `directRepeats` L406
(`circular && ...` to `circular || ...`) here; the confirming run and a by-hand
application of it (the five covering test files, 161 tests, all pass) show it
survives, and it is equivalent (below).

**Equivalent or unreachable, by kind (58).**

- **A fallback that an index in range never takes (13).** `?? 'one part'`, `?? 'the
next'`, `?? 'a part'` and `?? ''`, none of them covered: `gibson.ts` L564-566
  (three), `yeastAssembly.ts` L188, L189, L249 (two), L273, L277 (two), L284 and
  `overlapAssembly.ts` L113 and L134. The index is the loop's own or a hit's.
- **`?.` taken off an index in range (12).** `gibson.ts` L564-566 (three),
  `yeastAssembly.ts` L188, L189, L249 (two), L273, L277 (two), L284 and
  `overlapAssembly.ts` L113: the type needs the `?.` for `noUncheckedIndexedAccess`,
  and the element is always there.
- **A narrowing the type needs (3).** `overlapAssembly.ts` L186, `.filter((a) =>
a !== null)` taken off or its test made `true`: every amplicon in `made` is
  one, since a failure returns before it is pushed. `protocol.ts` L395 `step.op
=== 'gibson'` to `true`: `kit` exists on a gibson step only, which the other half
  of the test already says.
- **An option left to the callee's default (2).** `options.name === undefined` to
  `false` (`overlapPrimers.ts` L179, `overlapAssembly.ts` L188): `{ name:
undefined }` is what `gibson` reads with `options.name ?? default`.
- **A check another one implies (7, `yeastAssembly.ts`).** L283 `pos >= s.start` to
  `true`: the parts are in order and `findIndex` takes the first whose end is
  past `pos`. L144 `p.flipped` and the name test (three mutants: each taken to `true`, and
  `p.flipped && name` to `p.flipped || name`): the sequence test
  after them is what identifies the vector, and they differ only for a second part
  with the vector's reverse-complemented bases, which `gibson` refuses as
  ambiguous. L146 `flipped >= 0` to `> 0`: the first part is never flipped
  (`gibson` fixes its orientation). L328 `vectorIndex !== null` to `true`: `null ===
0` and `null === last` are false. L294 `closing === 0` to `false`: it adds a
  blocked stretch of no length at the end, and on a circle a window across the
  origin already touches the closing junction.
- **A part's end that nothing reads (8, `yeastAssembly.ts`).** `layout` L160
  (`?.`, `?? 0` to `&& 0`, `length - 1` to `+ 1`), L165 (`i === 0`, the `?.`) and
  L166 (the sign, `i === last`, `last` to `+ 1`): they move the end of the last
  part, or `from` where it is 0 anyway, and `partAt` is asked only about positions
  inside the product.
- **Loop bounds past the text (7, `directRepeats`).** L409 (`p < n` to `true` or
  `<=`, `||`, `p + k <= reach.length` to `true`, `p - k`): a window past the end
  is shorter than `k`, so it is the text of no other window and pairs with
  nothing. L403 (`slice(0, k - 1)` to the whole text, or `k + 1`): only windows
  with `p < n` are read, and they need at most `k - 1` more bases.
- **Redundant wrap tests (4, `directRepeats`).** L406 `circular && p < s.end + n`
  to `true` or to `circular || p < s.end + n`, and `p < s.end + n` to `true` or `<=`: on a line `p + k > s.start + n`
  is never true, and `p < n <= s.end + n` always on a circle.
- **A list that already excludes the cell (1).** L419 `list.slice(i + 1)` to
  `list`: `q - a >= k` skips the cell itself and every earlier one.
- **A tie-break never reached (1).** L436 `x.b - y.b`: no two repeats start on the
  same base, since each base pairs with one later copy.

By file: `yeastAssembly.ts` 44, `overlapAssembly.ts` 6 (L113 two, L134, L186
two, L188), `gibson.ts` 6, `overlapPrimers.ts` 1, `protocol.ts` 1.

**Not reachable by the real assembler, tested with a mock.** The checks of
`overlapAssembly.ts` after the assembly (L193-213) look unreachable: 400 random
designs of two to four inserts from the vector or another template, either strand,
three splits and two kits never failed them, and every circle was the asked-for
order in the vector's own orientation. They are guards, so the mocked tests
above pin them rather than list them here.

### `assembly/pairing.ts` joins the set (#417)

`pairing.ts` (mate-name parsing, orientation, insert tolerance, verdicts) is in
`mutate` beside `overlapBound.ts`, `assemble.ts` and `consensus.ts`. It has no
imports and no top-level side effects, so the dry run is unaffected, and as a new
file in the set it is mutated whole on its first run. Its survivors are untriaged
until the 1.24.0 pre-release `npm run mutate:changed`.

## At 1.24.0

The pre-release `mutate:changed` left 43 survivors and uncovered mutants on
lines changed since 1.23.0: `assemble.ts` 9, `pairing.ts` 6, `protocolText.ts` 28. Tests were written for the ones a test could see, and each equivalent one
was applied by hand to confirm it. No production code was changed and no
`Stryker disable` comment added.

- **Tested.** `protocolText.ts` (about 24): the batch protocol's exact text
  for one construct (the singular "construct" and "oligo", the caveats, the
  empty `without` default, the empty-oligos sentence, the blank lines after
  headings). `pairing.ts`: the trim in `pairingName`, and the stem of an
  Illumina name with no chunk number (`a_R1` is `a`, not `a_undefined`).
  `assemble.ts`: a copy of a repeat on the far side of the second-best copy
  (the left piece pushed back onto `todo` in `alternativePlacements`), which
  only matters when the best copy in a stretch is not the nearest one.
- **Equivalent, `assemble.ts`.** `mate === undefined` to `false` (`extentOf`
  of an unplaced read is null anyway); `at === null ? 1 : MAX_ALTERNATIVES` to
  `false` (the limit only changes how many places are returned, and without a
  mate only whether there are any is read); `only === p.pick ? p : {...p, pick:
only}` to `false` (the same read and pick either way).
- **Redundant guards, `assemble.ts` (5).** `out.length < limit` to `true` or
  `<=`, `aligned < MAX_STRETCHES` to `true` or `<=`, and `aligned++` to
  `aligned--`. The limit and the stretch cap stop the loop at the same place
  for a repeat of twelve copies (nine settle, the tenth does not), so removing
  either alone changes nothing; only a stretch that aligns many times without
  finding a place would tell them apart, and none was built.
- **Equivalent, `pairing.ts`.** `family: 'illumina'` to `''` (the family only
  keys the group, and no other family is `''`); the `?? ''` fallbacks on a
  capture group that always matched (`illumina[1]`, and the `''` in
  `description ?? ''`, where any non-matching string reads the same).
- **Equivalent, `protocolText.ts`.** `toUpperCase` to `toLowerCase` in
  `mergeOligos` (the key is only compared with itself); a stray string in the
  `reactionBlocks` list (`markdownOf` and `htmlOf` switch on `b.t` and drop a
  block that is not one). The blank line after an h4 heading was the one
  survivor of the rerun that a test could see, and got one.
- **Tested, `criteria.ts` (7, #428).** The panel text of the settings no test
  reached: the `≤ … °C` of ΔTm and Hairpin Tm, the product range in bp, the
  base run, the 3′ dimer length, and the off-default words of the two toggles
  (`not required`, `refused`). All were `NoCoverage` string literals and each
  is now read by exact text; none was equivalent. The confirming rerun left
  none of them.

## At 1.25: `alignment/banded.ts` (#432's prerequisite pass)

`banded.ts` had never been mutated in full on the workstation (the first run
that included it, 2026-11-03, left it at **44.16%**: 237 killed, 20 timed out,
302 survived, 23 uncovered of 584). Its suite compared banded scores with the
full fill, which a band a few cells too wide or too narrow passes.

- **Tests:** `bandedEdges.test.ts` (100 tests, about 1.5 s plain) names what the
  whole-alignment suite cannot see: the anchors and the word index, the chain
  and its strays, the turns folded back, `flankScoring`, `gapBound`, `boundBand`,
  and the exact `lo`/`hi` rows of `bandAround` and the `filled` counts of
  `alignBanded`. It killed about 260 of the 325 survivors and uncovered mutants
  (each survivor applied by hand against that file).
- **Code change, reviewed:** the guard "consecutive rows meet" in `bandAround`
  was removed. It never fired, on any chain of up to three anchors over a grid
  of matrix sizes and four scorings (about 100,000 bands), on 400,000 random
  rising bands, on 300,000 chains that fall behind in the reference as a fold
  can leave them, or in the whole suite with the guard turned into a throw.
  `bandedEdges.test.ts` now pins what it enforced (`lo` never falls, never
  passes `hi` of the row before by more than one, `hi >= lo`) for rising and
  folded chains in both modes, and fails when a monotone pass is removed. This
  took out 9 mutants (6 survivors, 3 uncovered) that no test could kill.
  The change got a `/code-review`; its one objection of substance, that nothing
  enforced the invariant any more, is the test above.
- **Disables (9 lines):** `// Stryker disable next-line`, each only where every
  mutant of that mutator on the line was applied and found equivalent: `?.` and
  `?? -1` fallbacks on values that are there (the chain reconstruction, rows of
  `bandAround`), `Math.abs` of a default whose sign does not matter, and the
  `cover` guard, whose rows outside the matrix a typed array drops anyway.
- **Equivalent survivors left (about 55), by kind:** fallbacks on always-defined
  values; the sign of the word hash (`kmer * 4 - bits` is the exact negative on
  both sequences); the cap on a word's occurrences (a longer list is skipped by
  `anchors` anyway); flank windows whose rows the monotone passes fill the same;
  a global region that is never trimmed (`regionScore`, argued from
  `gapBound >= |n - m|`); the `wrap` guards, where `turns >= 0` adds nothing.
- **Result (2026-11-09, one-file run, `npm run mutate -- --mutate src/core/alignment/banded.ts`):**
  **91.34%**, 486 killed, 20 timed out, 48 survived, none uncovered, 12 mutants
  ignored by the disables. Counted as survivors the 12 would put it at about
  89.4%, so about two points of the figure are the disables. Between the first
  confirming run (89.82%, with the guard) and this one, the guard's removal
  accounts for the rest. The summary file is for the release run; the 1.25
  pre-release `mutate:changed` picks the file up and writes the project figure.

## At 1.25: `assembly/pairing.ts`

`pairing.ts` stood at **80.45%** after the 1.24 pass (251 killed, 54 survived,
7 uncovered of 312, from the report of the 2026-11-09 full run). Most
survivors were things a test with one or two items cannot see.

- **Tests:** `pairingEdges.test.ts` (21 tests, about 20 ms plain): the stems
  and families of the name patterns (the Illumina header's read number is in the
  family of numbers, so `NAME 1:N:0:ACGT` and `NAME_2` are mates and a series
  past 2 spoils them; a two-digit number is a number; the name is trimmed), the
  group conditions at their edges (one forward and two reverse reads; a
  complete pair whose stem is also a series), `judgePair` on placements a
  contig does not fit (the distance round the ends of nothing or less), a pair
  with only its first mate missing, the median of an odd and an even number of
  gaps from unsorted input and its rounding, the order of the links on each of
  its three keys, the templates, which only consistent pairs enter, and their
  order. The run below killed 35 of the 61 undetected mutants; the
  survivors of the groups above were each applied by hand and failed the new file.
- **Disables (8 lines):** `// Stryker disable next-line`, each only where every
  mutant of that mutator on the line was applied and the whole pairing suite
  passed: the `?? ''` fallbacks on a capture group, a description and a name
  that are there (`pairingName`, the CASAVA stem, the mate token, the names of
  an ambiguous stem); the `'illumina'` family name (no other family is `''`, so
  the key is as distinct); `?.` on `contigs[x.contig]`, an index that came from
  the same array (3 lines).
- **Equivalent survivors left (18), by kind:**
  - _Fallbacks_ (4, uncovered): `?? ''` on the Illumina stem group and the
    mate stem, and on the stem split from a group key (twice; the key has a
    separator by construction). Their lines also carry killable mutants of the
    same mutator, so they are not disabled.
  - _Dead sort of the pairs_ (4): `findReadPairs` collects groups in a Map, in
    the order of the lowest read index of each, and a pair's two reads are the
    whole group, so `pairs` is sorted by its lower index before `.sort` runs.
    Turning the comparator into `+`, `undefined`, or `max` for one side gives a
    comparator that is positive for every later-against-earlier call, which V8
    takes as already in order, and dropping the sort changes nothing. Applied
    by hand against the three pairing test files. Flagged for review, not
    removed: the sort is documentation of the order the report promises.
  - _Unreachable by the grammar_ (8): `mate === null` after the token is
    matched (every letter token of both patterns is in the forward or reverse
    set, every other token is a number, so it is never null); `^\d+$` without
    one anchor (the token is a whole alternative, never digits and letters
    mixed); `'letters'` to `''` (no other group has the family `''`);
    `first !== undefined` and `second !== undefined` to `true` (the length
    checks before them already say there is one); `template <= insert` (a
    distance equal to the insert is within the tolerance, so it never reaches
    the comparison); `j.template !== null` after `consistent` (a consistent
    verdict always has a distance).
  - _Equivalent by symmetry_ (2): `from.contig >= to.contig` (the two contigs
    of a link differ, or it would be a pair judged in one contig), and
    `toLowerCase` to `toUpperCase` in the group key (only a letter whose upper
    and lower case do not fold alike, such as `ß`, would tell them apart).
- **Result (2026-11-09, one-file run, `npm run mutate -- --mutate
src/core/assembly/pairing.ts`, incremental):** **94.08%**, 286 killed, 0
  timed out, 14 survived, 4 uncovered, 8 mutants ignored by the new disables
  (the 61 ignored before are in neither count). Counted as survivors the 8 would
  put it at **91.67%** (286 of 312). The summary file is for the release run.

## At 1.25: `alignment/msa.ts`

`msa.ts` stood at **61.27%** in the report of the 1.24.0 run (607 killed, 48
timed out, 403 survived, 11 uncovered of 1,069). The report was stale for the
file: the run was incremental, and a survivor recorded before the 1.22 tests
(`msa.test.ts`, `msaBand.test.ts`) stayed a survivor. Each of the 414 was applied
by hand against `msa.test.ts` and `msaBand.test.ts` as they are: 279 failed
them, so 135 were real survivors, and the file stood at about 87% before any
new test.

- **Tests:** `msaEdges.test.ts` (25 tests, about 1 s plain) pins what those suites
  reach only through whole alignments: `kmerLength` at 29/30, 39/40 and 199/200,
  the whole `kmerDistances` matrix (diagonal included) and its first and last
  windows, the tie rule, heights and the weighted means of `upgma` on four and
  five leaves, `treeWeights` on a hand-built tree whose total is exactly 1e-12
  (`<=` against `<`), the matrix of `identityDistances` and a pair with no
  shared letter, the residue defaults of `gapOpen` and `gapExtend` on a set where
  -10 and -0.5 give other rows, the ambiguity-code scores (`iupac` true), rows
  cleaned of anything but letters, two sequences (which are not refined), the
  progress values of each stage, a set whose refinement still gains in its third
  pass (a fourth would run with `<=`), and a join whose first band is 25,370 of
  50,850 cells, which is within a row of the half that sends it to the full
  fill (`n - 1`, `m - 1`). It killed 30 of the 135 when each was applied by hand.
- **Disables (24 lines, 30 mutants):** `// Stryker disable next-line`, each only
  where every mutant of that mutator on the line is a survivor that was applied
  by hand and is equivalent: `?.` on values that are there (`sameCodes`, rows of
  `dist`, `rows[0]`), `i - k <= length` (a window past the end is spoilt by the
  `radix` it reads), `&&` for `||` on a tree node (both children or neither),
  the guard on `counts`, the no-window test of `kmerDistances`, the two ends
  of the traceback, `sums` one entry short, the climb from the other end in
  `reachable` (`Math.min`/`Math.max` of 0 and `shift`), an array whose every
  index is then assigned (`ops.length`, the rows of a join and of a candidate)
  and the `'-'` of `keep`, whose columns are never all gaps.
- **Equivalent or untestable survivors left (76: 73 survived, 3 uncovered), by kind:**
  - _A loop one past the end (22):_ `<=` on a typed array or a row, which reads
    `undefined` and falls back with `?? 0` or `?? NEG`, or writes past the end
    and is dropped (L94, 128, 137, 180, 181, 276, 332, 333, 343, 531, 579, 580,
    588, 590, 595, 597, 610, 640, 853, 875, 917), and the zero `lo` of
    `wholeMatrix` (`n - 1`, L360). Their lines also carry a killed `>=`, so
    they are not disabled.
  - _A guard on a value that is always there, or one covered by another (14):_
    `ca`/`cb` defined (L136), the no-window test (L143), the leaf test of a node
    with both children or none (L222, 237, 805, 896, `false` for one operand),
    `rest.length === 0` (the two halves of the root's children are never empty,
    L913).
  - _The same value (10):_ `f !== 0` to `true` (L337, 599: a term of 0), `prevM[j - 1] && NEG`
    and `prevM[0] && NEG` (L392, 405: 0 or `NEG`), the sign of the word hash
    (L538), a list past the cap (L546), the best of a column against the best of
    the other profile (L588 `&& 0`), and `rows.some(...)` to `true` and its
    relatives (L919: no all-gap column).
  - _The ends of the traceback (2):_ L476, 482, `i === 0` and `j === 0` to
    `false`: the edge entries written by the fill push the same step.
  - _Far diagonals, slack, float ties (9):_ `high <= n`, `low >= -m` and the loop tests
    (L625, 628: `fits` is false past the end either way), the three mutants of
    `slack` and `>=` for `>` (L615, 621: the slack only absorbs rounding where
    the bound equals the score), and `next >= score + 1e-9` (L946).
  - _The refinement budget (17):_ `REFINE_CELLS` is 300 million filled cells
    and a join counts what it fills, so `firstCells > budget`, `guess.cells +
regionCells > budget`, `cells + full > budget`, `REFINE_CELLS - spent`,
    `out === null` and `spent += out.cells` differ only once the refinement has
    filled most of that. Several full fills of 12 kb sequences is a minute a
    test, and the budget is a constant of the module. The block for
    `regionCells >= full` (L677, 678, 3 uncovered) is unreachable without it
    (every diagonal from `-m` to `n` would be needed, see 1.22). Not disabled:
    they are not equivalent, only out of reach of a unit test.
  - _Hairline (1):_ `2 * firstCells >= full` (L672) needs the two to be equal;
    nothing in 5,000 pairs of 200 to 360 bases came closer than 2 cells.
  - _A `catch` that continues (1, uncovered):_ L934, a refinement join that is
    more than `maxCells` when no progressive join was.
  - Four mutants (`i - 1` at L181, `k === bi` and `true` at L201, `i--` at
    L343) end the worker, and are counted as errors, not as survivors.
- **Running it.** The full suites of `msa.test.ts` and `msaBand.test.ts` could not
  be run instrumented as they stood: one of each took over its explicit 60 s
  in the dry run (3.9 s and 0.9 s plain, about 70 times slower), which is why `msa.ts`
  had only been mutated through changed lines. Two changes, both to tests:
  `msaBand.test.ts` takes the `SLOW` timeout of the other slow suites (600 s
  under `PLASMIDPOP_MUTATION`), and the eight "joins along a band" tests of
  `msa.test.ts` are skipped in a mutation run (`describe.skipIf`), as the
  heavy alignment suites are in `MUTATION_SKIP`: `msaBand.test.ts` pins the same
  joins in cells and rows, and all 135 survivors were applied against them by
  hand. The run lists the files that can reach `msa.ts` in
  `PLASMIDPOP_MUTATION_TESTS` (the dry run is then minutes, not the hour of all
  8,226 tests) and takes `--force`, so no stale result is reused.
- **Result (2026-11-09, `PLASMIDPOP_MUTATION_TESTS=... npm run mutate --
--mutate src/core/alignment/msa.ts --dryRunTimeoutMinutes 45 --force`, 161
  minutes):** **92.82%**, 938 killed, 44 timed out, 73 survived, 3 uncovered,
  4 runtime errors, 32 mutants ignored (2 from before, 30 from the new disables).
  Counted as survivors the 30 would put it at **90.26%** (982 of 1,088). The
  summary file is for the release run.

### `children()` in `msa.ts`, measured

The four inline leaf tests (`node.left === null || node.right === null`, each
with a disable on its `&&`) became one `children(node)` helper that returns the
pair or `null`, keeping the narrowing a boolean `isLeaf` would lose. They had
cost 12 mutants (4 disabled, 8 surviving). Measured by `npm run mutate:changed`
against `v1.24.0` (3 files, 24 mutants on the changed lines, 9 minutes): the
helper line has 2 survivors, the `||` operands replaced by `false`, equivalent
for the same reason (a node has both children or neither) and not disabled,
since the other conditional mutants on that line are killed. `msa.ts` is at
**93.30%** (930 killed, 44 timed out, 67 survived, 3 uncovered, 29 ignored);
counting the 27 new disables as survivors, **90.94%**. The same run puts
`pairing.ts` at 94.08% and `banded.ts` at 91.34%, and the project at 94.66%.

## At 1.25: `alignment/pairwise.ts` and `quality.ts`

Their only figures were from 2026-11-02, on another machine: `pairwise.ts` at
71.3% with 131 survivors, `quality.ts` at 78.9% with 24. Neither file had an
entry in the incremental file. Both were measured here with `--force` (no
stale result reused), after the 1.23 tests of #399 that the old figures
predate.

### `quality.ts`: already above the floor, not touched

`PLASMIDPOP_MUTATION_TESTS=<the 370 files that reach it> npm run mutate --
--mutate src/core/alignment/quality.ts --dryRunTimeoutMinutes 45 --force
--reporters clear-text,progress,json` (dry run 8 min, whole run 9 min):
**97.37%**, 108 killed, 3 timed out, 3 survived, 0 uncovered, 2 ignored (static
`[]` of the two choice lists). No disables were needed, so the figure counted
the other way is the same. The 3 survivors are the ones #399 classed
equivalent: `typeof v === 'number'` to `true` in `isConfidentQuality` and
`isTrimCutoff` (L27, L39: `includes` of a list of numbers is false for
anything else), and `c < alignment.columns` to `<=` in `readDifferences` (L142:
`charAt` past the end is `''`, no difference). Its 24 old survivors were the
stale ones of the same kind as `msa.ts`'s. No tests were added.

### `pairwise.ts`

**Running it.** The 375 test files that can reach it by their imports (the 13
of `MUTATION_SKIP` already left out) did not make a run: the dry run took 76 min
(the 45 min of the command are not enough; it was run with 180), and the
mutation phase then tested 71 of 485 mutants in 44 min, a survivor costing a
pass over every covering test instrumented. That run was stopped. Which files
run the fill at all was then measured on each file alone with v8 coverage
(46 of the 375 do, and three more failed that run; the rest only import the module), and the run was split:

- **In the Stryker run (34 files):** every one of the 46 but 12 of those below,
  the six direct suites among them (`pairwise`, `pairwiseBand`, `pairwiseLimits`,
  `protein`, `quality`, `bandedEdges`) and the `alignmentX` and `readBatch` suites
  of the app. Dry run 2 min, whole run 19 min.
- **Left out of the Stryker run, for time (15 files):** `app/compare`,
  `AlignPanel`, `AssemblyResult`, `DetectFeatures`, `YeastTutorial`,
  `app/shortcuts`, `annotate/detect`, `assembly/assemble`, `overlapBound`,
  `pairing.assemble`, `diff/documentDiff.readings`, `oracle/plannotate`,
  `CloneCheckPage`, `PrimerCandidates` and `workers/analysisClient` (the last
  three failed the coverage run and are kept in the list in case they reach it,
  so that 12 of the 15 are known to run the fill).
  Plain, they take 32 s together. **Every survivor was applied by hand against
  these 15 (plain, `timeout 120`) as well as against the 34**, so what is
  reported below is not weakened by their absence from the run.
- **Left out by `MUTATION_SKIP`:** the Sanger assembly and alignment oracles, the
  `banded`, `strands`, `readAlignment` and `alignmentOrigin` suites and the two
  property suites listed there. `itTimed` also drops its time assertions in a
  mutation run (`TIMING_ASSERTED`); five tests of the 34 are skipped then.

**Before (2026-11-09, `--force`, the 34 files):** 422 killed, 12 timed out,
51 survived, 0 uncovered, 2 ignored (static): **89.48%**. Applied by hand
against the files as they stood, 4 of the 51 failed an existing test, so the
file already stood at about **90.3%** (438 of 485):

- L330 `onProgress !== undefined` to `true`: killed by `aligns two 3 kb
sequences quickly`, a timing test, which a mutation run does not assert.
- L243 `Math.min(firstEncoded.length, 2)` to `Math.max`: fails 14 tests of
  `pairwise.test.ts` and 93 tests of the 34 files by hand (it leaves a hole in the cache
  after the first call, and the next call reads `undefined.a`). The run saw it
  survive, most likely because its worker had called the module already and the
  cache was two entries long.
- L318 `prevM[lo0 - 1]` to `lo0 + 1`: fails `seeds the first row with a leading
gap when the band starts right of column 0`, also under `PLASMIDPOP_MUTATION=1`.
  Stryker's coverage did not list that test for the mutant. Unexplained.
- L430 `(prevX[m] ?? NEG) > best` to `>=`: only the 15 files kill it (a tie of
  the diagonal and a gap at the corner: 9,756 of the 231,200 cases of two `ACGT` words of 1 to 4
  bases in either mode under the default options; `AA` against `A` puts the gap
  in front).

**Tests:** `pairwiseEdges.test.ts` (12 tests, about 0.2 s plain). Each of these
survived or was invisible to the run and fails the file when applied by hand:

- the tie at the corner, `AA` against `A`, `A` against `AA`, `AA` against `C`
  (L430 `>` to `>=`: the diagonal wins over a gap that ends the alignment);
- the cache of the first sequence told apart by alphabet: the same letters as
  bases and then as residues, and the other way round (L234 `e.protein ===
protein` to `true` and to `!==`);
- a 1,500 by 1,500 fill scored with no callback, and with one, told once at
  row 1,332 (L330, in a test that is asserted in a mutation run);
- a band whose trace leaves it on the right, as the 1.23 test did on the left
  (L458 `j > rowHi`);
- a local band that starts right of column 0 starting a match in a column other
  than its first (L318, in a test Stryker sees);
- a mismatch counted as neither identical nor ambiguous (L500 `mark === ':'` to
  `true`: the 1.23 tests count ambiguity codes but never a plain mismatch
  next to them) and a match through `N` as ambiguous only.

**Disables (15 lines, 23 mutants):** `// Stryker disable next-line <Mutators>`,
each only where every mutant of that mutator on the line is a survivor that
was applied by hand against all 49 files and also fuzzed (8,000 random pairs,
bands, options, both alphabets, against a copy that differs only in that mutant:
the output, with errors, is the same) and is equivalent. The reasons are in
the comments: the `'limit'` and `'global'` defaults that are only compared
(L96, L255), `maxCells ?? DEFAULT_MAX_CELLS` and the throw after it, which
`fillBand` repeats with the same error (L169, L171 `CallExpression`), a cache
that never finds its entry or never keeps it (L234 `ArrowFunction`, L235,
L242), `mismatch` as a fallback that is never read (L258, three mutators), (0, 0)
and column 0 of the traceback bytes (L305, L309, L354), and the sentinel written
twice (L317, 319, 336, 338: `BlockStatement`, `ArithmeticOperator`,
`LogicalOperator`, and the conditionals of L317, whose two mutants are both
equivalent). Where a line also carries a killed mutant of the same mutator the
line is not disabled.

**Result (2026-11-09, `PLASMIDPOP_MUTATION_TESTS=<the 35 files> npm run mutate
-- --mutate src/core/alignment/pairwise.ts --dryRunTimeoutMinutes 45`, incremental, 10
min):** **95.67%**: 430 killed, 12 timed out, 20 survived, 0 uncovered, 25
ignored (2 static, 23 new disables). Counted as survivors the 23 would put it at
**91.13%** (442 of 485). The summary file is for the release run. The 8 new
kills are the 7 above and L243, which the run now sees killed.

**Equivalent survivors left (20), and the timeouts, by kind:**

- _A check done twice (1):_ L174 `cells > maxCells` to `false`
  (`alignPairwise` checks the whole matrix, `fillBand` the same cells with the
  same options and message). Its `true` is killed, so the line is not disabled.
- _Cache hit or miss (3):_ L238 (`e.a === a && e.protein === protein` to
  `false`), L240 `at < 0` to `true` and to `<= 0`: a miss encodes again to the same
  codes.
- _`keep` where nothing is kept (3):_ L324, L373, L426, `if (keep)` to `true`
  writes past a zero-length `Uint8Array`, which is dropped.
- _A byte the traceback never reads (2):_ L324 `j === 1` and L373 `i === 1`
  to `false`: the state it picks ends at the edge, where the loop stops.
- _A sentinel written twice, or past a typed array (7):_ L352 (four mutants:
  `false`, `rowLo > 0` to `true`, `>=`, `<=`) and L362 (`true`, `>=`): the cell
  left of the row above's band has been written `NEG` as `cur` of the row before,
  and index -1 is dropped.
- _Column 0 is not a path (1):_ L369 `rowLo === 0` to `false`: the recurrence
  gives the same values at column 0 (see #399).
- _Guards the traceback never meets (4):_ L478 (`i === 0` and `j === 0` in the
  `M` branch), L485 `i === 0` in `X`, L491 `j === 0` in `Y`.
- _Timeouts (12, counted as detected):_ `i--`, `j--`, `k--` and `k > rowHi` in
  the loops of the fill and of `bandCells` and the match line, and the traceback's
  loop and branches emptied; every one hit the limit.

No survivor is unclassified: all 20 were applied by hand against the 49 files
(plain) and fuzzed, and none changes a result or an
error message.

## Stale survivors, and `--remeasure`

Stryker's incremental report keeps a mutant's verdict while its lines stand.
A mutant outside the run's `--mutate` set is therefore never given to a test
written after the report, and a pass that mutates only changed lines leaves
the old survivors of every other line as they were. The 1.24.0 report put
`msa.ts` at 61% for this reason; its own tests had killed most of those
mutants since, and a forced run measured it at about 87%.

`npm run mutate:changed` now says so. It compares the test sources stored in
the report (`testFiles`) with the current ones and, for each file of the
`mutate` list with a Survived or NoCoverage mutant, names the files that have a
test one or two imports away that is new or different (`staleSurvivors` in
`scripts/mutationTools.mjs`). It looks only that far because a test reaches a
file through a hub that most of the project shares, and a changed test there
would flag every file; the `*.timing.test.ts` files and the skipped suites are
left out, since they assert nothing in a mutation run. A file named is a
reason to look, not a verdict: a test that imports a file need not exercise
the changed line.

`--remeasure <file>` (repeatable) is the remedy: that file is mutated whole and
the run passes `--force`, so every one of its mutants is run again against the
tests as they are now. It costs a run of that file, so name the files that
matter (the most open first, as the warning lists them) rather than all.
At the time of writing the report is current, since every file this pass
touched was confirmed by its own run, and the check finds nothing in the
list.
