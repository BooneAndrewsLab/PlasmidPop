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
but the text size. Not yet: a bases-per-row number of the user's own,
colours the user can change, a font family choice.
