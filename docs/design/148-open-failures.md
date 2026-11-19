# 148. Why an open fails (#447)

Matomo showed `file / open-failed` 8 times from 4 of 18 ChatGPT-referred
visits (Oct 1 to Nov 17), with no format or reason (item 38: by design, no
file names or content). This item works out which inputs fail, says so in the
app, and adds a coarse reason to the event.

## Where an open can fail

`openFile`, and `importFiles` for several files or a ZIP, are the only places
that emit `open-failed`. Pasting (`openPastedText`) and the bundled examples
report an error but are not counted. The classes, from the code:

| Input                                                                                                                      | What happens                                                                 | Reason                |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------- |
| Extension `.geneious`                                                                                                      | refused up front                                                             | `unsupported`         |
| `File.arrayBuffer()` rejects                                                                                               | "Could not read"                                                             | `unreadable`          |
| 0 bytes, or only whitespace                                                                                                | was "No LOCUS line found" or "Unrecognised format"; now "The file is empty." | `empty`               |
| A NUL byte in the first 4000 bytes (PDF, Word, xlsx inside a renamed file, image, UTF-16 text), not SnapGene/ABIF/gzip/ZIP | was decoded as UTF-8 and failed as unrecognised or as a parse error          | `binary`              |
| Text that no sniff matches and whose extension is not a sequence one (`.csv`, `.docx` text, prose)                         | "Unrecognised sequence format", now with the accepted formats                | `unrecognised-format` |
| A `.txt`, `.fasta`, `.gb`, `.fastq` file whose content does not match (no `>`, no `LOCUS`, no `@`)                         | the by-extension parser's "must start with" error                            | `unrecognised-format` |
| Gzip that will not inflate; a gzip that is not read by the plain parser                                                    | "could not be decompressed"                                                  | `corrupt`             |
| A truncated AB1 or SnapGene file, a damaged ZIP                                                                            | the parser's own error                                                       | `corrupt`             |
| ZIP over the entry-count or total-size limits                                                                              | "too large to open"                                                          | `too-large`           |
| Any other parser complaint (bad FASTQ record, non-IUPAC bases in an AB1, no AB1 base calls, GenBank record errors)         | the parser's message                                                         | `parse-error`         |
| A non-`FormatError` exception                                                                                              | the message                                                                  | `other`               |

Not failures: a protein in FASTA, GenPept or `.prot` opens as a protein; a
multi-record file opens its first record with a warning; a bare-letter text
that is not a sequence run is "unrecognised"; a ZIP member that cannot be
read is listed in the import summary and is not counted as an event (the
summary is the report). A sequence's size has no limit in the open path
beyond the browser's memory, so `too-large` only arises for archives.

Likely causes for the visits that arrive with a file, in order of what the
code makes easy: a PDF, spreadsheet or Word file or an image (`binary` or
`unrecognised-format`), a FASTA or GenBank file with a wrong extension or
leading junk, and an empty download.

## What changed

- `FormatError` carries a `reason` (`OpenFailureReason`, a closed list,
  default `parse-error`); `openFailureReason(e)` gives `other` for anything
  else.
- `parseSequenceData` and `parseSequenceFile` check for empty and binary
  input before decoding.
- `describeOpenFailure` (in `openFile.ts`) appends the accepted formats,
  taken from the table in `docs/guide/02-files.md`, to the messages for
  `unrecognised-format`, `binary` and `empty`. The parser messages stay short
  (the archive summary lists them per file), so the hint is added in the app.
- The event name is `<format>:<reason>` from `openFailedName`, both halves
  from fixed lists: the extension is reduced by `formatOfFileName`, the
  reason is an enum value. Free text, file names, extensions and messages
  never reach the tracker. Opt-out, DNT and GPC are unchanged (the tracker
  gate is untouched).
- Tests: `src/app/openFailures.test.ts`, one small synthetic input per class.
- Old events (`genbank`, `other`, ...) have no reason; in Matomo read the new
  ones by the part after the colon.
