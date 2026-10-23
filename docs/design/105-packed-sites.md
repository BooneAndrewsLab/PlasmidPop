# 105. The cut sites kept packed

Issue #281. Status: done (1.17.x).

## What was asked

After #278 (item 104) the receive of a 4.64 Mb scan was two tasks of
54-106 ms instead of one of 305-320, and most of what was left in them was
one collection of 35-80 ms, set off while `unpackScan` made the 446,000
`CutSite` objects. Smaller slices did not help. Keep the sites packed and
make an enzyme's site objects only when something needs them, without
changing what any consumer of the sites shows.

## What was done

**The analysis state's `cutSites` is a `CutSiteSet`**
(`core/analysis/cutSiteSet.ts`), read by enzyme rather than walked:
`of(name)` (one enzyme's sites), `pick(names)` (the sites of a set of
enzymes, in the scan's order, which is what `filter` on the array gave),
`count`, `counts()`, and `all()`. Two kinds:

- `PackedCutSiteSet` over the worker's transferred `Int32Array` (four
  integers a site). Built in one pass over the integers: a counting sort by
  enzyme into three typed arrays (each site's index, its cut and its host
  marks, grouped by enzyme), so no object is made at all. An enzyme's
  objects are made the first time `of`, `pick` or `all` asks for them and
  kept from then on, so a site is one object however it is reached. `pick`
  of one enzyme is that enzyme's list; of several it walks the packed heads
  once with a cursor per enzyme, which gives the scan's order back.
- `cutSiteSetOf(array)` over sites that are objects already: a result
  carried through an edit, `findCutSites` in tests. `setAnalysis` and
  `setCutSites` take either.

Every path that answers a scan goes through the same packing: the worker,
and the client without a worker (`handleAnalysisRequest` inline), both
answer `PackedCutSites`, and `unpackScan` makes the set.

**`EnzymeSites` reads off the packed arrays.** An enzyme's entry in
`EnzymeDigest.byEnzyme` is now `count`, `cuts` and `host` (views into the
grouped typed arrays), `site(i)` and `sites()`. The Enzymes tab needs
objects only for the sites a row on screen lists (the first twelve, through
`site(i)`); counts, the cut-count filter, the pair finder, the open cuts
after methylation and the lanes read `count`, `cuts` and `host`. A carried
result's groups (`sitesByEnzyme`) have the same shape over arrays.

**The consumers**, each with what it reads:

| Where                                   | Before                         | Now                                      |
| --------------------------------------- | ------------------------------ | ---------------------------------------- |
| Sequence view, map (`*View.tsx`)        | `cutSites.filter(ticked)`      | `cutSites.pick(ticked)`                  |
| Cloning tab                             | `cutSites.filter(ticked)`      | `cutSites.pick(ticked)`                  |
| Exports (`visibleCutSites`)             | `cutSites.filter(ticked)`      | `cutSites.pick(ticked)`                  |
| Default ticks (`applyAnalysis`)         | digest counts, else a count    | digest counts, else `counts()`           |
| Carry through an edit (`carryAnalysis`) | every site                     | `all()`, then a set over the moved sites |
| Enzymes tab digest of a carried result  | `enzymeDigest(sites)`          | `enzymeDigest(sites.all())`              |
| Enzymes tab rows, filters, pairs, lanes | `sites.length`, `sites[i].cut` | `count`, `cuts[i]`, `site(i)` for a row  |

What takes `CutSite[]` further on (the renderers, the SVG exports,
`cuttableSites`, the digest) is handed the picked array, as before.

**What is made at open.** In the default state (the single cutters ticked
when there are at most 50 of them, the list in name order), the objects
made are the ticked enzymes' sites for the views and the first twelve sites
of each row the list draws. On the bench's sequences nothing is ticked, and
the Enzymes tab makes 308-324 objects at 300 kb to 4.64 Mb, against 446,000
at 4.64 Mb before.

**What it did.** At 4.64 Mb the receive and the first render are one task
of 72-85 ms with no collection in it (from two of 54-113 ms holding 44-72
ms of collection), the busy stretch 138-155 ms (from 238-288), the list
drawn 140 ms sooner, and the heap after a forced collection 8 MB smaller.
What is left in the task is the packed set's sort by enzyme (16-19 ms) and
the panel's first render.

**`unpackScan`** no longer works in slices: the counting sort makes no
objects, so there is no collection to spread out (16-19 ms at 4.64 Mb in
an unminified build). It still lets the page go on once before it answers a scan of
more than `UNPACK_SLICE` sites, so the Enzymes tab's first render is a task
of its own.

## Why not

- **Lazy objects behind an array** (a `Proxy`, or a getter per index): every
  consumer would keep its code, but each read would go through a trap, and
  the panel's loops over every enzyme's sites would make all the objects
  anyway.
- **The carry in packed form.** An edit moves every site, and a carried
  result is the edit's to make; it still makes every object, as it did. It
  is not in the open.

## Tests

`packedSites.property.test.ts`: random sequences with Dam, Dcm and a few
enzymes' sites planted and turned so sites straddle the origin, both
topologies, all the bundled enzymes or a subset: what the packed set gives
picked, per enzyme, counted and whole, asked in any order and after a row's
odd `site(i)`, is `findCutSites`' and the set over objects'; its groups are
`sitesByEnzyme`'s with the digest's marks; the open cuts read off the
packed cuts and marks are `cuttableSites`' for any host; a site across the
origin and one inside Dam's GATC read as `findCutSites` marks them; the
client without a worker gives the same. `analysisClient.test.ts`: one site
is one object whether reached by `site(i)`, `sites()`, `of` or `all`, and
the page is let go on once for a large scan only.

See `docs/perf-notes.md` (#281) for the measurements.
