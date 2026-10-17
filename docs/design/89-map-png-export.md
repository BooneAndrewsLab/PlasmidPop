# 89. Export the map as PNG, with figure options (#212)

**Asked:** the map left only as SVG, but figures for slides, posters and
papers usually want a PNG at a chosen resolution, and some control over what
is on the figure without editing the SVG by hand.

**What was built.**

- **File > Export map as PNG...** opens `ExportMapPngDialog`: scale (1x, 2x,
  4x), white or transparent background, text size, and toggles for the
  restriction enzymes, the GC ring and the centre name and length, plus one
  checkbox per feature type present. A live preview is the SVG itself in an
  `img`, so what is shown is what is rasterised.
- The picture is `exportMapSvg` (item 31's label-room logic included) drawn
  onto a canvas by `app/mapPng.ts`: SVG blob, `Image.decode`, `drawImage`,
  `toBlob`. Nothing is re-implemented for raster, so the two exports cannot
  drift. `pngSize` is pure and tested; the browser-only drawing is injected
  into the dialog so the tests do not need a canvas.
- `exportMapSvg` gained `featureTypes`, `gc`, `showCentre` and `fontScale`;
  `renderCircularMap` gained `showCentre`. The SVG export itself passes none
  and is unchanged.
- The options live in the dialog's state and never touch the view settings,
  as the issue asked. Enzymes start on when the map shows cut sites, the GC
  ring when the view has it on.
- A canvas side past 16,384 px is refused with the size it would have been,
  since browsers fail silently or blank the canvas past it.

**Decisions.** No DPI field: 1x/2x/4x of the SVG's pixel size is what people
choose, and the dialog states the pixel size. "Label density" is not an
option: the export already buys room for every label, which is the property
that matters on paper. ORFs are not features of the map, so there is no ORF
toggle. The sequence-view (linear) export got the same PNG option in #236 (below). PDF stays out of scope.

**Not verified in a browser:** `Image.decode` of an SVG blob and
`canvas.toBlob` are not available in jsdom; the drawing function was not
exercised by the test suite.

**Superseded (#240, item 94).** _Export map as SVG_, _Export map as PNG…_
and _Export sequence view…_ are one _Export figure…_ dialog since 1.16; the
SVG now takes the same figure options as the PNG.

**Sequence view (#236).** _Export sequence view…_ has an SVG/PNG toggle; PNG
reuses `rasterizeSvg`/`pngSize` and the map's scale and White/Transparent
options (transparent is the linear renderer's own `transparent` flag). With
A4 pages each page is rasterised in turn, never several canvases at once,
and every page is size-checked before any is drawn so a refusal downloads
nothing. Files were `…_pNN.png`, spaced like the SVG pages; since #242 (item 94) the pages are one ZIP, or a PDF, and the map has PDF too.
