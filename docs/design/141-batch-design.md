# 141. Batch design: primers (#358) and cloning (#360)

**Asked:** design many primer pairs, or many constructs into one vector, from
a table pasted from a spreadsheet or uploaded, in a table-shaped workspace
rather than the side panel. One failing row never aborts the batch; the pool
is checked as a whole; the primers leave as a plate-format order sheet.
#360 (N inserts into one vector by Golden Gate or Gibson) reuses #358's
table, per-row result and workspace shell. This note is extended by each
packet; the sections below say what has been built and what has not.

## Packets

Each is one reviewable piece with its own tests, in this order:

1. **Core table and rows** (built): `src/core/batch/{table,rows}.ts`.
2. Worker requests and the runner, `pool.ts`, the timing test, `designPrimers`
   moved into the worker.
3. The Batch page (a sixth rail page of the primer workspace), primer cases.
4. Order sheet. Closes #358.
5. Cloning rows in the worker (Golden Gate part, homology), `extra5`/`extra3`.
6. Cloning batch UI, constructs zip, batch protocol. Closes #360.

No guide page yet: packet 1 changes nothing a user can see. The guide
(`10-primers.md`, then `12-cloning.md`) arrives with the packets that show it.

## Decisions from the plan (agreed with the maintainer)

- 96 rows at most (384 only as a follow-up); products leave as a zip of
  GenBank files; `extra5`/`extra3` are added to `CloningSettings`;
  `designPrimers` moves into the worker; multi-part rows and overhang-set
  design are deferred; the pool's dimer report is at dG <= -6; batch NCBI
  fetch stays out (only typed accessions go to NCBI).
- One analysis worker, one request per row, sequential, progress (i+f)/n,
  cancel through the existing restart. Engines are deterministic.
- The page is a rail page `'batch'` of `WorkspacePage`, not a new Workspace
  kind.

## 1. The table (`table.ts`)

Columns are found by header as a primer list's are (item 72): exact spellings
first, then looser ones, order free, a title above the header passed over
(a first row naming one column is a header, further down it takes two). The
columns: `name` (required, unique), `template`, `region`, `sequence`, and the
per-row options `tm`, `size`, `enzyme`, `left`, `right`, `include_start`,
`include_stop`, `kit`, `change`. A column the batch does not know is kept
as a note, `header: value`, so a lab's own columns ride along, as a
`notes` column does. Of two columns that mean one thing the first is read and
the second noted. A loose match is never a column naming something else:
"Template name" is not the name, "Sequence name" not the sequence.

Input forms: pasted text, tab, comma or semicolon (the reader of item 72,
`splitRecords` and `tableDelimiter`, now exported from `collection.ts`; quotes
and line breaks inside quotes as CSV writes them; a single column is read
without a delimiter), a sheet's rows (`parseBatchRows`), and a workbook
(`parseBatchWorkbook`: the first sheet that has a header row, else a refusal
naming its sheets, as item 72 does). Rows are numbered by their line or sheet
row. `writeBatchCsv` writes rows back, which is what a scan's rows or an
edited table download as; a test pins that it reads back as written.

A table with no header row is an error, not a guess: unlike a primer list,
there is no cell that is recognisably "the" thing, and a guessed column
would run a batch on the wrong data.

## 2. The rows (`rows.ts`)

`validateRow` gives `{ ok: true, row } | { ok: false, line, name, message }`
(the name is added to the plan's shape, so a listing of bad rows can show
it). The checks, first failure reported:

- no name; an unknown template (named, matched without regard to case);
  no template and no sequence, when no document is in front;
- a region and a sequence together;
- a region: a feature name (case aside; two of one name is refused and asks
  for a location), `start-end` as a spreadsheet user writes it (`-`, `–`,
  `:`, `to`, thousands separators), or GenBank location syntax through
  `parseLocation`, so `complement(...)`, `join(...)` and a range across the
  origin of a circular template work as they do for a feature. A location
  that does not parse says so; one beyond the template's ends, or across the
  origin of a linear one, says it runs past the ends (`1..N`);
- bases (sequence, tails, change) that are not IUPAC, naming the characters
  (U is read as T, spaces dropped);
- options: Tm in °C, size as a whole number of bases, yes/no for the
  include flags.

Positions are 1-based inclusive in the text and 0-based half-open in a
`DesignRow`. A region's `range` is on the forward strand and wraps a circular
template (`end > length`); its `strand` is kept separately. A `join(...)` of
separate pieces is read as the span from its first base to its last, with a
warning on the row, since the designers take one range. A row with no region
and no sequence designs the whole template; a row with a sequence needs no
template.

`validateBatch` adds what no single row knows: a name is used once, the later
row being the bad one (without regard to case, as a vendor's order form
treats it) and only an otherwise-good row taking a name, so a bad row never
costs a good one its name. Rows past `BATCH_ROW_LIMIT` (96) are not checked and
are counted in `overLimit` for the page to say so, rather than listed as 100
failures. Enzyme and kit names are not checked here: they need the enzyme
list and the cloning kits, which the worker packets have.

## 3. The scan generator (`scanRows`)

"Every residue to Ala" produces ordinary rows, not a special job, so the
scan is edited, trimmed and validated like pasted rows: `name`
(`gene_K12A`), `template`, `region` (the codon on the forward strand) and
`change` (the new codon, written on the forward strand, so a reverse-strand
gene needs no thought). The residue is a choice (`to`), a window of the
protein is optional (`from`, `through`), and the new codon is the one
nearest to the old (fewest bases changed, A-C-G-T order on a tie), which is
the smallest change a scan can make and works for any genetic code. A codon
across the origin is a `join(...)`. Codons that cannot be a row are listed
in `skipped` with the reason: already that residue, a stop, the two bases a
partial CDS ends on, or split by an intron (a mutagenesis primer pair spans
contiguous bases). Methionine 1 is included; the user drops it if the start
codon should stay.

## Checked

Tests cover pasted text in each delimiter, quoted fields, workbooks built by
`src/test/xlsx.ts` (a title above the header, an instructions sheet first,
no table), every bad-row kind, duplicate names, the limit, and a property
test that written CSV reads back as written. The scan is checked on a CDS on
each strand and one across the origin: applying every row's `change` to its
`region` changes exactly that residue to the new one and no other.
