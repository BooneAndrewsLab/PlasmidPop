# 75. GC content track (#211)

**Asked:** a GC display like LibreGene's and PlasmidStudio's: a sliding-window
track under the sequence view and as an inner ring on the map, with an
adjustable window (50 bp on the sequence, about 1 % of the length on the
map), wrapping the origin of a circular sequence, a value at the cursor, the
selection's GC in the status bar, computed in a worker for large sequences,
a toggle with a shortcut.

**Built:**

- `core/analysis/gcContent.ts`: `gcContent`, `gcContentOfRange` (a range that
  runs past the end of a circle), and `gcProfile`, one `Float32Array` value
  per base from running prefix sums, so the cost is the length and not the
  length times the window. A window centred on a base; shortened at the ends
  of a linear sequence rather than padded (padding would drag the first and
  last windows towards 0); across the origin on a circle; a window as long as
  a circle is its whole GC everywhere.
- **Ambiguity codes** count for what they could be, in whole sixths so the
  sums are exact: S is GC (as `gcFraction`, the primers' number, always
  counted it), W is not, R/Y/K/M are half, B/V two thirds, D/H one third, and
  N is left out of the denominator. A window of nothing but N has no value
  (NaN) and breaks the line.
- Linear view: `LinearMetrics.gcHeight` keeps a band under the strands of
  every row (`gcTop`), part of `baseBlockHeight` so translations, lanes and
  hit-testing move with it; a `gc` hit kind carries the base for the tooltip.
  Map: `drawGcRing` just inside the lanes, sampled about every 3 px of arc
  (never more than 20,000 points), so a megabase map costs what a plasmid
  does; the centre label makes room for it.
- One window preference, `gcWindow` (null = automatic: 50 on the sequence,
  1 % on the map with a floor of 10), and `showGc`, both remembered in
  `viewPrefs`. The window choices are a fixed list so the select can always
  show the stored value.
- Up to 200 kb the profile is made inline in a `useMemo`; above it, in the
  analysis worker (`gcProfile` request, the buffer transferred), keeping the
  previous profile up meanwhile.
- The status bar adds `, GC 52.3 %` to a non-empty selection, whether or not
  the track is on, counted across the origin when the selection is.

**Decisions worth keeping:**

- **No View menu exists**, so the toggle is under **Format**, which already
  holds the sequence view's display options, with `Alt+G` (`toggle-gc`) in
  the bindings table. The toolbar's three toggles were left alone; a fourth
  would crowd the phone layout, and the reader has no track anyway.
- The track is a property of nucleotides: `hasTool(doc, 'gc')` is false for a
  protein, so the menu item is disabled and the key is left to the browser.
- "The value at the cursor" is the pointer: hovering the track gives a
  tooltip with the value, the window and the base. The caret's own base
  would need a readout nobody looks at while typing.
- Not in the SVG exports: they are figures of the annotation, and a GC trace
  in them is a separate want.
- Two views at different automatic windows make two profiles. That is cheap
  next to keeping a resampling of one.
