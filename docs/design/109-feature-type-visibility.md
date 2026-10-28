# 109. Per-type feature visibility

Issue #305. NCBI records carry mRNA variants, CDS isoforms, `misc_feature`
and exons, and the views drew every feature except `source` and a gene that
duplicates its CDS (`drawableFeatures`). The user can now switch feature
types off, per document.

## What was built

- **Filter.** `drawableFeatures(features, hiddenTypes)` in
  `src/view/visibleFeatures.ts` takes the hidden set as an optional second
  argument. The circular map (`CircularMapView`, `renderCircular`'s
  ghosts), the sequence view (`LinearSequenceView`), the map strip
  (`MapStrip`, `renderRibbon`) and the SVG exports (`exportLinear`) pass it.
  Lanes are built from the filtered list, so hit-testing (which asks for a
  feature in a lane) cannot find a hidden feature, and the labels, the
  translation lines and the removed-feature ghosts of a hidden type go with
  it. `drawableTypes` and `hiddenTypeCount` are the pure helpers for the
  checklist and the indicator.
- **Not a call site.** `DiffMap` and `DiffStrip` draw the two sides of a
  comparison, not the document in front, and stay as they were; Export
  figure's map has its own ticks (item 89), seeded from the view's hidden
  set when the dialog opens.
- **State.** `hiddenFeatureTypes` is a `DocumentState` field next to
  `shownEnzymes` (item 20): view state, outside the history and outside the
  dirty check, never read by a writer, so round-trips are untouched.
  `lastHiddenFeatureTypes` (shared) is what a document opened next starts
  with, stored with the view prefs (`hiddenFeatureTypes`, a sorted array,
  read defensively like its neighbours). A type the document lacks is just
  not drawn and not counted.
- **Control and indicator.** A **Feature types** group in the Format menu
  (one tick per type, after the Trace row), with "N types hidden" on its
  heading, "N hidden" on the Format button, and a **Show all feature types**
  item. The Features tab carries a note with a **Show all** link, as the
  Enzymes tab does for hidden cut sites (item 20). No key is bound.

## Decided

- Hidden features stay in the Features list and inspector, and selecting one
  there still selects its bases: the list is where a user goes to find what
  the map does not show. They cannot be clicked on the canvases. The arrow-key
  codon selection skips a hidden CDS.
- Hiding `CDS` stops its translations in every translation scope (note 01,
  #304): the scope picks among the CDS features that are drawn, so even the
  selected CDS is not translated while its type is hidden.
- A `gene` that is drawn only as its CDS's twin reappears when `CDS` is
  hidden, since it is no longer a duplicate of anything drawn.
- Only types, not individual features. `source` is not offered.
- Documents restored from local storage also start from the last choice, as
  nothing per document is stored.
