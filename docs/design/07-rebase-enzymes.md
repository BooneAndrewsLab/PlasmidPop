# 7. Enzyme table from REBASE

Done, as an import rather than a
bundle. **Import a REBASE table…** at the foot of the Enzymes tab links
straight to `rebase.neb.com/rebase/link_withrefm` and takes the file back
as a drop or a file picker; the parsed set replaces the bundled 127
enzymes, survives a reload, and **Go back to the bundled table** undoes
it. A **Sold by** filter appears with it, and an enzyme's suppliers,
isoschizomers and methylation site are in the tooltip on its recognition
sequence.

- **Why an import and not a bundle.** Every REBASE data file says
  `Copyright (c) Dr. Richard J. Roberts, <year>. All rights reserved.`
  (verified in the file itself; the CC BY-NC that search engines offer up
  covers the _NAR papers_). `rebase.neb.com` sends no
  `Access-Control-Allow-Origin`, so the app cannot fetch it either, and a
  proxy or a build-time download would just make us the redistributor.
  The user's own copy in the user's own browser is none of those things.
  If a bundle is ever wanted, ask Dana Macelis, who runs REBASE
  distribution, copying Rich Roberts (addresses on `rebase.neb.com`); the
  ask that gets a yes keeps REBASE's terms on the data rather than
  putting it under our MIT grant.
- `parseRebaseWithRefM` (`src/io/rebase/withrefm.ts`) reads the
  `name/isoschizomers/site/methylation/…/suppliers` records and the
  supplier key out of the header. REBASE's cut notation already matches
  ours — `G^AATTC` is 1/5, `GGTCTC(1/5)` is 7/11 — so the conversion is
  nearly a straight read. Of 6,114 records, 1,581 become enzymes.
  Left out: no cut position determined, the 27 double cutters (BcgI and
  kin, which `Enzyme` cannot hold), methyltransferases, and 27
  modification-dependent enzymes whose site carries under six bits
  (`MIN_SITE_BITS`) — REBASE gives AbaSI the site `C` because what it
  cuts is a hydroxymethylcytosine, and taking that literally would have
  it cutting at every C. The line falls just under CviJI's `RG^CY`, a
  real frequent cutter, which is kept.
- The active set is module state in `restriction.ts`
  (`activeEnzymeSet`/`setActiveEnzymeSet`), because the alternative is
  threading a list through every caller. The worker keeps its own copy,
  installed by a `setEnzymes` message that `AnalysisClient` re-sends
  whenever it starts a worker. It is stored parsed, in Dexie version 3's
  `enzymeSets` table, and read back before the documents so the first
  scan already uses it.
- **The size is felt.** `findCutSites` now matches once per distinct
  recognition sequence rather than once per enzyme (1,581 enzymes, 346
  sites), which took a pBR322 scan from 134 ms to 82 ms; a full scan
  returns 63,053 cut sites, and allocating and cloning those is now the
  larger half (`docs/perf-notes.md`). `EnzymePanel` lists at most 200
  rows and 12 cut positions each — rendering all ~1,500 rows locks the
  page up for seconds, which is not theoretical, it happened.
- Fixed along the way: the bundled table had **DrdI** as a blunt cutter
  at 6/6; REBASE has `GACNNNN^NNGTC`, a 2-base 3′ overhang at 7/5. The
  hand-typed table was wrong, and the palindrome-symmetry test could not
  see it because 6+6 and 7+5 both sum to the site length.
- Not yet: Dam/Dcm sensitivity (REBASE's `<4>` is where the enzyme's
  _own_ methyltransferase modifies the site, not what your _E. coli_
  strain does to it — the Dam/Dcm table is a separate dataset);
  isoschizomer grouping in the list; double cutters; narrowing the scan
  itself to the supplier filter or the ticked enzymes.
- The rough edges a table imported left behind were cleared on
  2026-09-19:
  - The list is windowed instead of cut off at 200 rows. It scrolls
    inside the panel and only the rows over the viewport plus 600 px
    either side are in the DOM, 22 to 34 of them on pBR322
    (`useRowWindow` in `src/app/components/`, which measures each row as
    it appears because a row is as tall as its cut positions need;
    `docs/perf-notes.md`). Everything below the list is in view again
    rather than a thousand rows down. It costs two things: a browser page
    search does not see a row scrolled out of sight, and **Show listed**
    asks for a narrower list past 200 enzymes rather than ticking more
    labels than the views can draw.
  - **Sold by** has the controls row to itself, and the `<select>` has
    the panel's own styling, which it never had.
  - Opening a document ticks the single cutters only when there are at
    most `MAX_DEFAULT_ENZYMES` (50) of them — pBR322 has 35 with the
    bundled table, about 90 with REBASE. Past that nothing is ticked and
    the tab offers "Tick the N enzymes that cut once".
  - The import's file input has an `accept` list and the drop zone names
    the file. It is a hint, not a gate: "Save link as" can leave the
    download without an extension, and the picker's All files entry is
    the way out (said so in the guide).
  - `getEnzyme`'s fallback to the bundled table is a map built beside it
    rather than a linear scan.
