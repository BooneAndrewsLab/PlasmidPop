# 70. Small input and output edge cases (#146)

**Found:** the 2026-10-05 correctness audit. Three unrelated places where
input was changed or misread without a word.

- **Mutate's "Change to" dropped a U.** The box kept only IUPAC nucleotide
  codes, so an RNA-style `GCU` became `GC`: a shorter change, no message.
  `readChangeBases` (`mutagenesis.ts`) now reads U as T, as primers always
  have (`cleanPrimer`), drops spaces and digits quietly (a pasted numbered
  block), and names every other character it leaves out; the panel shows
  _U read as T. Left out, not bases: “#”._ under the box. The primer
  collection's filter, which had the same filter, now uses `cleanPrimer`,
  so a U in it searches as T. U in documents themselves is #113's question
  and is unchanged.
- **A malformed REFERENCE line was written back as one Biopython refuses.**
  Biopython's `bad_origin_wrap_CDS.gb` has `REFERENCE   .` with no number.
  The reader numbered it and kept `.` as its location, and the writer gave
  `REFERENCE   2 .`, on which Biopython 1.85's consumer asserts (it takes
  anything after the number for a parenthesised base range). Checked with
  `.venv-oracle`: `REFERENCE   2` and `REFERENCE   2  (bases 1 to 256)` read,
  `2 .` and `2  .` do not. Now a `.` location is no location, and loose
  text where the location goes is kept in the reference's REMARK with a
  warning. The writer has the same guard, for a document stored before the
  fix: only `(…)` follows the number. All 64 files of the audit's corpus,
  rewritten, read back in Biopython with the same references.
- **FASTQ in the old encodings was read as Phred + 33 without a warning.**
  Illumina 1.3–1.7 (Phred + 64, lowest `@`) and Solexa (log-odds + 64,
  lowest `;`) come out ~31 too high. They are obsolete and still not
  decoded; the reader warns instead. "Every character ≥ `@`", as the issue
  put it, would also fire on a good Illumina 1.8 run (`@`–`J` is Q31–41),
  so the + 64 warning also needs a character above `J`, which 1.8 never
  writes and + 64 does from Q11. Below `@` but not below `;` and reaching
  `h` is Solexa. Over Biopython's `Tests/Quality` files this flags exactly
  `illumina_faked`, `illumina_full_range_original_illumina` and
  `solexa_full_range_original_solexa`. One check covers every way in (File
  ▸ Open, gzipped, Align), since all go through `parseFastq` (Compare
  ignores qualities, so it does not show the warning);
  Align's file box used to drop the reader's warnings, and now appends them
  to its note, which matters there because qualities weigh each difference.
  AB1 stores qualities as bytes, so it has no encoding to mistake.
- **FASTQ bases and qualities, AB1 quality fallback (#159).** Decided:
  `U` reads as `T` and `-` or `.` as `N`, each with a warning giving the
  count per record (the quality array stays one per base, so a `-` keeps
  its quality); other characters still refuse the file. Quality characters
  below `!` already warned and read as 0 (pinned by a test now). DEL
  (0x7f) is still clamped to Q93 but with its own warning, since the generic
  encoding hint did not say it. Biopython refuses `-` and `.` and control
  characters, so those files stay out of the oracle comparison. In AB1 the
  PCON of the other copy was used when only its length fitted; PBAS2 edited
  to different bases of the same length would then carry PCON1's qualities
  of other bases. The fallback now needs the other copy's calls to equal
  the calls read; otherwise no qualities and the existing "no base
  qualities" warning.
