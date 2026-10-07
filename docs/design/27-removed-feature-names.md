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
- Not yet: the Edits menu's tally and the sequence view's marks still do
  not name them. Since #27 (item 25) the map draws each removed feature as a
  ghost at its mapped location and names it on hover, the rule above decides
  which are left to the deletion's wedge instead (`deletionThatTook`, moved
  to `src/core/diff/removed.ts` so both use it), and a removed feature's line
  in the review points at its ghost on the review's map.

## Edits the editor carried a feature through (#178)

The diff must call a feature unchanged exactly when the editor kept it, so
its position map answers the way the editor does:

- A **replaced run** (a delete beside an insert) maps its bases one to one
  onto the new ones while both last, then onto the boundary after the run;
  mapping every base to the run's start made an overwrite look like a move.
- On a circle a **start mapped to the new length is the origin**: the range
  moves back a turn (`[44,45)` on a 44 bp circle is `[0,1)`), in
  `mapFeature` and `sameSegment` alike.
- A **deletion in a run of equal bases** may be drawn at any point along
  it, so `sameSegment` accepts every start such a slide gives
  (`equivalentMappings`), as it already accepted two ends. Sequences with no
  such run get only the one answer, so a feature that really moved is still
  reported.

## An indel in a repeat at a feature's edge (#184)

#178 slid only a deletion, and only a segment's start. An insertion or a
deletion in a run of repeated bases (mono- or multi-base) can be drawn at any
point along it, so `equivalentMappings` now slides every lone insertion
(along the _newer_ sequence) and deletion (along the older), and offers both
`starts` and `ends`: an end is offered the insertion both inside and
outside, as `sameSegment` already read it. A segment that wraps the origin
slides its end a turn on, and a whole circle takes every slid start.

A stretch of edits at most 8 equal bases apart that contains a delete beside
an insert is read as one overwritten stretch (prefix one to one, the rest as
an indel), the shape an editor's replace leaves; without that pair two
nearby, separate edits would hide a shift. A stretch of one pure insert is
deliberately not read as an overwrite, since it would hide a real shift.

## A replace the diff draws another way (#185)

A replace by longer text overwrites the selection one to one and inserts
the rest after it; the shortest diff of `T` replaced by `CT` is `C` inserted
before `T`, which moves a feature on that base the editor kept. The
overwrite rule now takes any stretch that added bases (a lone insertion
too), and such a stretch may also have overwritten up to `MERGE_GAP` (8)
equal bases after it: an edge there may stay put. Which the editor did is
not in the sequences, so both readings count. The cost is deliberate: in a
compare of two files, an edge within 8 bases after an insertion whose
coordinates failed to follow it is not marked. An edge further on still is.

A stretch no longer needs a delete beside an insert: an insertion and a
deletion a few bases apart (`TATG` replaced by `TTAT`: `T` inserted, `G`
deleted) are the same overwrite. On a circle, stretches either side of the
origin within `MERGE_GAP` of each other are one stretch a turn long, so a
replace over the origin maps as the editor did; a small rotation of the
origin reads this way too and keeps its features.
