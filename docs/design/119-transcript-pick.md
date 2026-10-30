# 119. Showing one transcript of a gene

Issue #315, follow-up to the grouping (#308, item 115) and the bulk removal
(#316, item 117). A RefSeq gene record carries every transcript variant of
its gene — the INS slice of NG_050578.1 has four mRNAs, four CDSs and four
runs of peptides — and the views group them; a user who wants to read the
record as one variant could only remove the others (item 117), which edits
the document. Now **Format ▸ Transcripts** shows one variant per gene,
display-time only: the mRNA, the CDSs and the peptides of the others leave
the views and the Features list, nothing leaves the document, and **All**
puts them back. Same mechanism and life as the hidden types (item 109).

## The link: compatibility, decided first

The pick needs to know which CDS is which transcript's, and which peptides
are which CDS's. Three ways were weighed:

- **File order.** NCBI writes a CDS and then what its protein is cut into,
  so the run after a CDS is its peptides. But nothing of the kind links a
  CDS to an mRNA: the INS record lists its mRNAs as variants 3, 4, 2, 1 and
  its CDSs as the proteins of variants 2, 3, 1, 4 — no order at all — and a
  hand-made or re-saved file keeps no run. Not used, not even as a
  tie-break: it decides nothing the coordinates do not, and where the
  coordinates are silent it would decide wrongly.
- **Shared qualifiers.** The record has none. The four INS CDSs differ only
  in `/protein_id`, which no mRNA names; `/transcript_id` is the mRNA's
  alone; `/gene` and the `GeneID` `db_xref` are the gene's; the CDS `/note`
  is "proinsulin; preproinsulin", not "encoded by transcript variant 1".
  Only `/gene` is used, to say which gene a CDS or peptide is talking about.
- **Coordinates.** What the record does say is where each piece lies. An
  mRNA _can carry_ a CDS when every piece of the CDS lies in one of its
  exons, consecutive pieces in consecutive exons, and each splice junction
  of the CDS — the end of every piece but the last, the start of every piece
  but the first — is the exon's own boundary. A CDS _can carry_ a peptide on
  the same terms. Strands must agree; a wrapped piece on a circular sequence
  is compared unrolled, and a piece in its tail is slid round once
  (`carries` in `src/view/transcriptPick.ts`). A CDS that skips an exon the
  mRNA keeps, or reads through an intron it splices, is not its CDS; a
  single-exon CDS lies in any transcript whose exon covers it.

So the link is **compatibility, never identity**: a pick leaves out what
_cannot_ belong to the chosen transcript and keeps whatever _can_. That is
weaker than naming each CDS's transcript, and it is all the record supports.
Where the variants really differ (an exon skipped, an intron retained) the
CDSs and peptides are told apart exactly; where they do not — the four INS
CDSs encode the same preproinsulin from four 5′ UTRs, and every variant can
carry every one of them — all four stay, drawn as the one `×4` bar item 115
already makes of them. Picking one of the four to show would be a guess
dressed as a fact, and the Features list would then show a `/protein_id`
that may not be the chosen variant's.

### What a pick leaves out, exactly

With `planTranscripts(features, picks, length)` over the document's
features (hidden types included — a peptide's CDS may be hidden by type and
still place it):

1. **The gene's other mRNAs**: every mRNA of the gene (item 115's grouping,
   by `/gene`, so the picker is offered for exactly the genes item 115 draws
   as a transcripts row) whose key is not the pick's.
2. **A CDS of that gene** that at least one of the gene's mRNAs can carry
   and the chosen one cannot.
3. **A peptide** (`sig_peptide`, `transit_peptide`, `mat_peptide`,
   `propeptide`, `proprotein`) that at least one CDS can carry and no shown
   CDS can. A peptide with a `/gene` is placed only in that gene's CDSs; one
   without is placed by its bases alone.

### Failing visible

Anything the plan cannot place stays whatever the pick, so a feature never
vanishes because the filter did not understand it:

- an mRNA or CDS with no `/gene`, or a CDS whose `/gene` has no variants;
- a CDS that fits none of its gene's transcripts (mis-annotated, hand-made);
- a peptide in no CDS at all, or in a CDS of another gene only;
- a pick naming a gene or an accession the document lacks (the last
  document's picks seed the next, as item 109's types do);
