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
and the SVG export takes in place of its print palette. Both are view preferences, checked field by field on the way
back in.

**A font choice was built and taken out again**, the same day. First a box
for a family name, then, on review — nobody knows a font's name off the top
of their head, and a proportional one leaves the columns ragged — a list of
candidate monospace fonts found installed (text drawn in the font, with
each generic family behind it, not as wide as the generic alone) and
monospaced (a run of `i` as wide as a run of `M`). Then out: the real reasons
for it (a narrower font fitting more bases, a font one is used to) are
weak for DNA, whose letters no monospace font confuses, and the menu is
shorter without it. It comes back if people ask; commit `91a965a` has the
detection (`src/app/monoFonts.ts`) and the plumbing (`seqFontFamily`,
`monoFontOf(size, family)`).
