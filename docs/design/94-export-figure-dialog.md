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
