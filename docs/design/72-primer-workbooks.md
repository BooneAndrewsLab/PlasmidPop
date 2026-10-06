# 72. Primer lists from Excel workbooks (#151)

**Asked:** a follow-up of #141 (item 65). My primers' **From a file…**
offered only text (`.csv,.tsv,.txt` and FASTA) and read the file with
`file.text()`, though primer lists and oligo order sheets are usually
workbooks. A workbook picked anyway was read as the zip's bytes and gave
"lines … held no primer". The issue left one question open: which sheet,
and which columns, of a multi-sheet order form.

**Decided: the first sheet, in the workbook's order, from which
`parsePrimerList`'s table reader takes at least one primer. Sheets are not
merged; a workbook with no such sheet is refused with an error naming its
sheets.** The reasoning:

- Order forms put something else first — instructions, a price list, the
  lab's details — and the oligos on a later sheet. "The first sheet" would
  read the instructions and find nothing; "the first sheet with a primer"
  finds the list without asking.
- A second sheet of oligos is as likely last month's order, a template's
  example, or a plate map of the same oligos as more of this one, so
  merging would add primers the user did not mean to. Taking one sheet and
  saying which ("From sheet “Order”: Added 12 primers") lets the user see
  what was read; another sheet can be saved as CSV and added the same way.
- The refusal is the one #141 gives an assembly-result workbook offered as
  a fidelity table: the sheet names, so the user can see that the reader
  looked at every sheet and why none was taken, rather than a complaint
  about the first sheet's first row.

**Columns** stay what the text reader does: a header row naming the
columns is followed, otherwise the cell of bases is the sequence, the
first other cell the name and the rest notes. The rows go to the table
reader as cells (`parsePrimerRows`), never through tab-separated text, so a
cell with a line break, a tab or a quote stays one cell; whitespace runs
inside a cell (a wrapped header) read as one space. Gaps found while
checking order-sheet layouts, fixed for text and workbooks alike:

- A title or address above the header: any row before the first one
  holding a primer may be the header, and the rows above it are passed
  over rather than reported as skipped.
- Vendors' headers: `Oligo Name`, `Sequence Name` (a name, not the
  sequence), `Sequence (5' to 3')`, `Sequence 5'->3'`. Exact spellings are
  tried first, then a looser match; a column naming a sequence's name, ID,
  length or number is never the sequence.
- Modifications: Sigma and Eurofins keep them in their own columns
  (`5' Modification`), which are added to the notes under their header.
  IDT writes them inline (`/5Phos/ACGT…/3BHQ_1/`); those codes are left out
  of the bases and listed in the notes, since they are not bases and a
  primer with them would otherwise not be read at all.
- Numbers: Excel may keep 58.3 as `58.299999999999997`. `readTableFile`
  now writes a number cell (no type, or `t="n"`) the shortest way, as it
  would be typed; other cells (`t="str"`, errors) are untouched. Integer
  counts in the fidelity tables read as before.

**Built:** `parsePrimerWorkbook(sheets)` and `parsePrimerRows(rows)` in
`src/core/primers/collection.ts`; the panel reads a file with
`readTableFile` (by its bytes, not its name), offers `.xlsx` and also
`.xls`/`.ods` so that picking one says how to convert it, and a file
dropped on the **Paste many** box is imported (a drag of text is still
dropped in as text), where before it fell through to the app and was
opened as a sequence. A skipped place is called a row for a workbook, a
line for text.

**Other pickers, looked at and left:** Open, Compare with… and Align's
file box read sequence documents through `parseSequenceData`; a workbook
there is "Unrecognised sequence format", which is right — a sheet of
sequences is not one document, and nobody asked. The REBASE import reads
REBASE's own text formats. Share links take no file. The fidelity import
already reads workbooks (item 65).

**Checked:** tests build their workbooks with `src/test/xlsx.ts`; no
vendor's sheet is committed. They cover the multi-sheet order form (title
row, instructions sheet first, an old order after), the refusal,
Sigma/Thermo, Eurofins and IDT headers and modifications, cells with line
breaks and tabs, number cells, a dropped workbook named `.txt`, and `.xls`
and `.ods` being told how to convert.
