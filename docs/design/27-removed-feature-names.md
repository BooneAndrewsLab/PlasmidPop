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

## One reading for a whole feature (#189)

The readings above were offered edge by edge: `sameSegment` took any start
from `starts` and any end from `ends`, and judged each segment of a join on
its own. Nothing tied the two to one drawing, so a start read with an indel
slid one way and an end read with it slid the other — or with a stretch
overwritten for one edge and inserted for the other — passed as unchanged.
Delete one copy of a 300 bp tandem duplicate and a 50 bp feature could be
hand-edited to 251 bp without the review or Compare noticing.

`equivalentMappings` now returns `readings(edges)`: every edge of a feature,
all its segments' included, placed together under one reading at a time,
the diff as drawn first. Each ambiguous edit is a group with its choices
(the indel slid along its repeat, or the stretch read as an overwrite
reaching `x` equal bases past it — an indel inside a stretch belongs to the
stretch's group, since both are readings of the same edit), and a reading
picks one choice per group. Readings of different edits combine, but an
edge is moved by at most one of them: each choice is measured from where
the diff drew the others, so two moving the same edge would not add up to a
place. A slide only needs trying near an edge (elsewhere it moves every edge
as its neighbour does), which keeps a 10 kb poly-A run with 2,000 features
at ~50 ms instead of 1.4 s; past 4,096 combinations the groups are read one
at a time.

As drawn, an exclusive end sits outside an insertion right at it, as the
editor leaves one — `min(map(end - 1) + 1, map(end))`, which also keeps it
within the sequence (a replaced run that took the last base used to give
`length + 1`). That replaces offering both `map(end)` and
`map(end - 1) + 1`, which was itself a second reading per edge. What the
second answer used to catch by accident — a replace by shorter text that
overwrote one more base than the diff drew, `GAA` by `CA` drawn as `GA` by
`C` — is now an overwrite reading: a stretch that lost bases may also reach
up to `MERGE_GAP` past itself, like one that grew (#185), but not over the
origin of a circle, since what it deleted there would have moved the
origin. A start mapped to the new length of a circle is its origin whatever
the end does. A shortening replace across the origin is not read as an
overwrite (#190), and some such edits the per-edge answers happened to
accept are now marked.

Two consequences of the readings worth saying plainly. The overwrite reading
accepts an insertion of any length at an edge: an edge within `MERGE_GAP`
after an insertion may stay put however much was inserted, because a
replace by longer text does exactly that. And the "was" location shown for
a changed or removed feature is the diff as drawn, one valid drawing in a
repeat and not always the editor's.

## A replace by shorter text (#190)

Only stretches that gained bases were read as overwrites, so two shapes of
editor result were marked changed. A replace by shorter text that the diff
draws as a plain deletion (`GAA` by `A`, drawn as `GA` deleted, moves a
feature on the G to the new A) now reads like any stretch: every stretch of
edits is one, whether it gained or lost bases, and may reach `MERGE_GAP`
past itself. The cost: a deletion's edge may now sit up to `MERGE_GAP`
bases further on, where a replace of the deleted bases and those after it
by the latter would leave it.

The other shape is a replace by shorter text across the origin of a
circle. Its deletion runs over the origin, so the editor's result starts
with the bases right after the selection: the origin moved. Outside a
repeat the diff draws that as a deletion at the start and a replace at the
end, which merge into one stretch over the origin. In a repeat it often
draws an edit of the same cost somewhere else entirely (`TTCGTTCGTTCG`
with `[8, 13)` replaced by `C` is drawn as `TCGTT` deleted after the first
base), and in a circle of poly-A every feature was marked. So a circle
also gets one reading per turn `t`: the first sequence turned to start at
`t`, the bases that still start the second kept, the rest one stretch
overwritten as the editor does. A turn counts when the deletion starts at
or before the origin (`t + newLength <= oldLength`; one that starts after
it does not move the origin) and its stretch costs no more than the diff
as drawn plus an overwrite of `MERGE_GAP` bases — the most an overwrite
may reach past a stretch, and enough for the selection's first base to be
overwritten by a different one. A turn is a whole reading, never combined
with the others: it moves every base.

A stretch that lost bases still stops at the origin, since a deletion
starting at or running over it moves it (a turn's reading now). It may
reach past the origin only where the diff drew it over the origin
already, with the deletion wholly past it, and the bases before it drawn
shifted by all that was lost: then the editor's overwrite leaves the bases
after the origin in place, as the reading has it. Elsewhere that reading
would shift one stretch's edges and not its neighbours'.

Not covered: a circle whose untouched part is no longer than `MERGE_GAP`
reads as one stretch, which is never split at the origin.

## A lengthening edit near the origin (#191)

A stretch that gained bases reached over the origin of a circle with no
condition, but the editor does not put what it adds after the last base.
A replace inserts the bases it gained right after those it overwrote,
counted a turn on: one whose overwrite ends exactly at the origin puts them
at 0, and one over the origin puts them just after it. So an overwrite of a
stretch that grew now reaches the origin only past it, and only where the
diff drew every base gained before the stretch (the front of the second
sequence holds them), as for one that lost bases. Without that, an insertion
the diff drew at the end of the sequence read as an overwrite of the bases
after the origin and moved a start back a base (`CACACACACAGGCATTTTTT` with
`T` inserted at 18 accepted `[7, 17)` at `[6, 17)`), and an insertion
reaching the origin shortened a feature round the whole circle by the bases
added. The round-6 probe's false "unchanged" fell from 26/33/43 to 3/1/4 of
400 cases; what is left is #192 and the diff as drawn (an insertion drawn
at the origin, a second edit, puts a whole circle's start after it).
