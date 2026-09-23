# 30. Filter the enzyme list by how many times an enzyme cuts, not just "once"

Done, 2026-09-21. Asked for the same day: dual cutters are what a
diagnostic digest wants — BsrGI after an LR reaction, or checking a Golden
Gate assembly — and the panel could only narrow to single cutters.

- **A "Cuts" select** in place of the `singleOnly` checkbox
  (`src/app/state/cutFilter.ts`: `CutCountFilter` is `any | once | twice |
once-or-twice | up-to-three`, with the option label and the phrase a
  sentence needs beside each value, so the control and the prose cannot
  drift apart). `matchesCutCount` is the one place the counts are decided;
  it also refuses a zero, because the list is of enzymes that cut.
- **The two things written for the boolean follow it.** The footer reads
  "N of M enzymes cut twice" through `cutCountPhrase`, and the offer shown
  when nothing is ticked offers what the filter asks for — "Tick the 4
  enzymes that cut twice" — falling back to the single cutters when the
  filter is _any_, which is what it always did. The offer still ignores the
  name and supplier boxes (it answers "I have nothing on the map", not "the
  list in front of me"), and it is now capped at `MAX_SHOW_LISTED` like
  **Show listed**, since "3 times or fewer" over a REBASE table is hundreds
  of enzymes and more labels than the views can draw. The default tick on
  opening a document is untouched: single cutters, up to
  `MAX_DEFAULT_ENZYMES`.
- **Where the choice lives, which the item left open: a view preference.**
  `enzymeCutFilter` and `enzymeSupplier` are in `SharedState` and in
  `viewPrefs`, so they survive a tab switch and a reload — they say what
  the user is looking for in general, and a lab that buys from one supplier
  buys from it for every plasmid. The search box is _not_ persisted: it is
  a question about the list in front of you, and coming back to a filtered
  list with a forgotten word in the box would be a puzzle. A stored
  supplier code that the table in use does not have (a different import, or
  back to the bundled table) is ignored rather than emptying the list.
- **The larger want behind it is answered too, 2026-09-22.** A diagnostic
  digest is chosen by the _fragment sizes_ it gives, and the panel
  computed those only for the ticked enzymes; a cut count says nothing
  about whether the pieces can be told apart. Every row now carries the
  bands that enzyme alone would give (`src/core/analysis/gel.ts`), and an
  **Order** select sorts the list by how far apart they are, so _Cuts:
  twice_ plus _Order: band separation_ is the answer rather than the two
  steps towards it. On pBR322 that puts DrdI first at 3,948 + 413 bp and
  BtsI last, whose two cuts are 20 bp apart.
  - **A gel is what is modelled, not a fragment list.** Two fragments
    within 15 % of each other run as one band, so they are _written_ as
    one (`2,181 ×2`); under 100 bp a band may run off the end, and more
    than one fragment over 10 kb compresses near the well. They are the
    rules of thumb for a 1 % agarose gel and they are `GelOptions` rather
    than constants, so the judgement is in one place and a caller at
    another percentage can say so.
  - **`misleading` and `readable` are different questions**, which the
    first cut ran together and the browser caught: an enzyme that
    linearises a plasmid is not a diagnostic digest, but flagging it with
    a warning reads as "this enzyme is bad" when a unique cutter is the
    most useful enzyme there is. The ⚠ is for a lane that _hides_
    something — fragments running as one band, bands off the gel. The
    sort uses `readable`, which also wants two bands.
  - `compareDiagnostic` orders by readable, then the tightest pair of
    neighbouring bands, then fewer bands, then fewer fragments hidden
    under a shared band. The tightest pair is the measure because that is
    what "far enough apart to tell on a gel" means.
  - The profiles are computed for every enzyme rather than for the rows on
    screen, since the list can be ordered by them: 35.8 ms for a REBASE
    table of 1,581, paid once when a scan comes back rather than while
    anything is typed (`docs/perf-notes.md`). The **Fragments from ticked
    enzymes** section gained the same reading of the whole lane, which no
    single row can predict.
  - **And the lane is drawn, 2026-09-22** (`Gel.tsx`), which is what the
    note above asked for. The same numbers, not new ones: `migration` is
    written from the `maxResolved` and `minVisible` the warnings already
    use, so the picture and the prose cannot disagree about where the gel
    stops saying anything, and a band is the `GelBand` the text was built
    from. Mobility goes as the log of the length and anything off either
    end of that range is pinned to the well or the dye front. A ladder is
    chosen to span the sample — 100 bp when everything is small, 1 kb
    otherwise — since a lane with nothing to measure against is a picture
    rather than a reading. A short band is drawn faint, because a stain
    binds by mass and a 200 bp band beside a 4 kb one really is; the
    square root keeps that honest without making it invisible. Clicking a
    band selects that piece in both views, which answers the question the
    sizes cannot — which of these is the backbone.
    - SVG rather than canvas, unlike the sequence and the map: a dozen
      rectangles, not fifty thousand bases, and being in the DOM is what
      lets a band be a button and a test read the lane off without a
      rasteriser.
    - **Labelling a crowded lane took a look at a real one.** Pushing the
      numbers apart keeps every band named, which is what a three-piece
      digest wants; with pBR322's 35 single cutters ticked, sixteen bands
      sit at the foot of the lane and pushing them apart drew a fan of
      leaders across the gel. So the lane pushes only while a number stays
      within two line heights of its own band and otherwise drops what
      will not fit, as the ladder always does — the sizes are listed under
      the picture in any case, so a dropped label costs a glance and not
      the number. (The first cut computed which labels to drop and then
      drew them all anyway, which the browser caught and no test did.)
  - **A double digest is drawn beside the single ones, 2026-09-22.** Tick
    two or three enzymes and the gel has a lane for each alone and a last
    one (`Both`, `All 3`) for the digest together, which is how one is
    run and read: a band in the combined lane that is in no single lane
    is the piece between two enzymes' sites. `Gel` takes `lanes` now
    (PCR passes one). Only the last lane has its sizes written beside it —
    numbers between lanes would need the label room five times over and
    the gel would shrink until nothing on it could be read — so the
    others are named on hover and listed in a line under the picture.
    Lanes narrow from 42 to 32 units when they share the slab, a name
    longer than seven characters is cut with an ellipsis and given in
    full on hover, and the SVG's `max-width` grows with the lane count
    at the scale one lane had, so a wider gel is wider rather than
    smaller. Clicking a band in a single lane selects that enzyme's own
    piece. Past three the lane is a survey of cut sites rather than a
    digest anyone runs, and it stands alone as before.
  - **And pairs are ranked, 2026-09-22** (`bestPairs`): with the list
    ordered by band separation a **Double digests** section offers the
    five best pairs of the listed enzymes cutting ≤ 3 times, judged by
    `compareDiagnostic` on the digest with both, so every filter narrows
    the pairs too; **Tick both** ticks that pair alone and the gel above
    draws it beside each single lane. A pair whose cuts are all one
    enzyme's own is left out (it is that enzyme's digest). Quadratic, so
    at most 120 are paired, fewest cuts first — 14 ms
    (`docs/perf-notes.md`, which has how 111 ms became that).
  - **The ranking was capped because of it.** The first list of pBR322
    pairs was led by 4,259 + 102 bp — 41 times apart and a band nobody
    would see — because `compareDiagnostic` rewarded the raw ratio. Now
    separation counts up to `plenty` (2×, as distinct as bands get),
    then the smallest band up to `bright` (500 bp, since stain goes by
    mass), then the raw ratio. That moved the single-enzyme order too:
    on pBR322 _Twice_ now reads HincII (3,254 + 1,107), BstAPI, DrdI
    (3,948 + 413), where DrdI led before. Both are `GelOptions`.
  - Not yet: the gel is one percentage; the ladder cannot be chosen; the
    order cannot be reversed; and the pairs are among the listed enzymes
    only, so "a partner for EcoRI" means filtering down to it and its
    candidates by hand.
- The control took a row of its own in a 330 px sidebar (the buttons wrap
  below it); on a sidebar widened past ~430 px they share a line again,
  which is item 28 paying for itself.
