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
