# 64. GenBank qualifiers with unpaired quotes (#139)

**Found:** the 2026-10-05 correctness audit, on Biopython's
`Tests/GenBank/qualifier_escaping_read.gb`. A quoted value stays open while
its count of quotes is odd, and an open value swallowed every line after it,
feature keys included: `/note="One missing ""quotation mark" here"` took the
next three features into the note. The only warning was "Unterminated quoted
value", which said nothing of the features lost. A second flaw sat beside
it: a value counted closed whenever its count was even, so `/note="open "x`
was cut to `open "`.

**Built** (`parseFeatureTable` in `parseGenBank.ts`):

- A value is closed when its count of quotes is even _and_ it ends in one
  (`isClosedQuote`).
- An open value is closed by force at a line laid out as a feature key: five
  spaces, the key, the location at column 22 (one space after a key too long
  for that). A continuation line is indented to column 22, so none looks
  like this; one indented less is still read as text.
- An open value is closed by force at a qualifier line (`/name...`) when the
  value so far ends in an odd run of quotes after the opening one (`here"`),
  the line where Biopython would have closed it. An even run (`""hi""`) is
  an escaped quote that wrapped, so `/path/to"` on the next line stays text;
  Biopython reads that one as a qualifier.
- A value closed by force drops its last quote, so the result matches
  Biopython's: `One missing "quotation mark" here`. The warning says it had
  an unescaped quote and names the feature or qualifier that closed it.

**Checked:** Biopython 1.85 (`.venv-oracle`) on the test file and on the
cases in `genbank.test.ts`; the audit corpus of 958 records parses with the
same features as Biopython 1.88 (conda `primer3`), 18,225 compared, and the
same qualifier values. Biopython refuses a record whose last line in a
feature leaves a quote open; PlasmidPop closes it at the next feature.
