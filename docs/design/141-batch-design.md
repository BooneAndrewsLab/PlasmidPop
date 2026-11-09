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
4. Order sheet (built). Closes #358.
5. Cloning rows in the worker (Golden Gate part, homology, restriction ends),
   `extra5`/`extra3` (built).
6. Cloning batch UI, constructs zip, batch protocol (built). Closes #360.

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

## Packet 5: cloning rows in the worker

No UI and no guide page: nothing a user can see differs (the Cloning
workspace's designs are unchanged, pinned below); the page, the constructs zip
and the protocol are packet 6.

**The request.** `designCloning` takes a `CloningRequest` of three recipes,
the Cloning workspace's three kinds of end: `restriction` (`designCloningEnds`
for a pair of enzymes, `scanForCloningNow` in the worker in place of the
page's two scan requests), `golden-gate` (`designGoldenGatePart` against the
destination) and `homology` (a kit's tails, one insert). A design holds a
closure (`simulate`) and documents, which a structured clone drops or refuses,
so the worker runs the simulation itself and answers with the design minus
`simulate`, the simulation's amplicon and product as `DocumentSnapshot`s, and
the client makes them documents again (`CloningResult`), as packet 2 does for a
mutagenesis mutant. A snapshot carries the metadata, so a product keeps
whatever lineage the engine gave it; a test pins that every answer survives
`structuredClone`. It takes `LongRequestOptions`, so a signal cancels as any
long request does. No progress is reported inside a row.

**Homology uses `designMultiOverlapPrimers` with one insert, not
`designOverlapPrimers`.** The plan named the latter, but the Cloning
workspace's Homology ends (#403) calls the former, and only it takes yeast's
overlap and an insert read on the reverse strand, so the byte-for-byte
comparison with the page is against it. For one insert on the forward strand
and a kit's default overlap the two make the same primers and circle (a test
pins it). The products carry
no lineage from the engine, on the page either: `recordOverlapDesign` is
applied when a design is opened; packet 6 adds it where the protocol needs it.

**The runner** (`src/app/cloningBatch.ts`, `runCloningBatch(rows, vector,
options, hooks)`) is `primerBatch.ts`'s shape: one request per row, in order,
a failed row goes on, a cancel keeps the rows done, progress (i+f)/n, more than
`BATCH_ROW_LIMIT` rows throws. `options` holds the recipe, the Golden Gate /
restriction settings (`padding`, `avoidJunctionSites`, `criteria`, `extra5`,
`extra3`), the templates a row's `template` cell can name and the user's
fidelity table. A row's insert is its `sequence` bases (a document of its own,
named for the row), a region of its template (with its strand) or the whole
template. A designed row has the product document (null when the simulation
could not close, its reason among the warnings) and warnings in this order: the
row's own (a `join(...)` read as a span), the columns the recipe ignored, the
design's, the simulation's; a design with no primers (`problem`) is a failed
row, as is a worker error. Names that differ only in case or spaces are
`insertNameClashes` (the later row fails, with `validateBatch`'s message for the
same name and a message of its own for names that become the same primer name).

