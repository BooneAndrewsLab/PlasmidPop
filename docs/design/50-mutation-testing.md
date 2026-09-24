# 50. Mutation testing before a release

Done, 2026-09-24 (#77; `stryker.config.json`,
`scripts/patch-stryker-vitest.mjs`). Stryker mutates the modules added in
1.4 and runs, for each mutant, the tests that cover it, to find code the
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
