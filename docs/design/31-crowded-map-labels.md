# 31. A crowded side of the map places its labels outrageously

Fixed
2026-09-21. Reported 2026-09-21 with a screenshot: pBR322 zoomed in, the ring
a shallow arc down the right of the pane, and the cut sites of 3,400–4,300
labelled in a column far out to the left — `SspI (4,171)`, `ScaI (3,847)`,
`PvuI (3,737)`, `ZraI (4,287)`, `PstI (3,612)`, `AseI (3,539)`,
`BsaI (3,428)` — with long leaders fanning across the gap and crossing each
other, and the labels not in the order their ticks are. Item 29 fixed labels
landing _on top of_ one another (0 collisions in 128 renders); this was the
cost it paid for that, and it showed worst zoomed in, where one crowded arc
holds every label at once.

- **The slide is charged for now.** `layoutLabels` let a label slide
  `lineHeight * 16` along the ring — about 190 px, most of a pane — rather
  than be left out, and nothing charged for the distance. It is eight line
  heights (~110 px), so a label that cannot be reached in a glance from its
  own tick is left out instead and counted in the `+N` line, which is what
  item 29 made affordable. A pixel cap rather than an angular one on
  purpose: zoomed in the radius is large, so the same slide is a small
  angle, and a whole crowd could slide the same way with the angular
  spacing never looking wrong — which is exactly what the screenshot was.
- **The ring's order is kept and no leader crosses another.** Both of the
  note's candidate rules, in the end, and it took a second report to learn
  why both are needed. The first cut tested only the leaders — a slot whose
  line back to the elbow would cut across one already drawn is refused
  (`crossesRun`, filed by the stretch of ring a leader runs over and
  compared a turn either way, because the two sides meet at 12 o'clock;
  this needed the elbow radius, which `layoutLabels` was not told, so
  `elbowRadius` is an option now). That left `SspI (4,171)` drawn _above_
  `ZraI (4,287)` on the left of the ring, 88 px from its own tick, with
  nothing crossing: a label sitting at its own anchor has only an 8 px
  radial stub for a leader, and another can slide clean past it without
  touching anything. Crossing is a consequence of breaking the order, not
  the same thing as it. So a slot must also lie between the slots its
  neighbours along the ring took (`rung`, `slots`). Over the harness's 268
  renders that is **337 pairs out of order before, 39 after**, and it is
  measured now rather than reasoned about — a third measure, read off the
  drawn leaders, since an inversion shows up in neither the collision nor
  the crossing count.
- **They are rules and not laws.** Refusing outright cost names that
  nothing else would have lost: on the bundled pBR322 the SVG export went
  from dropping none to dropping two, because `bla` and the
  `beta-lactamase` mat_peptide inside it sit at nearly the same angle and
  one of them has to give way. So a label the rules refuse is offered what
  room is left in a second pass, with a much shorter slide
  (`rescueShift`, two line heights by default): a pair that meet beside
  their own features is a blemish, a missing name is not, and a label that
  has to travel _and_ break a rule to find room is the tangle this was
  about. Over the 268 renders that pass is worth 53 labels for 14 crossing
  pairs and 39 inversions, none of them more than two in one render;
  letting it slide as far as the first pass does would buy 264 more labels
  for 289 crossings and 398 inversions, which is the disease.
- **The export buys the long leader the screen refuses**
  (`labelShiftLines`, 16 for `exportMapSvg`, which sets `rescueShift` to
  the same budget). A figure has no pointer, so a name the ring has no room
  for beside its own feature is lost rather than one hover away — the same
  reason the export grows its canvas instead of dropping, and the reason it
  will take a long leader and a broken order rather than leave one out.
  With it the bundled pBR322 exports with nothing left out as before, at
  any size, with or without its cut sites; the absurd case of every feature
  named drops 28 where it dropped 38.
- **Measured by rendering, as item 29 was**
  (`src/view/circular/labelCollisions.test.ts`). Two measures were added,
  since none of this overlaps and the collision count could not see it: the
  length of a leader's run from the elbow to its label, and the number of
  pairs of runs that cross, both read off the drawn SVG. So were the
  viewports the report was taken in — `fitRange` on four arcs of each
  molecule at two pane sizes, which is what a double-click on a feature and
  the **Sel** button do. Over 268 renders: **1,052 crossing pairs before,
  14 after**, **337 pairs out of order before, 39 after**, longest leader
  **209 px before, 110 after**, and the cost is 5,195 labels drawn before
  against 4,665 after (the rest are in the `+N` line and one hover away).
  Collisions stay at 0. The whole map got _faster_ — 6.7 ms to 3.5 ms in
  the absurd case — because the shorter slide halves the slots a crowded
  label tries and the order rule cuts the search short as soon as a
  neighbour's slot is reached (`docs/perf-notes.md`).
- **A crowd is spread about its centre** (#24, 2026-09-24). Placed greedily
  in rank order, the highest-ranked of a bunch kept its own anchor and the
  rest worked around it, so a crowd against 12 or 6 o'clock, where a side
  ends, lost its pole-most labels. `spreadTargets` runs first: along each
  side and within each stretch of ring the canvas shows, the one-dimensional
  cluster spread — neighbours that would crowd each other form a cluster,
  a cluster is centred on its members' anchors and held inside the
  stretch, clusters that then touch merge, until none do. The spacing two
  neighbours need is estimated from where they are (a line's height where
  the ring runs steeply, the pole-ward label's width where it runs flat);
  it is only where the slot search starts, and every box is still tested.
  Three things it took to make it pay:
  - **An overfull crowd is trimmed first.** Spreading room for labels that
    will be left out anyway pushed the survivors away from their features
    and lost names on small full-view panes (up to 11 in a render). A
    cluster longer than its stretch, or one that would push a member past
    `maxShift`, loses its lowest-ranked tenth from the spread, a round at a
    time (at most 16); they are still offered a slot afterwards.
  - **The rescue pass keeps the ring's order.** With the crowds spread, a
    rescue free to break it bought ~270 names for 136 crossings and 339
    inversions; kept to the order it still buys most of them.
  - **Ties are broken by text, never by id.** Measured twice, the same code
    gave 5,980 and 5,993 labels: a parsed file's feature ids are random,
    and so is the order features with the same start come out of the set.
    `tie` is used for the ring's order too, which had broken ties by id
    since item 31; a document is now laid out the same every time.

  Over the harness's 208 renders: **5,769 labels drawn before, 5,981
  after** (+212, dropped 3,752 → 3,540), **crossing pairs 21 → 0**,
  **inversions 46 → 3**, no render losing more than one label, longest
  leader 109 → 110 px, collisions 0. It costs time, measured in
  `docs/perf-notes.md`: 1.0 → 1.4 ms for pBR322 with every feature named,
  4.0 → 6.4 ms with every cut site of every enzyme, both well inside a
  frame. The first cut re-centred a whole cluster at every merge and took
  38.7 ms there; a cluster now keeps its span and the sum it is centred
  on, so a merge costs nothing per member.

- Not yet: item 29's second label ring (#23), which is what would raise how
  much a crowded map can hold rather than how well it shares its room.
