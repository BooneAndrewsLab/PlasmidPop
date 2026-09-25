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
off and back to the chosen baseline (item 32). The circular map got the
marks in item 25.

**Renames and topology changes, 2026-09-24 (#31).** Neither touches a base,
so `DocumentDiff` has only flags for them and `isEmptyDiff` rightly ignores
them: a rename alone marks nothing and steps nowhere. They are shown where
they are written instead — the toolbar's document name and the _linear_ /
_circular_ of its size line get a broken underline in the "changed" amber,
with the tooltip `Renamed from “pBR322”` or `Was linear` (`identityChange`,
`renameNote`, `topologyNote` in `editsView.ts`; `identityChangeOf` over the
same `editsBaselineDocument` as the marks, so Off shows nothing and each
baseline its own answer). The toolbar because it is the one place visible
in every view, sequence, map or both, and because it is where the thing
changed is already printed, so the mark sits on it rather than beside it;
a note in the map's centre would be missing from the sequence view, and
the sequence view has no header to carry one. Broken, amber, because that
is what a feature relabelled over the same bases is drawn with (item 35):
the same bases under another description. No colour change of the text
itself, which would shout for something this quiet. Against a compared
file the tooltip says what the other is called or is (`Named “pBR322” in
theirs.gb`, `Linear in theirs.gb`), since "renamed" is not what happened
there. The name a working copy gives itself (item 24's `pBR322 copy`,
`isCopyNameOf`) is not counted: it is the app's doing, the copy banner
says it, and otherwise every edit to an opened file would light the name.
The Edits tally now adds `renamed` and `made circular`, and its dot shows
for them. A feature renamed in place was already a changed feature with
the broken outline on both views; that is now a test too.
