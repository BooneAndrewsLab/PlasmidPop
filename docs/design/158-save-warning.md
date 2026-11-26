# 158. Save warns which features cannot be written as read

Issue #464. The 2026-11-25 corpus run found two GenBank cases where a save
silently changes the data (item 66 names the first):

1. A trans-spliced `join(complement(a..b),c..d)` opens with the warning
   "mixed-strand location ... treated as forward strand", and the writer then
   writes the forward-strand join.
2. A remote `ACCESSION:1..10` location makes the whole feature skipped at
   open, so it is not written back.

Decision (maintainer, 2026-11-26): the cheap version. Say so on Save. Keeping
the original location text, so that the round trip is lossless, is #466 and
is not part of this.

## What was built

- The information already existed as parser warnings, so no new document
  state. `ParseWarning` gained an optional `inexact` (`InexactFeature`: kind
  `mixed-strand` or `skipped-location`, feature type, name, count), set by
  `buildFeatures` in `parseGenBank.ts` for the mixed-strand warning (now the
  exported `MIXED_STRAND_WARNING` constant in `location.ts`, so it is not
  matched by prose) and for each skipped feature. The skipped features past
  the five listed carry one summary entry with a count and no name. Types and
  names only; no sequence or location text.
- `src/app/inexactFeatures.ts` collects them from a tab's warnings and builds
  the sentence: names up to five features, then "and N more".
- `PersistenceService.write` (Download GenBank, both the download and the
  file-picker path) calls `editorStore.noteInexactSave` after a successful
  write; `InexactNotice` shows it, next to the read notice, for 20 s or until
  Dismiss. Each save restarts it, so it is said once per save. Cancelling the
  picker says nothing. SnapGene, FASTA, FASTQ, protein FASTA and "export
  selection" do not go through it.
- No analytics event was added.

## Limits, on purpose

- It reports what was read at open. Deleting a trans-spliced feature in the
  editor does not take it off the list, and a document restored from storage
  after a reload no longer has its parse warnings, so says nothing.
- A multi-record file's later records are not opened, but their warnings are
  in the same list and can be counted.
- Only these two cases. Other locations the parser changes (a fuzzy `<5..10`
  read as `5..10`, nested `complement()`) are not flagged.
