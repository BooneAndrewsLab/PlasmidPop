# 8. Linear map export as SVG

Done. **File ▸ Export sequence view as
SVG** writes the sequence rows (ruler, strands, translations, cut sites,
feature lanes) through `SvgContext` at a fixed 60 bases per row, and
**Export selection view as SVG** cuts it down to the rows holding the
selection, keeping document positions and highlighting it
(`exportLinearSvg` in `src/view/svg/exportLinear.ts`; the same
`renderLinearView` as the canvas, with a print theme and a Courier metric
the SVG text estimator matches). Refuses over 100,000 bases. Not yet: a
chosen range other than the selection, a bases-per-row control in the UI,
page-sized (A4) pagination.
