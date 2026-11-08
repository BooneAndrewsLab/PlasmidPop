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
2. **Worker requests and the runner** (built): `designPrimers` and
   `designMutagenesis` requests, `src/app/primerBatch.ts`, `pool.ts`, the
   timing test, `designPrimers` moved into the worker.
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

## Packet 2: worker requests, the runner and the pool checks

**Requests.** `analysisProtocol` has `designPrimers` (sequence, topology,
target, `DesignOptions`, answered with the pairs) and `designMutagenesis` (a
`DocumentSnapshot` of the template, range, replacement, method, options). A
mutagenesis design holds its `mutant` as a `SeqDocument`, which a structured
clone would strip, so the worker answers with the mutant as a snapshot and
`AnalysisClient.designMutagenesis` makes it a document again. Both take
`LongRequestOptions`, so a signal cancels as any long request does (the
worker is replaced). Neither engine reports progress, so a row's progress is
the runner's. `designCloning` is packet 5.

**The Design page.** `usePrimerDesign().design` now asks the worker, so the
main thread is free while a pair search runs (125-200 ms on a plasmid, longer
on a large target). It is async and resolves to the pairs, or null when a newer
Design click, or leaving the document, stopped it; the page goes to Results
only for a design that finished. The results are the engine's: a test pins
`client.designPrimers` equal to `designPrimers` on a circle, across the
origin and on a linear template. The workspace tests now await the click.

**The runner** (`runPrimerBatch(rows, templates, options, hooks)`) is
`readBatch.ts`'s shape: one request per row, in order; a per-row status
(`designed` with `kind: 'primers'` or `'mutagenesis'`, or `failed` with a
message); `onRow`, `onProgress` as (i+f)/n, a signal; a failed row goes on, a
cancel keeps the rows done; more than `BATCH_ROW_LIMIT` rows throws. The
client is a hook, so tests stand in for the worker. Decisions:

- A row with `change` is a mutagenesis; any other is a primer pair flanking
  its region. A row with no region, or only bases, fails with that said:
  primer pairs flank a target, and a whole template or a literal insert has
  nothing to flank (a literal insert's ends are the cloning rows' job).
- `tm` on a primer row is a window of 5 °C either side (the default 55-65 °C
  is 5 either side of 60); on a mutagenesis row it is the back-to-back
  target Tm. `size` on a primer row is the product's ceiling. `left`,
  `right`, `enzyme`, `kit`, `include_*` mean nothing to a primer design, and
  a row that sets one says so in its warnings rather than failing.
- A design with no pair that meets the criteria is a failed row (the
  results table has a place for the message, not for an empty chip); a
  mutagenesis that falls short still is a design, with its `problem` among the
  row's warnings. The template's snapshot is made once per template.

**The pool checks** (`core/batch/pool.ts`, pure): duplicate names (without
regard to case), identical bases under different names, cross-dimers between
every two oligos of different bases at `DEFAULT_DIMER_DG` (-6, kcal/mol) with
the existing `dimerEnergy`, most stable first, and the Tm spread
(`meltingTemperature`, degenerate oligos left out, flagged past 5 °C).
An oligo with itself is its self-dimer, which its own report has. Rows whose
regions overlap give primers that are reverse complements of one another
across rows, so a plate over one template reports many strong cross-dimers
(96 of them for the timing plate below): that is the check working, and a
page should say that a dimer between primers of different tubes only matters
if they share a tube.

**Measured** (`src/app/batch.timing.test.ts`; vitest has no `Worker`, so the
worker's code runs on the calling thread, which is the engine path without
the per-row message round trip; numbers in `docs/perf-notes.md`): 96 regions
of 600 bases on a random 4.4 kb circle took 19.6-21.9 s (about 205 ms a row,
five runs, machine at a load of 2-4 of 16 cores), and the pool check on the 192
oligos 68-93 ms. **The design number crosses #359's trigger** (more than 15 s
per 96 rows), so a pool of workers is now a justified follow-up; it is not
built here. The pool check is nowhere near needing one. In the browser each
row is one worker request, the main thread stays free and the table fills as
rows finish, so 20 s is a wait, not a freeze; the browser has not been timed.

**Guide:** no page changes: nothing a user can see differs yet (the Design
page gives the same pairs; the Batch page is packet 3).
