# 83. CRISPR guides as features (#224)

**Asked:** let a chosen guide become a feature in the document so it is
saved, exported and drawn on the map like any other annotation.

**Decided: no new export path.** The single-guide "Add as feature" button
already existed (item 74's panel), and a feature is exactly what the saved
file, the GenBank writer and every map already carry. What was missing was
a way to take a whole set. `guideFeature` (in `crisprEdit.ts`) is now the
one place a guide becomes a `misc_feature` (its strand, a `note` with the
PAM, named by its 1-based start), used by both buttons. "Add N listed as
features" applies the guides left by the filters as one `addFeatures` edit,
so undo is one step and the filters are the way to choose. It does not open
the rename prompt, which is for one feature.

Not done: the cut sites, off-target counts and pegRNA parts are not written
as qualifiers; they depend on the scan settings and would go stale on edit.
