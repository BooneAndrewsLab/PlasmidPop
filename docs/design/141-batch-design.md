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
3. The Batch page (a sixth rail page of the primer workspace), primer cases
   (built).
4. Order sheet. Closes #358.
5. Cloning rows in the worker (Golden Gate part, homology), `extra5`/`extra3`.
6. Cloning batch UI, constructs zip, batch protocol. Closes #360.

Packets 1 and 2 changed nothing a user can see. The guide gets the Batch
design section of `10-primers.md` with packet 3, and `12-cloning.md` with
packet 6.

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
The test does not assert the design time (CI took 83 s for the 96 rows and a
60 s budget failed main): it runs 12 rows, and `PLASMIDPOP_PERF=1` runs the plate.

**Guide:** no page changes: nothing a user can see differs yet (the Design
page gives the same pairs; the Batch page is packet 3).

## Packet 3: the Batch page, primer cases

**The page.** `'batch'` is a sixth `WorkspacePage`, between Results and Check
(`BatchPage.tsx`; rail label **Batch**, heading **Batch design**, a badge of
the rows done once a run has some). It is not a new Workspace kind and the
phone is untouched: the workspace is not offered there. The 1000 px
breakpoint, the other five pages and their order of tab stops are as they were.

**Session** (`batchSession.ts`, `createDocumentSession`, in process only):
the table as text, whether the scan helper wrote it, the template picked,
records loaded from files, the run (rows as they land, the rows asked for, the
templates it saw, progress, cancelled), the selected row, the sort and the
last message. A store outside React for the reason Align's is: the run is a
chain of worker requests that goes on while the page is away, so its rows land
in the session, not in a component's state. `startBatch`/`cancelBatch` hold the
`AbortController` per document; a second start while one runs is ignored.
Nothing is written to disk.

**The table is a text box.** "Editable rows" is the paste area itself: the
text is the table, edited in place, validated on every change
(`parseBatchText`, then `validateBatch` with the picked template as the
default). An uploaded CSV/TSV is put in the box as it is; a workbook's table is
put in as CSV (`writeBatchCsv`), which loses the sheet's row numbers (lines
then count from the CSV's header), said in the note under the box. The scan
helper replaces the box's text with `scanRows`' rows and says how many codons
it left out. Bad rows are listed with line, name and message; rows past
`BATCH_ROW_LIMIT` are counted as `validateBatch` counts them, and the limit is
stated in the page.

**Templates.** The picker offers the document in front, the other open tabs of
the same alphabet, and records loaded with **Load templates…**
(`readSequenceData`; held in the session, not stored). A name is offered once,
the first taking it (front document first), without regard to case as a
row's cell is read; names left out are shown under the picker. A row's
`template` cell can name any of them.

**Results** (`batchResults.ts`, pure): a line per runner row: status chip
(`designed`, `warnings`, `failed`), name, both oligos, Tms, product, first
warning. A primer row shows its best pair only (`pairs[0]`); the other pairs
are not kept in the table. The product of a mutagenesis row is the plasmid's
size. Sortable by row, status, name, Tm (the forward's) and product with
`SortTh`; arrow keys move the selection. The detail pane lists both oligos and
every warning. The map preview (`rowPreview`, given to
`usePrimersPreview` by `PrimerWorkspace`) is the pair's sites and product, or
the changed stretch for a mutagenesis row, and only when the row's template
is the document in front and that document is the object it was at the start
of the run; otherwise the pane says it is not drawn.

**Actions.** _Save all to My primers_: `savePrimers(drafts, 'design')`, names
`name fwd`/`name rev`, bases upper-cased (a mutagenesis primer has lower-case
template bases), the store dedupes name plus bases. _Open product_: mutagenesis
rows only (`design.mutant`), `openDocument(doc, null, [], {scratch: true})`;
a primer row has no product document. The _pool check_ is `checkPool` over the
designed rows' oligos, run on the main thread once the run has ended (68-93 ms
for 192 oligos), with the explanation that a cross-dimer only matters for
oligos in one tube.

**Criteria.** The Settings' `primerCriteria` go to the runner as its
`criteria`, so a batch designs with what the Design page does; a mutagenesis row
uses the runner's defaults.

**Analytics.** `primers:batch`, one event per run, named `scan` (the rows came
from the scan helper and the text was not replaced since), `recipe` (a table
with a `change` column) or `region`. Never rows, names, sizes or sequences.
Added to the primers catalogue in `analytics.ts` and pinned in a test.

**Checked** (jsdom only; the page has not been looked at in a browser).
Component tests through the in-thread worker path: paste, validate, bad-row
listing, run, results; the limit; a failed row continuing; Save all and the
pool check; selection, detail and the map preview; sorting; cancel (the first
row designed, the second held until the signal, `analysisClient` spied) keeping
the rows done; the scan helper on a CDS; a page switch keeping table, run and
badge; Open product; an uploaded file; a table with no header.

**Not built here.** The order sheet (since built, packet 4); cloning rows, constructs zip
and protocol (5, 6); drag-and-drop of a file onto the box; per-row choice among
the other pairs; the batch's own Settings (it uses the Design page's).

## Packet 4: the order sheet (closes #358)

`core/primers/orderSheet.ts` (pure): `buildOrderSheet(oligos, {scale,
purification, wellOrder})` returns the lines, the CSV and a list of
`problems`. Header `plate,well,name,sequence,length,scale,purification,notes`,
`\r\n` ends and `csvCell` escaping as My primers' CSV (now exported from
`collection.ts`). Wells fill A1-H12 along rows or down columns (`wellOf`), the
97th oligo starts plate 2, plates count from 1. `scale`/`purification` are
free text, constants for the sheet (`25 nmol`, `desalted`). The sequence is
upper-cased with whitespace removed, IUPAC kept, `length` counted from it,
`notes` the row's first warning.

**Names are never changed.** A repeated name (without regard to case, as the
pool check and a vendor's form read it), an empty name, an empty sequence or a
character that is not a letter is a `problem`, and the dialog disables the
download until there are none; renaming silently would hand the user an order
that does not match their table. The duplicate-name check is repeated in
`orderSheet.ts` rather than imported from `core/batch/pool.ts`, which imports
the primers index, so a primers module importing it would make a cycle. Same
bases under different names is only a warning in the dialog (`sameBases`): a
vendor accepts it.

**The dialog** (`OrderSheetDialog.tsx`, opened by **Order sheet…** beside Save
all, enabled with designed rows and no run going): scale, purification, well
order, the first six lines, the problems, **Download CSV** through
`downloadText` (the `download` prop is the test seam, as in `ProtocolDialog`).
Its oligos are `batchOrderOligos`: the same two per designed row as Save all,
with the first warning as the note. Nothing leaves the machine.

**Analytics.** `primers:order-sheet`, with no label: not the names,
sequences, scale or how many, and fired only when the file is downloaded.

**Checked** (jsdom only; not looked at in a browser). Core tests: header,
defaults, both well orders, plate rollover at 97, escaping, duplicates,
empty input, and a read-back through `splitRow` and `parsePrimerList`. Dialog
tests: preview, plate count, column order, the downloaded text, duplicate and
same-base warnings, close. A Batch page test runs two rows and downloads.

**#358 is complete** with this packet: batch design (packets 1-3), the pool
checks and the order sheet. Cloning rows are #360 (packets 5-6).
