# 142. A Validation page, generated from what is committed

Issue #362, 2026-11-08. The project is oracle-tested (items 37, 121-125) and
mutation-tested (item 50), and none of it was visible to a user. The guide now
has a page, `docs/guide/18-validation.md`, that says per feature area which
independent oracle was used and at which version, what is compared, how many
cases there are and where they are, what is known to differ, and the latest
mutation score with its date and release.

## Nothing numeric is typed by hand

- **Case counts** are the length of an array (or the number of keys of an
  object) in a committed `src/test/oracle/*.json`. `docs/validation/oracle-areas.json`
  names the file and a path per count (`cases.*.guides` adds up what is under
  every case); `countAt` throws on a path that ends at anything else, so a typo
  cannot become a count of zero.
- **Versions** come from `scripts/oracle/requirements.txt` where the oracle is
  pinned there (Biopython, pydna, primer3-py), and from the stamp the generator
  wrote into the JSON where it is not (seguid, MAFFT, pLannotate). Where both
  exist they must agree: the test fails on a JSON stamped with another version
  than the pin. NCBI's own records, and the known construct of the Sanger
  oracle, have no version and the page says no version.
- **The mutation score** is read from `docs/validation/mutation-summary.json`.
  Stryker's report (`reports/mutation/`) is gitignored and is 35 MB, so it
  cannot be what the build reads. `npm run mutate:summary` condenses it into
  that file (score as Stryker defines it, counts per status, per file, the
  files of `stryker.config.json` that the report has no result for, the date
  of the report, the package version and Stryker's) and the file is committed
  with the release. It reads the report and never starts Stryker. A summary
  with `score: null` makes the page say "Not yet recorded".

The first summary was made from the report left by the pre-release run for
1.23.0 (changes since v1.22.0, 2026-11-07): 92.25 over 89 files. Three files
of the configured list have no result in it (`assembly/pairing.ts`,
`alignment/pairwise.ts`, `alignment/quality.ts`), and the page names them.

## How it gets into the build

`scripts/validationTools.mjs` is plain Node with no dependency, pure except
`readValidationInput`, so `src/test/scripts/validationTools.test.ts` runs it on
a small fixture. `vite.config.ts` calls `validationMarkdown(root)` twice, the
way `__APP_VERSION__` is defined: once for `define: { __VALIDATION_TABLES__ }`,
which `src/app/help/guide.ts` puts in place of the page's marker line
(`<!-- validation-tables -->`), and once inside the static-guide plugin, which
does the same for the crawlable pages at `/guide/` (and for the dev server, on
every request). The oracle JSON (several MB) is read at build time and never
reaches the app's bundle; the tables are about 23 KB of Markdown. On GitHub the
page shows its prose and an invisible marker, and points at `docs/validation/`.

## What the test guards

- Every `.json`, `.gbk` and `.ts` under `src/test/oracle` must belong to an
  area of `oracle-areas.json` (or be listed as support there); a new oracle
  fails the build until it has an entry. Every listed data file must exist and
  be mentioned by one of its area's tests.
- Every known difference names an area that exists.
- The page the app shows contains every area's heading, every count as the data
  gives it, and every difference, and no marker.
- A recorded score must equal what its own counts give, and the per-file
  counts must add up to the totals.

## Known differences

`docs/validation/deviations.json` lists what the tests tolerate, each in its
exact shape (`KNOWN DIFFERENCE` in the oracle tests, `docs/audit.md`'s
conventions, items 121-125). Each entry has a `where`. Its `issue` is a number
only where an issue tracks it. None does: every difference is by design, a
convention, a limit of the oracle, or a place where the oracle is the one in
error (peaks above 32,767 in ABIF), and every issue that once tracked a
difference is closed. The page says "none" in that column rather than
inventing a link. The comments of some oracle tests still say a case is "left
out" for an issue that is closed (#162, #167, #175, #182); those are not
listed, since the tests cannot tell whether the case was added after the fix.

## Not done

- The Validation page is not in `stryker.config.json`'s mutate list;
  `validationTools.mjs` is covered by ordinary tests only.
- The hand-run checks (`oracle:writer`, `oracle:snapgene-writer`, `oracle:snapgene`,
  `oracle:abif`) commit no result, so the page lists the writers as an area with
  no count and says so; the SnapGene sample files and local AB1 files, which may
  not be redistributed, are mentioned without a number.
- The areas are listed in the registry by hand. A count cannot be wrong, but a
  description of what is compared can go out of date; it is the test files'
  header comments, copied, and is reviewed with them.