**Row columns** (`rowRecipe`, validated here against the real enzyme list and
kit names, which packet 1 left as text; a name is read in the list's own
spelling, a bad one fails that row with the designers' `X is not in the enzyme
set.`):

- restriction: `enzyme` is the pair, two names separated by `/`, `,`, `+` or
  a space, forward first; `left`/`right` are `extra5`/`extra3`; `tm` is a
  window of 5 °C either side, as the primer batch reads it;
- Golden Gate: `enzyme` is one name, or two when a second enzyme shares the
  tube; `left`/`right` are the two overhangs (the destination's when absent);
  `include_start`/`include_stop`; `tm` as above;
- homology: `kit` (`In-Fusion`, `NEBuilder HiFi`, `Yeast assembly`, and the
  short forms `infusion`, `hifi`, `neb`, `yeast`).

A column a recipe has no use for is said in the row's warnings and left alone,
as the primer batch does. A row that names its own enzyme or kit gets its own
vector check, made once per distinct recipe.

**Checked once per batch** (`checkCloningVector`, pure; the runner calls it
and returns `refused` with no rows when it fails, so the page can say it once):

- homology: the vector is linear and holds the kit's homology, with the
  designers' own reason (`homologyVectorProblem`, now the one place that text
  lives, used by both homology designers);
- Golden Gate: the enzyme is in the list and makes parts (`whyNotGoldenGate`)
  and opens the destination (`opensNothing`, split out of Simulate's message);
  the overhang pair is `destinationOverhangs`' and is every row's, scored with
  `setFidelity` when the user has imported a table (an informational line, or
  a warning for junctions that can be one another or are not in the table) and
  by `overhangWarnings` when not;
- restriction: the two enzymes are in the list and the extra bases are
  A/C/G/T. Whether they cut the vector inside the region is each row's design
  to say (`vectorCuts`, `outsideRegion`): that needs the cut sites, which the
  worker scans per row.

**`extra5` and `extra3`** are in `CloningSettings` and
`GoldenGatePartSettings`, and the engine takes them without changing an output
when they are empty: extra bases sit between the tail (padding, site, spacer
and overhang) and the annealing part, in lower case as the tail is, and
`PrimerSegments.extra` is only present when there are some. `extra5` reads
before the insert, `extra3` after it as the top strand reads (the reverse
primer carries the reverse complement). For a Golden Gate part they are inside
the overhangs: the released part is `left + extra5 + body + extra3 + right`,
the internal-site check and the site-on-the-amplicon check cover them, and the
frame check counts bases from the start codon, so `extra5` counts only when
the overhang spells the start codon (`AATG`) and not when the Kozak sits
before it. `extraBases.test.ts` pins the empty case with literals taken from
the designers before the change, for a restriction pair and a Golden Gate
part (oligos, amplicon, part, frame, warnings, the simulated circle's size).
The Cloning workspace does not offer them yet; the batch page is where they
first appear.

**Checked.** For each recipe the first test compares a batch row's design
(the whole `design`, so every oligo and warning) and its product as GenBank
text with the engine calls the Cloning workspace makes for the same inputs
(`designCloningResults`' picked pair, `designGoldenGatePart` with
`simulate()`, `designMultiOverlapPrimers` for In-Fusion, NEBuilder and yeast at
30 bases); a row of literal bases equals the design of that insert as a
document. Per recipe: warnings carried per row, a failing row in the middle
(no template, a bad enzyme or kit, a design that cannot be made), a vector the
batch refuses (the worker is not asked), cancel, the limit, name clashes,
progress. Wall-clock time is not asserted, and a cloning batch has not been
timed (a row is a PCR run, a digest or an assembly, and the simulation).

**Not done / left to packet 6.** The page and its method select; the
constructs zip and the batch protocol (the homology product's lineage, above);
per-row choice of restriction pair from the suggestions (a row names its pair,
and the default is the batch's); a vector region per row; multi-part rows; the
Cloning workspace's own `extra5`/`extra3` fields.

## Packet 6: the cloning methods on the page (closes #360)

**The page.** The Batch page's **Method** select (`BatchSession.method`:
`primers`, `restriction`, `golden-gate`, `homology`) says what a row is
designed as; `primers` is packet 3's page unchanged. A cloning method adds a
**Vector** picker (the document in front by default, any open tab or loaded
record: the same `batchTemplates` list), the recipe's own setting (the two
enzymes as text, a Golden Gate enzyme from `goldenGateEnzymes()`, a kit and, for
yeast, its overlap) and a line naming the columns the recipe reads
(`RECIPE_COLUMNS`) and, before the run, the columns set in some row that it
does not (`ignoredColumns`, which mirrors `rowRecipe`'s own per-row warning).
The **Insert template** picker is the old Template picker: it is the template
of a row that has a `region` and no `template` cell. The scan helper is for
primer pairs only. Each method keeps its own run (`run` for pairs, `cloning`
for the cloning methods, one at a time per document); the badge and the
results shown are the method's.

**The run.** `startCloningBatch` is `startBatch`'s shape over `runCloningBatch`,
writing rows to the session as they land; the Settings' `primerCriteria` and
the user's fidelity table go with it. A `refused` outcome is shown once, as an
alert above where the table would be, and no table is drawn. A cloning row has
no map preview (`PrimerWorkspace` returns none for a cloning method): the
detail pane and the construct opening as a tab are all of it.

**Results** (`cloningResults.ts`, pure; `CloningBatchResults.tsx`). A line is
the row's status chip, name, both primers split into parts, the Tm of each
annealing part, the construct's size and its warnings; the sort is
`batchResults.ts`' generalised over what both tables share (`SortableLine`). The
detail shows each oligo as padding, site, spacer, extra bases and annealing part
(restriction and Golden Gate, lower case tail and upper case annealing part as
the Cloning page's `Oligo`, which now also draws `extra`) or the vector's tail
and the annealing part (homology, as the sequence's own case has it).

**Actions.** _Save all_: `name fwd`/`name rev` with the sequence as the Cloning
page saves it (the case that marks the tail is kept, unlike the primer batch's
upper-casing, because the Cloning page's Save both does the same and the case is
the only record of the tail), the note naming the recipe and the vector. _Order
sheet…_: packet 4's dialog, unchanged, over `cloningOrderOligos`. _Open
product_ for the selected row; _Open all constructs_ for at most
`OPEN_ALL_LIMIT` (12) constructs, disabled with a note above that (the user's
call: never 96 tabs). _Download constructs_: `constructEntries` writes one
GenBank per designed row (file named for the row, made safe for a path and
numbered when two names become the same file) and `exportClient.zip` (the
worker `pagesZip` uses) makes the archive, so the main thread does not deflate;
`downloadBlob` saves it. _Protocol…_ (`BatchProtocolDialog`): `buildProtocol`
per construct, with the Bench's two inputs (vector ng, ratio), then
`renameProtocolOligos` so an oligo has the order sheet's name wherever the
protocol mentions it (the lineage's own names are `Forward`/`Reverse` or the
designers' and clash across constructs), and `batchProtocolToMarkdown`/`Html`
render the constructs under one `mergeOligos` table (each sequence once, every
product it serves listed, `already there as` if any construct's was in My
primers). It is built when a format is chosen, with a turn given back to the
page between constructs (an in-silico diagnostic digest each).

**Lineage: what the engine now records.** A protocol is built from a product's
`lineage`, and the Cloning workspace's products had none for restriction and
Golden Gate (the amplicon carried no PCR step, so a Golden Gate protocol had no
oligos) and none for homology. The simulations now record it where they make the
product, not in the batch: `recordAmplicon` (the PCR step with the designed
oligos, in `lineage/record.ts`) on the amplicon of the restriction and the Golden
Gate simulations, `fragmentWithLineage` + `recordLigation` on the restriction
product (the vector's backbone and the insert's digested amplicon), and
`recordOverlapDesign`, the Bench's own function, on a homology circle, both in
the batch runner and in the Cloning page's **Simulate** (`HomologyEndsResult`).
So a batch construct and what the Cloning page opens for the same insert are the
same GenBank text, lineage and all: a test in `CloningDesign.test.tsx` opens
Simulate and compares it with a batch row's product, and `cloningBatch.test.ts`
compares a homology row with `recordOverlapDesign` on the designers' output. A
visible side effect: those products now have a **Made from** tree and a
**Protocol…** (guide, `12-cloning.md`). `recordOverlapDesign` writes the kit's
default overlap, so a yeast construct with another overlap says 40 in its
record; left as it is, since it is the Bench's behaviour.

**The door.** The Cloning tab's **Design many inserts ›** sets the session's
method (the cloning method it was last on, else `restriction`) and calls
`openPrimerWorkspace(id, 'batch')`, so #404's opener memory is the existing
one: a test opens the workspace through it and Escape returns to the Cloning tab.

**Analytics.** `primers:batch` is named by the recipe for a cloning batch
(`restriction`, `golden-gate`, `homology`); new `primers:batch-constructs` (no
label) and `primers:batch-protocol` (the format), fired when the file is
downloaded; never names, sequences or counts. The catalogue and its test.

**Checked** (jsdom only; **the page was not looked at in a browser**). Component
tests with the real in-thread engine, for each recipe (and each kit): paste,
validate, run, results, a failed row going on, Save all, Order sheet, the zip's
entries read back and parsed, the protocol's text (one oligo table, a section
per construct, the oligos named as the sheet names them) as Markdown and HTML,
the refused vector shown once, Open product, Open all and the 12 cap, cancel,
the method switch keeping each run, the columns notes, and the door with
Escape. Pure tests for the line model, drafts, file names, the zip, the
protocols and the ignored columns; text tests for the merged table and the
batch Markdown/HTML. No wall-clock time is asserted, and a cloning batch has
still not been timed.

**Left out.** `extra5`/`extra3` have no
field: a restriction row's `left`/`right` columns carry them (documented in the
guide), and a Golden Gate row's are the overhangs. The vector's own region for a
restriction batch has no field either (the engine takes one; the page leaves it
to the vector's cloning site). Enzyme pair text fields rather than pickers.
Multi-part rows and combinatorial assembly (#360's later list) stay out.

**Batch design is complete** for #358 and #360 with this packet.

**Run caption (#427).** The results used to stay on screen unlabelled after
Method, Vector, Enzyme or Kit changed, beside a Design button that read as if
they belonged to the new settings. They are kept, not cleared, and labelled: the
session records what the run used (`CloningRun.ran`, the whole recipe, plus the
vector name; a primer run has its `templateName`), and a quiet line over the
table names it ("Restriction sites into pLig-Vector (EcoRI/BamHI)", "Homology
ends into GB-Vector (In-Fusion)", "Primer pairs on BP-Plasmid"). When the page's
current settings (`sessionRecipe`, the vector, the template) differ from the
run's, the line adds that the settings have changed. The label comes from the
session, never from the current settings, so it survives a tab switch.

**Primer criteria in the caption (#428).** One Settings change (Dimer ΔG
−2.5, default −6) changed the designed primers and every pool-check number
while the caption said nothing. A run now stores the criteria it designed with
(`BatchRun.criteria`, `CloningRun.criteria`; a run with none ran at the
defaults), the caption ends "; changed primer settings: Dimer ΔG −2.5" when
they differ from the defaults (`describePrimerChanges`), and the "Settings have
changed" test also compares the run's criteria with the current ones.
