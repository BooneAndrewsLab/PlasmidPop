# 116. React `act(...)` warnings in the tests

Issue #324. The CI log of the 1.19.0 release commit was 36,848 lines, 3,470
of them "An update to X inside a test was not wrapped in act(...)" warnings
with a component stack each, enough to hide a real failure.

## Cause

Not many tests, and not many places. A stack taken at the warning
(`console.error` patched to print `new Error().stack`) showed one source for
most of them: `EditorStore.applyAnalysis`. A scan's result arrives after the
synchronous test body that opened the document, the store notifies, and
every component that reads it (twelve or so, hence the repeats) re-renders
outside `act`. 1,704 of the warnings were in `App.test.tsx`, 746 in
`circularCaret.test.tsx`, 697 in `shortcuts.test.tsx`; five files made up
98 %. The same came from the custom enzyme sets, codon tables and standards
that `App` reads from storage on mount.

## What was done

- `src/test/setup.ts`, in DOM tests only, wraps the six store methods that
  such results arrive through (`setAnalysis`, `setCutSites`, `setOrfs`,
  `setCustomCodonTables`, `setCustomStandards`, `setEnzymeSetInfo`) in
  `act`. In the app there is no `act` and nothing changes; production code
  is untouched. 3,470 warnings became 63 and no test changed. Wrapping the
  store's single `commit` instead was tried and dropped: it broke 11
  `CrisprPanel` tests that commit while rendering and raised the count.
- Three tests that called a store method directly now do it inside `act`.
- **A budget per file.** `src/test/actWarningBudget.ts` lists the DOM test
  files that still print some, with a ceiling; a file not listed may print
  none, and `setup.ts` fails a file that goes over, so a new one cannot join
  the noise. What is left is the app's start-up restore
  (`usePersistence.ts`, `setOpening(false)` after the saved documents are
  read) and a few components' storage reads finishing while a synchronous
  test runs; their number differs by a few between runs, so each ceiling sits
  a little above what was seen, and is lowered when its file is fixed by
  awaiting what is pending.
- `scratchDocuments.test.ts` waited a fixed 20 ms for an autosave and failed
  once in the full run under load; it waits with `vi.waitFor` now.
