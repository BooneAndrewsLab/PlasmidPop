# 8. Linear map export as SVG

Done. **File ▸ Export sequence view as
SVG** writes the sequence rows (ruler, strands, translations, cut sites,
feature lanes) through `SvgContext` at a fixed 60 bases per row, and
**Export selection view as SVG** cuts it down to the rows holding the
selection, keeping document positions and highlighting it
(`exportLinearSvg` in `src/view/svg/exportLinear.ts`; the same
`renderLinearView` as the canvas, with a print theme and a Courier metric
the SVG text estimator matches). Refuses over 100,000 bases.

## Range, bases per row and A4 pages (#30, 2026-09-25)

- **One menu item and a dialog** (`ExportSequenceDialog`) instead of
  Export sequence view and Export selection view: whole sequence,
  selection (the default when there is one, still highlighted) or a
  from–to typed 1-based inclusive, held 0-based half-open
  (`readExportRange`, `src/app/sequenceExport.ts`); bases per row, 10–200,
  starting at the Format menu's value or 60; and "Split into A4 pages".
- **Still the view's renderer.** `exportLinearSvg` lays the document out
  once (`LinearLayout`, lanes, translations) and draws runs of whole rows
  with `renderLinearView` into an `SvgContext` each, scrolled to the run's
  first row. Rows stay aligned to the document's own row boundaries, so a
  range starting at base 1,001 is drawn from the row starting at 961:
  cutting rows at the range start would need a layout with an offset
  origin everywhere the renderer reads `row.start`, for a figure whose
  numbering would then disagree with the view's.
- **Through the origin**: a range with `end` past the length on a circle
  is `rangePieces` — its tail rows then its head rows, stacked as nested
  `<svg>` elements, each clipped to its own rows. It used to fall back to
  the whole sequence. On a linear sequence such a range is refused.
- **A4**: 793.7 × 1122.52 CSS px (96 per inch), 15 mm margins and a 22 px
  footer line. Whole rows are packed greedily; the content is scaled to
  the page's width when wider (a row of 200 bases is) and never enlarged;
  a row taller than a page gets one to itself, scaled to fit.
  `countLinearSvgPages` counts without drawing, so the dialog shows the
  number live. pBR322: 47 pages at 10 bases a row, 16 at 30, 9 at 60, 4 at
  100, 2 at 200.
- **Pages are separate downloads.** The project has no zip writer and
  adding one for this was out of scope; a single SVG cannot hold pages
  (a tall SVG with page frames would not print as pages, so it would not
  be A4 pagination at all). So each page is its own file, `…_p01.svg`
  onwards, downloaded 300 ms apart because browsers drop a burst of
  downloads, capped at 40 pages. The dialog says so before exporting.
- **Usage**: `file / export` is `sequence-svg`, `selection-svg` or
  `sequence-svg-pages`.
- Checked by rasterising a page and a range through the origin with
  `rsvg-convert`: the page holds seven translated rows of pBR322 with the
  footer at the bottom margin.
