# 65. Fidelity tables as Excel workbooks (#141)

**Found:** the 2026-10-05 correctness audit. The fidelity importer (#68,
item 3) offered only `.csv,.tsv,.txt`, and the guide described the matrix
without saying it had to be text. Twelve of the fourteen files in the
supporting information of Potapov et al. 2018 (doi 10.1021/acssynbio.8b00333)
are `.xlsx`, among them FileS04 (T4 ligase, 18 h, 37 °C), the table NEB's
tools are built on. A user who downloaded the SI found every file greyed out
in the picker; one who dropped a workbook on the box got "its first row
should list the overhangs", read off the zip's bytes.

**Decided: read `.xlsx`, rather than only tell people to convert.** The
issue offered either. The evidence for reading:

- The tables people want come as workbooks, so "save as CSV first" would be
  a step every user of the feature takes, not an edge case.
- It costs no dependency. An `.xlsx` is a zip of XML parts; the platform's
  `DecompressionStream('deflate-raw')` already inflates the share links
  (item 11), so the reader is the zip's central directory, three XML parts
  (`workbook.xml`, its `.rels`, `sharedStrings.xml`) and the worksheet's
  `<c>`/`<v>` elements — about 250 lines in `src/io/spreadsheet.ts`, nothing
  added to `package.json`, no licence to check. A library (SheetJS and the
  like) would add hundreds of kilobytes for formulas, styles and formats a
  table of counts never uses.
- Only values are read: no formulas (a cell's cached `<v>` is taken), no
  dates or number formats, no merged cells. A workbook that needs more than
  that is not a fidelity table.

**Built:**

- `readTableFile(bytes)` decides by the bytes, not the name — a dropped
  file skips the picker's filter, and a renamed one keeps its contents. A
  zip with `xl/workbook.xml` is a workbook, read sheet by sheet in the
  workbook's order (not the part names', which differ: FileS05 has
  `sheet4.xml` first in the zip). An `.xls` (OLE2 compound file) or an
  `.ods` (zip with `mimetype` and `content.xml`) is turned away with "save
  it as an Excel workbook (.xlsx) or as CSV"; any other zip says it is an
  archive. Text is UTF-8, or UTF-16 after a byte-order mark, since Excel's
  "Unicode text" export writes UTF-16LE.
- Cells are placed by their reference (`r="C5"`), since Excel leaves empty
  cells and rows out of the XML. Elements may carry a namespace prefix
  (`x:c`), as non-Excel writers do. Rich-text shared strings are joined
  from their runs, phonetic runs left out.
- `parseFidelityWorkbook(sheets)` takes the first sheet whose first
  non-empty row is a corner cell and then overhangs. A workbook with none
  — Potapov's assembly-result files (S05, S07, S09–S14), whose pairing
  sheet numbers the overhangs `1, 1′, 2…` — gets an error naming its
  sheets rather than a complaint about the first one's first row. An
  empty cell, left out by the workbook, reads as CSV's empty field does:
  no ligation.
- Empty cells after the last overhang of the header are dropped, in CSV as
  in a workbook: a spreadsheet saved as CSV often carries one empty column.
- The picker offers `.xlsx`, `.csv`, `.tsv`, `.txt`, and also `.xls` and
  `.ods` so that opening one says how to convert it rather than the picker
  greying it out without a word. The panel's note and the guide
  (`12-cloning.md`, Measured fidelity) say which formats are read and which
  of the Potapov files are end-joining tables.

**Checked:** on the real SI (kept in `fixtures/local/`, never committed;
third-party data policy). FileS01–S04 read as 256 overhangs each; FileS04
matches, cell for cell, the CSV the audit converted with pandas (408,338
ligations), and its first cells agree with openpyxl (conda `primer3` env).
FileS06/S08 still read as CSV. The eight assembly-result workbooks are
refused with the sheet-naming error. Reading S01 takes about 0.3 s in
Node. The tests build their workbooks in `src/test/xlsx.ts` (real zips with
CRCs, which openpyxl opens) rather than commit a published table.

**Not done:** the primer list import (`PrimerCollection.tsx`) also takes
only text, though primer order sheets are often workbooks; the reader is
generic enough to serve it, filed as #151 rather than changed here.
