# 117. Removing features by type or by variant

Issue #316, follow-up to the grouping (#308, item 115). Grouping and hidden
types (item 109) change only what the views draw; a user who fetched a gene
record from NCBI and wants a document with one transcript variant in it, or
without the forty exons, had to press Remove once per feature. This is the
explicit edit for that. It changes the document, which then no longer
matches the NCBI record it came from, so it is a command the user chooses,
never a default and never part of the fetch (item 58 rules out choosing a
variant there for the same reason).

## What was built

- **One op, one undo step.** `EditOp` gains `removeFeatures { ids, label? }`:
  every listed feature the document has goes, the others stay as they were,
  in their order and untouched (the same objects, so a wrapped or joined
  feature's segments cannot move); ids it lacks are skipped. A removal that
  finds nothing returns the same document, and `EditorStore.apply` pushes no
  history step for an unchanged document, so there is nothing to undo.
  History is snapshots, so Undo gives back the document as it was, feature
  order included. `label` is the History label (the Undo button's tip):
  `Remove 14 mRNA features`, `Remove 3 other INS transcripts`; without one,
  `Remove N features`. It is plain text in the op, as the history labels are,
  and never sent anywhere: the analytics count the edit as
  `edit / removeFeatures`, by op type, like every edit (item 38).
- **Building the op** is `src/app/featureRemoval.ts`: `removeTypeOp(doc,
type)` and `removeOtherMembersOp(group, keepId)`, pure and null when there
  is nothing to remove.
- **Where it appears: the Features tab, under the selected row**, next to the
  feature's own Rename, Edit and Remove, because that is where a feature is
  removed today and where the group notice already lists a group's members.
  - **Remove all N <type>** (`Remove all 14 mRNA`), beside Remove, when the
    document has more than one feature of the selected one's type.
  - **Remove the other transcript(s) / copy (copies)**, in the notice under a
    member of a group the views draw as one (item 115).
  - Both say how many go on the button, and the Undo tip names it again.
    No confirmation dialog: one Undo takes it back, as it does Remove, and
    no edit in the app asks first.
    Not in the phone reader, which never edits (its list has no Remove
    either). No key is bound.

## What each removes, exactly

- **Of a type**: every feature whose type is that type, in the whole
  document, including features of a type hidden in the views (item 109;
  they are listed in the Features tab, which is where the command is).
- **Of a variant**: a transcript variant is what item 115 groups, a gene's
  mRNA (by `/gene` and strand). The command keeps the selected variant and
  removes the gene's other mRNAs — only those. Removing one variant is the
  row's own Remove, so the new command is the one Remove could not do in one
  step. For a copies group (same type, strand and location, such as the four
  INS CDSs that differ only in `/protein_id`) it removes the other copies.
- **Not the CDS and peptides of the removed variants.** A RefSeq record has
  nothing in the qualifiers that links an mRNA to its CDS, or a CDS to the
  `sig_peptide`, `proprotein` and `mat_peptide` features after it; only file
  order does, which non-NCBI files do not keep. Item 115 links none of them,
  and that linkage was #315's to decide, so this removes what item 115 links
  and no more. The CDS copies are reduced the same way from their own group;
  the button's tip says the transcripts' CDSs and peptides stay. Item 119
  since decided the link by coordinates — which CDSs and peptides a
  transcript _can_ carry — for its display-time pick; taking the CDSs that
  cannot be the kept variant's along with the mRNAs would be a follow-up.

## Decided

- An edit, not a view setting: a document reduced to one variant is written
  to GenBank and SnapGene files without the others, which is the point; the
  writers need nothing new (a test round-trips the result through GenBank).
- Not a menu entry: both act on the selected feature, and its row is where
  the counts can be shown before the click.