- a gene with one mRNA: no row in the picker, nothing to pick.

Each of these, with a multi-segment CDS, both strands, a circular wrap, and
a hand-made record with no `/transcript_id`, is a case in
`transcriptPick.test.ts`; `src/test/insShapedRecord.ts` is item 115's INS
fixture, moved there so both tests share it.

## What was built

- **`src/view/transcriptPick.ts`**: `transcriptVariants` (the genes with two
  or more mRNAs, each gene's in document order), `transcriptKey` (the
  `/transcript_id`, or the name and location when it has none),
  `planTranscripts` and `showTranscripts`. The filter runs after
  `drawableFeatures` (item 109) and before `groupFeatures` (item 115) in the
  sequence view, the circular map, the map strip, both SVG exports and the
  Features list; a hidden type is still out first, and the copies among what
  is left still draw as one bar. The sequence view's codon arrows skip a CDS
  the pick left out, as they skip a hidden one. Translation lines follow,
  since they come from the drawn list.
- **State**, as item 109: `DocumentState.transcriptPicks` (gene → key),
  outside the history and the dirty check, never read by a writer;
  `SharedState.lastTranscriptPicks` is what the next document starts with,
  stored in the view prefs as `[gene, key]` pairs, read defensively, at most
  `MAX_REMEMBERED_PICKS` (50) genes with the newest kept. A document
  restored from local storage starts from the last picks too, as nothing
  per document is stored (109's own rule). `expandedFeatureGroups` is not
  the model: a group id means nothing in another document, an accession
  does.
- **Format ▸ Transcripts**: a row per gene with variants — the gene's name
  and a select of **All N** and each accession (the name as the option's
  tip) — after **Feature types**, with "N transcripts picked" on the heading,
  "N picked" on the Format button beside "N hidden", and a **Show all
  transcripts** item. Absent when no gene has two transcripts.
- **Features tab**: a banner like item 109's ("Showing one transcript of INS
  in the views; the others … are not listed here either", with **Show all**);
  under a selected transcript the group notice (item 115) gains **Show only
  this transcript**, and once picked the transcript carries a note of its
  own saying what is out, with **Show all 4 INS transcripts**. The phone
  reader has both: a pick is not an edit.
- **Analytics**: `view / format / transcript`, once per visit, like
  `feature-types`; never the gene or the accession (item 38).

## Decided

- **The Features list follows the pick**, where item 109 keeps hidden types
  listed. A hidden type is a name the user chose and can find again; the
  other variants' rows are the fifteen near-identical lines the pick exists
  to clear, and the banner names what is out and brings it back in one
  click. It is also why a picked gene's group notice cannot list the other
  transcripts: they are not rows. **Remove the other transcripts** (item 117)
  is on the group notice, which a pick replaces with its own, so the
  picked-transcript notice carries it too (#328).
- **Exports** follow item 109: the SVG figures draw what the screen draws
  (`transcriptPicks` in both export options, from the view's state); the
  GenBank and SnapGene writers, the clipboard, the share link and the
  history never see the pick.
- **Scope is per gene.** A pick names a gene's transcript; two genes with
  variants have two rows and two picks; **Show all** clears every pick in
  the document. A document-level "one transcript" would have to choose for
  every gene at once, and a record with a readthrough gene (INS-IGF2) shows
  why that is the wrong grain.
- **Ghosts** of removed features (item 27) are not filtered: they are gone
  from the document, so the plan cannot place them; item 109's type filter
  applies to them as before.
- Choosing a variant at fetch time stays ruled out (item 58).

## Making a pick permanent (#328)

The picked-transcript notice offers **Remove the other transcripts**, so a
pick becomes an edit in one step instead of show all, select, remove. The
removal (item 117) takes exactly `planTranscripts`' hidden set for that pick:
the other mRNAs, the CDSs the kept one cannot carry and the peptides no
remaining CDS can carry; what the plan cannot place stays. One undo step,
and the document then equals what the picker showed. The pick itself stays
(a pick naming the sole remaining variant hides nothing).
