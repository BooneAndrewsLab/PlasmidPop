# 153. Malformed GenBank layouts are read or reported, never dropped

Issue #461. Found by the 2026-11-25 GenBank corpus run (synthetic files and
Teselagen `breakingGenbank.gb`). Four layouts opened without a word although
features or the sequence were lost.

## What went wrong

1. A tab-indented feature key was not a key (`FEATURE_KEY` wants five
   spaces), so its qualifiers were appended to the previous feature; tab
   indented continuation lines were skipped.
2. A record with only `LOCUS` at column 0 and everything else indented
   (Teselagen) matched neither `FEATURES` nor `ORIGIN`, so it opened as 0 bp,
   0 features, with only a length-mismatch warning. Fully indented, it threw
   "No LOCUS line found" although `detectFormat` had accepted it.
3. A lowercase or missing `FEATURES` line meant zero features, no warning.
4. A LOCUS-only or truncated record opened empty without a warning.

## What was built

All in `parseGenBank.ts`; the failure reasons are unchanged (these cases
warn, they do not fail). Every new warning starts with the section it is
about ("Feature table", "Sequence", "Feature table and sequence") because
#459 wants to say where the parser stopped; the line is on the warning.

- **Tab keys.** A line starting with tabs, a key and a location is a feature
  key when the text after the key starts like a location (digit, `<`, `>`,
  `(`, `complement(`, `join(`, `order(`, `Accession:`). Never inside an open
  quoted value, where it is value text. Tab-indented lines count as indented
  continuation.
- **Indented records.** `splitRecords` accepts an indented `LOCUS` only when
  it opens a record (a `LOCUS` word inside a record's text never splits it),
  and a lower-case one at column 0. `withoutRecordIndent` strips the indent
  of the least-indented keyword line (FEATURES, ORIGIN, CONTIG, DEFINITION,
  ...) from every line, but only when no line after LOCUS is at column 0, so
  a normal record is never touched and an indented `ORIGIN of ...` comment
  line cannot be mistaken for a section. Header keywords are matched in
  upper case so a feature key `source` is not one. An indented `//` ends a
  record only if that record has no column-0 lines of its own.
  Sequence lines (spaces then digits) are not keywords and are never
  inspected for this.
- **Case.** `FEATURES`, `ORIGIN`, `CONTIG`, `BASE COUNT` and `LOCUS` at column
  0 match case-insensitively. Header keywords such as `DEFINITION` stay
  upper case.
- **No FEATURES line.** Lines laid out as features (key and location at
  column 22) before ORIGIN with no FEATURES line are not parsed: one warning
  gives their count and first line, and the header stops before them so they
  are not swallowed into the last header field. Parsing them was considered;
  the issue asks for a warning, and a table with no header is a file worth a
  look.
- **Ignored lines in the table.** A line before the first feature, or at
  column 0 and laid out like a feature, is counted and reported once
  (`restriction_site3686..3705`, key too long for its column, found in
  two GitHub example files, was silently dropped before). Column-0 lines
  that are not feature-like (BASE COUNT, WGS, TLS) stay quiet.
- **Truncation.** No ORIGIN and no CONTIG warns: "Sequence: no ORIGIN line"
  when a FEATURES line or feature-like lines exist, "Feature table and
  sequence" when neither does, and a master record (`rc`) says it has no
  sequence rather than suggesting truncation. The old "LOCUS says N bp but
  the sequence has 0" warning is dropped for a record with no ORIGIN, as the
  new one says it. A record with a sequence and no FEATURES line warns of
  nothing.

## Not done

A feature key at another indent than five spaces in an otherwise normal
record, and a glued key such as `restriction_site3686..3705` after the first
feature (its line joins the previous qualifier's value), are not repaired.

## Corpus check

418 corpus files before and after: all records that parsed cleanly have the
same lengths and feature counts. Changed: Teselagen breakingGenbank.gb and
testing_primers*.gb now open with their features; `indented_all`,
`lowercase_locus` and `bom` now open; `lower_features_keyword` and the tab
file gain features; the truncated, master and `restriction_site` files gain
a warning.

## Tests

`genbank.test.ts` ("malformed layouts lose nothing silently").
