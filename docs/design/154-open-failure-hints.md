# 154. Open-failure hints: JSON-escaped text, a missing LOCUS, stray bases

Issue #465. Two correct failures from the 2026-11-25 corpus run said nothing
about the cause. The failure reasons are unchanged; only the message text
grew, in `src/io/failureHints.ts`.

## What was built

- **JSON-escaped records.** A record copied from a JSON string has the two
  characters `\` and `n` for each line break. `jsonEscapeHint` fires when the
  text is a single line holding `\n`, or when at least half of its non-blank
  lines end in `\n`. The second form is the real Teselagen `pj5_00028.gb`:
  every `\n` is followed by a real carriage return, so it is not one line at
  all and the first idea (no line breaks) missed it. `parseGenBank` and
  `parseFasta` check first and throw one message telling the user to copy the
  record as plain text. A real file that mentions `\n` once is not matched.
- **No LOCUS line.** The message keeps its old first sentence, then says what
  a record starts with, quotes the first non-blank line cut to 20 characters,
  and adds one cause only when the start shows it: a first character that is
  not printable ASCII (its code point), a `>` FASTA or `@` FASTQ header, an
  EMBL `ID` line, JSON, XML or HTML, `FEATURES`/`ORIGIN` without `LOCUS`, or
  `LOCUS` somewhere other than the start of a line. A lowercase or indented
  `locus` is accepted since #461, so no case hint is needed.
- **Stray bases.** Gaps (`-`) and digits are removed before the alphabet
  check, so only `*` ("a stop codon, so this may be a protein") and `.` ("a
  gap or missing base in some programs; remove it or write N") get a hint,
  and a backslash that sits before an `n` gets the JSON hint. Every other
  character is listed as before, with no guess. The GenBank and FASTA parsers
  use it; the editor's paste path (`alphabet.ts`) is untouched.

## Privacy

The quoted line start appears in the banner only. The `open-failed` event is
named `<format>:<reason>` from fixed lists (`openFailedName` in
`analytics.ts`); no message text reaches the tracker.
