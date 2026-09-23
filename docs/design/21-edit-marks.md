# 21. Show edits in the sequence view

Done, with all three
baselines of the open question, chosen from an **Edits** menu in the
toolbar: Off / Since opened (the default) / Since last save / Mark
from here (`editsBaseline`, `openedDoc`, `markedDoc` in the store;
the mode is remembered with the other view preferences, "marked"
coming back as "opened"). The marks are a diff of two `SeqDocument`s
(`src/core/diff/`): a Myers O(ND) diff after stripping the common
prefix and suffix, which splits on a shared 32-mer when one stretch
needs more than 1,000 steps and only then reports "this whole stretch
was replaced". A shortest script is not the clearest one on four
letters — two edits a dozen bases apart come out as a scatter of
one-base specks — so each neighbourhood of changes is re-aligned with
`alignPairwise` (`refine.ts`), whose affine gaps prefer one long gap
to six short ones; those windows are small enough for O(nm) (1.3 ms
for a normal session, ~37 ms worst case, `docs/perf-notes.md`). Inserted bases are
tinted green with an underline, changed bases amber, deletions get a
red wedge and a line at the boundary; features added or edited are
outlined, and a feature that merely moved with an edit elsewhere is
not (its old location is mapped through the diff). The marks are in
the sequence-view SVG exports too. Requested 2026-09-18. `Alt+E` turns the marks
off and back to the chosen baseline (item 32). Not yet: the circular map
(item 25), anything for a rename or topology change beyond the menu's
tally.
