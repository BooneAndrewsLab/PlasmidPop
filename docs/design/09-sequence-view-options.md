# 9. Sequence view options

Done. A **Format** menu in the toolbar
sets the text size (Small / Medium / Large, with the rest of the row
scaling with it through `linearMetrics` in `src/view/linear/layout.ts`),
the bases per row (Fit the window, or a fixed 30 / 60 / 90 / 120, which
scrolls sideways when it does not fit), whether the row's position
number is repeated beside the complement, and whether the bases are
coloured (one drawing pass per colour with the other columns blanked
out, measured in `docs/perf-notes.md`). The choices are remembered with
the other view preferences and the sequence-view SVG exports follow all
but the text size.

**Of the user's own** (#29, 2026-09-24): **Other** takes a bases-per-row
count from 10 to 1,000 (the store clamps it, storage too), committed on
Enter or blur rather than per keystroke; while **Colour the bases** is on,
four `<input type="color">` swatches set A, C, G and T
(`SharedState.baseColors`, `#rrggbb` or null for the theme's), which
`readLinearTheme` lays over the CSS palette for the view and the read trace
and the SVG export takes in place of its print palette; **Font** names a
family (`seqFontFamily`), cleaned to letters, digits, spaces, hyphens and
underscores so it can be quoted into the font string without escaping, and
put ahead of the system monospace stack (`monoFontOf(size, family)`). The
view measures a character of whatever it gets, so any monospace font lines
up; a proportional one would not, which is why the box says monospace. The
SVG export keeps Courier for the same reason it keeps its own size. All three
are view preferences, checked field by field on the way back in.
