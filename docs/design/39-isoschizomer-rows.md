# 39. Isoschizomers share a row

Done, 2026-09-23 (#18). An imported REBASE table lists 1,554 enzymes, but
only 395 distinct specificities: AvaII alone has 29 names. The Enzymes tab
listed each one, so a unique cutter came with a dozen copies, and opening a
document ticked all of them — one cut drawn with twelve labels.

- **A group is site plus both cut offsets** (`isoschizomerGroups`,
  `isoschizomerKey` in `core/analysis/restriction.ts`), not REBASE's `<2>`
  isoschizomer list. The list is REBASE's own claim and includes
  neoschizomers; the key is what actually decides the fragments and ends.
  SmaI and XmaI share `CCCGGG` and stay apart, because a blunt end and a
  5′ overhang are different cloning plans. Methylation sensitivity is not
  in the key (HpaII and MspI group together) — there is no Dam/Dcm/CpG
  data yet (#17); when there is, the key may have to grow it.
- **Which name stands for the group.** Members are ordered bundled-table
  name first (the one people clone with), then most suppliers, then
  alphabetically. The panel then prefers a ticked member, then one whose
  name matches the filter, so neither what you ticked nor what you
  searched for disappears behind a better-known name. With **Sold by** set
  only that supplier's members are in the group at all.
- **Ticks stay per enzyme.** `shownEnzymes`, the views, the Cloning tab and
  the worker are untouched: a row ticks one name, and unticking a row
  clears every member, or one ticked earlier while ungrouped would keep it
  checked. Default ticking at open picks the first member of each group
  (`firstOfEachGroup` in `editorStore.ts`) before the
  `MAX_DEFAULT_ENZYMES` check, so with REBASE more documents get their
  single cutters ticked at all.
- **A setting, on by default** (`enzymeGroupIsoschizomers`, remembered in
  `viewPrefs` with the other list options). Off lists every enzyme, as
  before. Not sent as a usage event, like the other list filters.
- Double digests pair the rows, so the five offered are no longer the same
  pair under five names.
