# 115. Grouped features in the views

Issue #308, follow-up to the translation scope (#304) and the hidden types
(item 109). An NCBI gene record repeats itself: the INS slice of
NG_050578.1 (1,451 bp) has 36 features, of which 15 are exact copies —
after each of four CDSs that differ only in `/protein_id` come the same
`sig_peptide`, `proprotein` and three `mat_peptide`s, with nothing but
file order to link them to their CDS — and five mRNAs, four of them INS
transcript variants. Drawn one each, that is 21 lanes, all overlapping,
and the packing was already optimal (21 is the overlap depth); the
circular map needed a 334 px radius and was cropped. Hiding mRNA and exon
(item 109) only got it to 15.

## What was built

A display-time step between `drawableFeatures` and `assignLanes`:
`groupFeatures(drawable, seqLength, expanded)` in
`src/view/featureGroups.ts`. Hidden types are filtered first, grouping
runs second, so a group is only ever made of what is drawn. It gives back
the list the lanes are packed from and the views draw — every ungrouped
feature as it is, each group as a stand-in feature — with a map of groups
by stand-in id and of each member's group.

- **Copies**: features of one type, strand, joining and segments (partial
  marks and all), whatever their qualifiers, draw as one bar labelled with
  a count: `sig_peptide ×5`, `insulin preproprotein ×4`. The stand-in is
  the first member with the group's id and the counted name, so it keeps
  the member's colour and shape.
- **Transcripts**: a gene's mRNAs, by `/gene` as `translationScope` groups
  CDSs (not `/locus_tag`, which RefSeq lacks, and not shared-exon
  analysis), draw as one row: the union of their exons as a join, labelled
  `INS · 4 transcripts ▸`. A gene with one mRNA is no group — the INS-IGF2
  readthrough keeps its row. The row opens in place (`▾`): it stays where
  it is and a row per transcript stacks over it, the copies among them
  collapsed again. The union through a circular sequence's origin is one
  wrapped segment, so the arrow lands on the right end.
- **Lanes**: on an INS-shaped record 21 lanes become 9 (12 after the copies
  alone, 9 with the transcript rows), 13 with INS opened, 6 with mRNA and
  exon hidden. The synthetic record in `featureGroups.test.ts` has the
  real one's shape and numbers; the real record is third-party data and
  is not a fixture.
- **Where it runs**: the sequence view, the circular map, the map strip,
  and both SVG exports (`expandedGroups` in their options, passed from the
  view's state so a figure matches the screen). `DiffMap` and `DiffStrip`
  draw the two sides of a comparison and are left ungrouped, as item 109
  left them: the renderers take the drawn set as a parameter and fall back
  to the document's drawable features without it.
- **Ring width guard** in `CircularLayout`: `ringWidth = min(asked,
(available − 40) / laneCount)`, floored at `MIN_RING_WIDTH` (6 px); only
  past the floor does the circle grow beyond the canvas, as it always did.
  With the grouping the INS map fits; before it the guard alone would have
  drawn 21 lanes of 6 px.

## Hits, selection and editing

A lane holds the stand-in's id, which no feature has (`group:` prefix), so
`LinearSequenceView` and `featureAtLane` look the hit up in the drawn set
rather than `doc.features`, which used to give the first feature in the
lane whatever was drawn there.

- **Selecting a group selects its first member** in document order: the
  Features tab then highlights that member and offers Rename, Edit and
  Remove on it, as for any feature, and under it a notice says what the
  views draw it as and lists every member — for copies with the qualifiers
  that tell it from the others (`identical` when none do), for transcripts
  with its accession and location — each other member a link that selects
  it instead. That is how a user picks which copy to edit or remove; no
  picker was added to the canvases. The pointer's tip over a group bar
  lists the same lines.
- **Opening a transcripts row takes two clicks**: the first selects (so the
  tab shows the group), the second, with one of its transcripts selected —
  from either view or from the Features tab — opens it; a click on an open
  row closes it. A single click never moves the lanes under the pointer,
  which on the sequence view would move every row below. Expanded groups
  are `DocumentState.expandedFeatureGroups`, view state like
  `hiddenFeatureTypes`, per document and not stored: a group's id is made of
  the gene's name, which means nothing in another document.
- **Not grouped anywhere else.** The document, the Features list, undo,
  the GenBank and SnapGene writers, the clipboard and the history see the
  members only. Translation lines are the document's CDSs (the gene scope
  picks the same longest CDS whether or not four are drawn as one). Edit
  outlines are per feature id, so a changed member inside a group bar is
  not outlined there; it is in the list.

## Decided

- Display-time only, no setting. Merging at load time would touch
  cut/ligate/extract, the clipboard, the stored history and both writers,
  and `writeGenBank` must give back every block of the record it read.
- Choosing one transcript variant at fetch time (item 58) is ruled out:
  the opened content would no longer be the NCBI record it says it is.
- Map labels group the same way for free: `featuresToLabel` runs on the
  drawn set, so a counted name gets its own label beside the gene's.
