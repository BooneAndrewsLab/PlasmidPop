# 94. One Export figure dialog for the map and the sequence view (#240, #241, #243)

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
  (A4). Every row is always rendered and disabled when it does not apply
  (_Scale_ for an SVG, _Range_ unless _From–to_, _Paper_ for the map), and
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
- **Phone width** stacks the preview over the options and the labels over
  their controls, with a shorter preview.

**Decisions.** The default view is the map when there is one, the default
file type SVG, the scale 2×. With the whole of a 4 kb plasmid at 60 bases
a row, PNG at 2× is already over the limit; the dialog refuses it
rather than guessing a scale on the user's behalf. The _Features_ toggles
apply to the map only; the linear renderer has no per-type filter and the
issue asked for none. Analytics events (item 38) are unchanged: `map-svg`,
`map-png`, `sequence-svg`, `selection-svg`, `sequence-svg-pages`,
`sequence-png`, `sequence-png-pages`.

**Left for #242 (pages as one download, PDF).** The _File type_ row is a
list (`FIGURE_FILE_TYPES`) a `pdf` entry slots into; a _Vector | Raster_
row belongs after _Scale_ in **How big**, rendered always and disabled
unless PDF, as the other rows are. The pages note under _Paper_
(`pagesHint`) is the one place that says "each downloaded as a file of its
own", to become "one ZIP of N PNGs" / "one PDF of N pages".
