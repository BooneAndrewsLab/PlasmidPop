# 94. One Export figure dialog for the map and the sequence view (#240, #241, #243, #242)

**Asked:** the File menu had three export-the-picture items that did the
same job two ways: _Export map as SVG_ (no options, downloaded at once),
_Export map as PNG…_ (a dialog with a preview and figure options) and
_Export sequence view…_ (another dialog, SVG or PNG). The sequence dialog's
layout jumped as choices were made, its errors were grey text in the help
line, and a PNG too large to draw was only found out after the click.

**Built: one command, _Export figure…_, and one dialog** (`ExportFigureDialog`,
`src/app/components/`), keeping both old dialogs' logic behind a shared
shell.

- **View** is _Map_ or _Sequence view_; a protein, which has no map, has
  _Map_ disabled with the reason as its tooltip rather than a different
  dialog. **File type** is _SVG_ or _PNG_. The map's SVG takes the same
  options as its PNG did (text size, enzymes, GC ring, centre text, feature
  types, background), where it used to take none; left alone they write the
  byte-identical SVG the menu item wrote. Background applies to both file
  types, since both renderers draw it; only _Scale_ is PNG-only.
- **Groups and rows (#241).** The options are a settings list in the Format
  menu's idiom (item 92): a row is its name on the left and its control on
  the right, under three headings — **What** (view, then what is on it:
  the map's toggles and feature types, or the bases and range), **How big**
  (text size or bases per row, file type, scale, background) and **Pages**
  (pages, paper size). Every row is always rendered and disabled when it does not apply
  (_Scale_ for an SVG, _Range_ unless _From–to_, _Split_ and _Paper size_ for the map), and
  each hint keeps a fixed two-line room, so no row moves when the file type,
  the range kind or the pages change: measured in headless Chromium, the
  row tops are identical across SVG/PNG, Whole/From–to and pages on/off.
  The choices are `SegmentedChoices`, extracted from the Format menu: a
  `radiogroup` whose arrow keys move along the row and step over a
  disabled choice, so Tab plus arrows reach everything.
- **Preview** for both views, as the map PNG dialog had: the map's is the
  SVG itself; the sequence view's is the first four rows drawn by
  `exportLinearSvg` with the range cut short, so it costs one layout and
  four rows whatever the length. The caption gives the size (`SVG, 564 ×
9,826 px`, `PNG, 1,128 × 19,652 pixels at 2×`, `9 A4 pages of …`) and
  that the first rows are shown. The preview is sticky while the options
  scroll, and the action row is sticky at the bottom, so Export and its
  reason are always in view.
- **Live check (#243).** `measureLinearSvg` (`src/view/svg/exportLinear.ts`)
  extends the page-counting layout step to return the figure's width,
  height, rows and pages without drawing; `pngSizeOf` (`src/app/mapPng.ts`)
  is `pngSize` for a size already known. Every change re-runs the range,
  row-width, page-count and PNG-size checks; the first problem goes into
  its own `role="alert"` element (`.panel__note--error`) beside the
  buttons, never into the help text, and Export is disabled while it is
  there. `pngProblem` (`src/app/exportFigure.ts`) works the advice out from
  the limit: the largest offered scale that fits, the row width that would
  (the height falls about in proportion as rows widen, so `basesPerRow ×
height / 16,384`, rounded up to a ten and capped at 200), or A4 pages,
  each of which is far under the limit. A rasterise failure after the
  click is shown the same way and cleared by the next change.
- **Phone width** stacks the preview over the options and the labels over
  their controls, with a shorter preview.

**Decisions.** The default view is the map when there is one, the default
file type SVG, the scale 2×. With the whole of a 4 kb plasmid at 60 bases
a row, PNG at 2× is already over the limit; the dialog says so at once
rather than guessing a scale on the user's behalf. The _Features_ toggles
apply to the map only; the linear renderer has no per-type filter and the
issue asked for none.

## Pages as one download, and PDF (#242)

**Asked:** _Split into A4 pages_ downloaded one file per page, so a browser
that asks where to save asked fourteen times for the example; and there was
no PDF, which is what a figure for a paper or a page for a lab book usually
wants.

**Built.**

- **One ZIP for SVG and PNG pages** (`pagesZip`, `src/app/sequenceExport.ts`):
  `stem.zip` holding `stem_p01.svg` … (or `.png`), written by `writeZip`
  (item 87, fflate), which the backup already used; the "no zip writer"
  reason for separate downloads was stale. The spaced downloads and their
  timers are gone. The 40-page cap stayed for the time being and was
  replaced by a measured rule (#246, below).
- **PDF as a third file type**, for the map as well as the sequence view
  since they share the dialog, with a _Vector | Raster_ row after _Scale_
  in **How big**: always rendered, disabled unless PDF (the no-jumping rule,
  #241), and _Scale_ is enabled for a PNG or a raster PDF. One PDF holds
  every page (`stem.pdf`, `stem_map.pdf`); a single page is a one-page PDF.
  - _Vector_: svg2pdf.js draws each SVG page into jsPDF; text and lines
    stay vector, in the PDF's standard fonts (below).
  - _Raster_: each page is rasterised as the PNG export does it, at the
    chosen scale, and placed on a page of the figure's size with `addImage`,
    so the scale is the pixels per inch (96 × scale). The live size check
    (#243) runs for a raster PDF as it does for a PNG, and not for a vector
    one, which has no pixels.
  - Pages are in CSS pixels with jsPDF's `px_scaling` hotfix (1 px = 1/96
    in), so the A4 page SVGs (written as 210 × 297 mm) come out as A4
    (595.28 × 841.89 pt) and a figure's own size otherwise. Nothing is
    sized twice.
- **Behind our own interface.** `src/app/pdfExport.ts` is what the dialog
  calls (`exportPdf`, `PdfOptions`, the _Vector | Raster_ choices);
  `src/app/pdfWriter.ts` is the one module that names jsPDF and svg2pdf.js
  (as `src/io/zip.ts` names fflate), loaded by a dynamic `import()` on the
  first PDF, so it is a chunk of its own (`pdfWriter-*.js`, about 480 kB,
  150 kB gzipped) and the first load is unchanged. The import failing is
  reported in the dialog as "The PDF writer could not be loaded…".
- **Build.** jsPDF names its optional dependencies (canvg, html2canvas,
  dompurify) in dynamic imports that only `html()` and SVG-as-image reach;
  they are declared external in `vite.config.ts` so the bundle never holds
  them (core-js is only imported by jsPDF's separate polyfill entry). The
  service worker does not precache the writer chunk (`globIgnores`): half
  a megabyte most installs would never use; a `CacheFirst` runtime route
  keeps it once fetched, so PDF export works offline from then on. Under
  Vitest, `svg2pdf.js` is aliased to its ES build: the package has no
  `exports` map and its `main` is the UMD build, which wants a global
  jsPDF.
- **Fonts (the spike).** svg2pdf sets text in jsPDF's standard fonts:
  `"Courier New", Courier, monospace` is Courier and `Helvetica, Arial,
sans-serif` Helvetica, whose widths jsPDF has, so the bases stay on their
  grid and the ruler, numbers and feature labels keep their places; checked
  by rendering the vector PDF with pdftoppm beside Chromium's rendering of
  the same SVG, for the sequence view, an A4 page and the map. The figures'
  only non-ASCII glyphs — the ellipsis of a shortened label, the en and em
  dashes of a page footer — are in WinAnsi, so no font is embedded (nothing
  to license, nothing to ship). One thing did not hold: the map's title is
  `font-weight="600"`, which svg2pdf hands to jsPDF as a style it has no
  font for, and the title fell back to Times. `pdfWriter` rounds numeric
  weights to `bold` or `normal` before drawing. svg2pdf measures text for
  `text-anchor` offsets with the browser's own metrics of the CSS family,
  not the PDF font's; the two agree for Courier New and for what browsers
  substitute for Helvetica, and the test suite lends jsdom a 0.6 em
  `getBBox` for that.
- **Dialog text.** The caption names the file type (`PDF, 564 × 1,395 px`,
  `PDF, 1,128 × 2,790 pixels at 2×`); the pages note says "9 pages,
  downloaded as one ZIP of 9 PNGs." or "… one PDF of 9 pages."
- **Analytics (item 38).** `sequence-svg-pages` and `sequence-png-pages`
  are `sequence-svg-zip` and `sequence-png-zip`; new are
  `sequence-pdf-vector`, `sequence-pdf-raster`, `map-pdf-vector` and
  `map-pdf-raster`.

**Decisions.** The default PDF is vector: it is what a figure wants, and it
is the smaller file. Raster is there for a viewer that renders the standard
fonts badly or for a picture that must match the PNG pixel for pixel. No
font is embedded, so a PDF shows Courier and Helvetica as the viewer has
them rather than the on-screen Courier New; embedding a font would mean
shipping one, and the third-party data policy (bundle only what may be
redistributed) would want a licensed face for a gain nobody asked for.
Dependencies: jspdf 4.2.1 (MIT), svg2pdf.js 2.8.1 (MIT); their transitive
dependencies are MIT, with pako MIT AND Zlib.

## US Letter as well as A4 (#245)

**Asked:** _Split into A4 pages_ offered only A4; North America uses US
Letter.

**Built.**

- **Paper size row** in **Pages**, _A4 | US Letter_, after the _Split into
  pages_ toggle (formerly "Split into A4 pages"). Always rendered, disabled
  unless the sequence view is split into pages (the map is one picture),
  so nothing moves (#241). It is a `SegmentedChoices`, like the rest.
- **One geometry per paper** (`PageGeometry`, `pageOf`, `src/view/svg/
exportLinear.ts`): width and height in CSS pixels, the margin and footer,
  and the `width`/`height` attributes in mm. A4 is the old `A4_PAGE`
  unchanged (793.7 × 1,122.52 px, `210mm` × `297mm`), so A4 output is
  byte-identical; Letter is 816 × 1,056 px (`215.9mm` × `279.4mm`) with the
  same 15 mm margin and footer. `paper` is a `LinearExportOptions` field
  (default A4) that `paginate`, `countLinearSvgPages`, `measureLinearSvg`
  and `exportLinearSvgPages` all read, so the row capacity of a page, the
  page count in the live check (#243) and the files agree.
- **SVG, PNG and PDF follow from the page SVG**: the ZIPs hold Letter-sized
  pages, and the PDF writer, which sizes a page from its SVG (1 px = 1/96
  in), writes a MediaBox of 612 × 792 pt (A4: 595.28 × 841.89). The live
  size check and the caption use the chosen page (`9 US Letter pages of
SVG, 816 × 1,056 px`); the PNG advice says "split into pages".
- **Default from the browser's language** (`defaultPaper`,
  `src/app/exportFigure.ts`): US Letter when the first language tag's
  region is US, CA, MX or another Letter country (PH, CL, CO, VE, CR, GT,
  PA, DO, SV, HN, NI, PR), A4 otherwise or when it names no region. It is
  read when the dialog opens and stored nowhere.
- Analytics events and file names are unchanged: the paper is not an event.

## The page cap, measured (#246)

**Asked:** the 40-page cap dated from one download per page. With one ZIP or
PDF the limits are memory and time, so measure them and lift the cap or make
it a size-based check in the live check (#243).

**Measured** (headless Chromium, the real dialog, a synthetic 100 kb
sequence; the table is in `docs/perf-notes.md`). Nothing failed. The sequence
view is already limited to 100,000 bases and 10 bases a row is the narrowest,
so the most the dialog can lay out is about 830 A4 pages; SVG ZIP, PNG ZIP at
2× and vector PDF all completed at that size, in 1 s, 45 s and 10 s. The cost
that does not scale is the raster PDF: jsPDF decodes each PNG it is handed,
about 0.2 s a megapixel at 1×, 2× and in between (139 A4 pages at 2×: 101 s,
against 11 s for the same pages as a ZIP of PNGs), so 830 pages would be about
10 minutes.

**Rule.** `pagesProblem` (`src/app/exportFigure.ts`), through the same
`role="alert"` slot, Export disabled, and a message worked out from the limit:

- every file type: at most `MAX_EXPORT_PAGES` = 1000 pages, a guard above
  anything the layout can produce;
- ZIP of PNGs: at most 3,000 megapixels summed over the pages (the 2,970 MP
  measured, which held at +640 MB of browser memory);
- raster PDF: at most 600 megapixels, about two minutes, the 40 pages at 4×
  the old cap allowed;
- the advice names the largest offered scale that fits, _Vector_ for a PDF,
  and how many pages the budget holds at this scale.

Every export the old cap allowed is still allowed, and the files are
unchanged: only the refusal moved. Per-page 16,384 px limit (`pngProblem`) is
as before.

**Responsiveness (as first built).** Pages were drawn on the main thread
and no worker was built. The raster paths awaited an image decode per page,
so the browser answered between pages (longest stall 0.9 s); the vector PDF
did not (one 8.8 s task for 834 pages) and `writePdf` was given a yield after
any stretch of pages over 100 ms, cutting its longest stall to 0.6 s. A ZIP of
PNGs still stalled once for 3 to 10 s while fflate deflated it, and a raster
PDF spent its 0.2 s a megapixel on the main thread. The dialog showed
"Drawing page N of M…" (`role="status"`, in the room the problem uses). The
next section replaces this.

## Off the main thread, with a message, a spinner and a stop (#247, #248)

**Asked:** nothing an export does should block the page; while the file is
prepared, show a "getting your files ready" message with a spinner
(`role="status"`, page progress, a Cancel that really stops the work) in
the fixed-height slot so nothing moves (#241); share one overlay/progress/
cancel mechanism and one worker between the PNG ZIP and the PDFs; spike
rasterising in a worker and jsPDF/svg2pdf in a worker first, and fall back
with a note where a spike fails; no export bytes change; then revisit the
600-megapixel raster-PDF budget (#246).

**Spikes** (headless Chromium 156 and Firefox 157 through Playwright, the
real page SVGs of pBR322 at 60 bases a row; WebKit would not start on this
machine, so Safari is untested):

- _(a) Rasterise in a worker: failed._ `createImageBitmap(svgBlob)` throws
  `InvalidStateError: The source image could not be decoded` in Chromium and
  Firefox alike, in a worker and on the main thread, with or without
  `resizeWidth`/`resizeHeight`. The one variant that ran — decode an `<img>`
  on the main thread, `createImageBitmap(img, { resizeWidth, resizeHeight })`,
  transfer the bitmap and draw it on an `OffscreenCanvas` in the worker —
  resizes a bitmap of the SVG's intrinsic size rather than re-rendering the
  vectors: in Chromium 60,503 of 3.56 million pixels differed from the PNG
  export (Firefox happened to match), and the SVG decode stays on the main
  thread anyway. So rasterising stays on the main thread, one page at a time
  with the browser given its turns (`eachPage`, below), and the bytes are
  what `rasterizeSvg` always made.
- _(b) jsPDF in a worker: raster holds, vector does not._ jsPDF's `addImage`
  of PNG bytes and `output('arraybuffer')` use its own decoder and deflate
  (fast-png, fflate) and nothing of the DOM; in a worker three A4 pages at 2×
  (10.7 MP) came out byte-identical to the main thread's PDF (given the same
  creation date and file id) in the same 2.26 s against 2.24 s, so the 0.2 s
  a megapixel is pure JS that a worker can carry. svg2pdf fails at once
  (`ReferenceError: DOMParser is not defined`): it needs a parsed SVG tree and
  the browser's text metrics, so the vector PDF stays on the main thread.

**Built.**

- **One job shape** (`src/app/exportJob.ts`): `ExportJobOptions` is a
  `signal` and an `onProgress({ stage, done, total })` with `stage` either
  `drawing` (main-thread work, a page at a time) or `writing` (the file
  being assembled); `ExportCancelledError` is the rejection of a stopped
  job. `eachPage(items, stage, options, step)` is the loop every path uses:
  progress before the first and after each item, the signal looked at after
  each report (so a stop asked for during a page starts no further page),
  and a `setTimeout(0)` turn for the browser after any stretch of pages over
  100 ms (the #246 rule, moved here from the PDF writer).
- **One worker** (`src/workers/export.worker.ts`, `exportProtocol.ts`,
  `exportClient.ts`), in the analysis worker's idiom: it takes `zip`
  (`writeZip` from `src/io/zip.ts`, so the ZIP stays behind that module and
  is the same bytes) and `rasterPdf` (PNG pages with their sizes, written by
  `pdfWriter.ts`, which the worker loads with its own dynamic import), and
  answers with progress and the file's bytes. Buffers cross by transfer, not
  copy, both ways, so the memory held is the pages once. `ExportClient` runs
  one job at a time (all the dialog allows); **cancelling is terminating the
  worker** — a deflate cannot be interrupted from inside — and the next job
  starts a fresh one. Where `Worker` does not exist (jsdom tests) the same
  `handleExportRequest` runs inline and looks at the signal between pages.
- **The PDF writer** (`src/app/pdfWriter.ts`, still the one file naming
  jsPDF and svg2pdf) is two functions: `writeVectorPdf(pages, title, job)` on
  the main thread through `eachPage`, and `writeRasterPdf(pngPages, title,
job)` for the worker. `exportPdf` (`pdfExport.ts`) rasterises the pages on
  the main thread (`rasterizePages`, stage `drawing`) and hands the PNGs to
  the worker (stage `writing`, counted a second time as jsPDF adds them).
  svg2pdf is now a dynamic import inside the vector writer, so the worker's
  copy of the writer chunk never fetches it; `loadPdfWriter.ts` holds the
  loader so the worker's module graph does not reach the worker client. The
  service worker rules cover both: `pdfWriter-*.js` and `svg2pdf*.js` are
  not precached and are kept once fetched. `pagesZip` is async and goes
  through the client, for the ZIP of SVGs too, so every multi-page export is
  cancellable the same way.
- **The dialog.** One `AbortController` per export, in a ref: `start(job)`
  runs the path, closes on success, shows the failure in the alert slot, and
  does neither when stopped; a stopped job is forgotten, so its promise
  settling later changes nothing (`deliver` also checks the signal before a
  download). The `role="status"` line in the fixed-height message slot
  (#241) reads "Getting your file ready: drawing page 12 of 139…", "…
  writing page 4 of 139…" or "… writing the file…" (`workingText`,
  `exportFigure.ts`), with a text-sized CSS spinner before it (`.spinner`,
  slower under `prefers-reduced-motion`); nothing moves, because the slot
  already kept two lines' room. **Cancel** while an export runs stops it
  and leaves the dialog open with Export enabled again (its tooltip says
  so); pressed again it closes, as the NCBI dialog's Cancel does. **Escape**
  does the same. Unmounting while exporting aborts, so a dialog closed some
  other way never downloads later.
- **Tests.** `eachPage` (order, progress, cancel after a report, yields
  after 100 ms of pages, a cancel arriving during a yield), the client with
  a fake worker (transfer list, progress as the writing stage, abort
  terminates and ignores a late answer, crash replaces the worker, inline
  fallback), both writers' progress and cancellation, `exportPdf`'s two
  stages and a stop while drawing, and the dialog: spinner and wording,
  Cancel and Escape stopping without a download and closing on the second
  press, a stopped PDF's writer seeing the signal, unmount aborting.

**Measured** (the table is in `docs/perf-notes.md`): the same runs as
#246, now with longest stalls of 0.26 to 0.58 s — the page layout, which the
SVG ZIP always had — against 2.7 to 9.9 s for the PNG ZIPs before; total
times within a second or two of before (the worker does the same work at the
same speed, 0.19 to 0.21 s a megapixel for a raster PDF), and the status
line changing on every sample. Beyond the old budget, raster PDFs of 992,
1,981 and 2,970 megapixels completed (198 s, 363 s, 567 s; +519, +595, +787
MB of browser memory), the last being the most the layout can produce at 2×.
Cancel in the real browser stopped a PNG ZIP at page 33 with no download and
a fresh worker made the next one.

**Decisions.** Cancel keeps the dialog open rather than closing it: the
user who stops a two-minute export usually wants to change a setting, and
the NCBI dialog set the precedent. The ZIP of SVGs goes through the worker
although its deflate is short, so there is one path and one Cancel. The
worker is terminated to cancel rather than asked to stop: it is the only way
to end a synchronous deflate, and a module worker starts in milliseconds.
No overlay: the status slot was already reserved (#241), and an overlay
would have hidden the settings the user may want to change after Cancel.
