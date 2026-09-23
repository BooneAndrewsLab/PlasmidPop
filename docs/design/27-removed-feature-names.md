# 27. Name the features a diff removed

Done, 2026-09-21.
`SaveReviewDialog`'s Features list named what was added (`+ lacZα`) and what
changed (`~ tet changed`), but a removal was one anonymous line —
`− 3 features removed`. The names are the thing the reviewer wants: three
features removed from a plasmid could be three stray `misc_binding`s or it
could be the resistance marker.

- **The asymmetry had a cause**, and the fix the note proposed — make
  `featuresRemoved` a `ReadonlySet<FeatureId>` and resolve it against the
  baseline — is half of one. A removed feature is in _neither_ document the
  dialog holds: the current one has lost it, and the baseline puts it at
  coordinates the edits have since moved. So `DocumentDiff.featuresRemoved`
  is a `ReadonlyMap<FeatureId, Feature>` carrying the feature itself with
  its location mapped through the diff (`mapFeature`, using the
  `positionMapper` that was already there for `sameFeature`). `.size`
  stands in for the old number in `isEmptyDiff` and `describeEditDiff`, so
  the Edits menu's one-liner still ends in `· −3 features` — a summary line
  is the wrong place for names.
- **A name alone is not enough**, as the note said: after item 23 most
  features on a real record are unnamed and fall back to their type, so
  every line carries where it is — `− misc_binding 411..414`, and the same
  for added and changed features in their own coordinates. The positions
  are written the way the rest of the dialog writes one (1-based, inclusive,
  grouped), not as GenBank locations.
- **A deletion is said once.** Deleting a stretch takes every feature on it,
  and seven lines is seven times the same event; a removed feature whose
  mapped location has collapsed onto a deletion boundary is grouped with
  the others that collapsed there: `− the deletion at 1,205 took 7 features
with it: bla, tet, rop and 4 more`. It has to _be_ a deletion — a 1 bp
  feature removed by hand also comes back covering one base — and the
  collapsed location is not always a point: delete `4..12` of a sequence
  whose base at 4 repeats after the cut and the shortest edit script
  deletes `5..13` instead, so the feature's ends map either side of the
  boundary. The rule is "covers at most one base and a deletion is at it".
- **Each list is capped** at eight lines with the rest counted (`and 5 more
features removed`), which none of the three had: the sequence hunks above
  stop at a dozen and say so, and the Features section could run to a
  screenful under them. A deletion's grouped line counts for all the
  features it stands for.
- The rows are built in `src/app/featureChanges.ts` rather than in the
  dialog, which now maps over them; `featureNames` is gone.
- A changed feature's line said only `~ tet changed` until 2026-09-22; it
  names what changed now (item 35).
- Not yet: nothing else shows the names — the Edits menu's tally and the
  sequence view's marks are unchanged — and a removed feature's line is
  not clickable, though its location is now known.
