# 104. The open's last long task, the autosave in the first scroll, and the heap

Issue #278. Status: done (1.17.x), one part left for a follow-up.

## What was asked

After #274-#276 (v1.17.2) the Enzymes list of a 4.64 Mb sequence is drawn
3.5x sooner, and the work that used to trail behind it now comes together
in the first second after the file is picked. Three things: a 290-375 ms
main-thread task about 0.9 s after the open at 4.64 Mb, inside the first
scroll; the autosave in that scroll (at 1 Mb its own 55-63 ms task); and the
JS heap at the end of an open, which read higher with each release (104,
121, 136 MB at 4.64 Mb for 1.17.0-1.17.2).

#272 (item 103) had since moved the autosave's GenBank text into a save
worker, which took the save out of the 1 Mb scroll but left its last
pieces (reading the text back, the IndexedDB put) at open+1.5-1.7 s at
4.64 Mb, later than before and so inside the bench's scroll.

## What the three turned out to be

**The long task** was the restriction scan's receive and the Enzymes tab's
first render of it, in one task: `unpackCutSites` turning 446,000 packed
sites into objects, `unpackEnzymeDigest` copying every enzyme's fragment
lengths into an array, the panel grouping every site by enzyme again,
`gelProfile` for every enzyme (a sorted copy of its lengths and its bands),
a `Set` of the 42,000 sites Dam/Dcm would block, and the collector, 100-150
ms of the 305-320 ms, set off by all those allocations at once. The
autosave was no longer in it (item 103).

**The autosave in the scroll** was the save's request to the worker and,
130 ms later, the text read back and the put: the request went out at the
first idle callback after the checksum, which at 4.64 Mb is the end of the
list's busy stretch, just before or as the scroll starts.

**The heap** is not held, it is not yet collected. `open-scan.ts` now reads
`usedJSHeapSize` after a forced collection as well: at 4.64 Mb 55.3 MB in
1.17.1 and 55.5 MB on main, at 1 Mb 20.1 and 20.2 MB, against 125-131 MB
before the collection. A heap snapshot after the collection is the
sequence once (4.64 MB, the leaves of its rope are slices of one string),
the 446,000 sites as objects, the arrays of them the store and the panel
keep, and the bundle's source (6.8 MB); nothing of an earlier open. What
grew between releases was the garbage the open leaves behind, which the
collector reclaims when it next runs.

## What was done

**The scan is unpacked a slice at a time, grouped on the way**
(`unpackScan` in `analysisProtocol.ts`). The client turns the sites into
objects 50,000 at a time and yields between slices and once after the
last (`yieldToPage`: `scheduler.yield` where there is one, else the next
task), so the render that follows is a task of its own. While it goes it
puts each site into its enzyme's group with its host marks (one typed
array per enzyme, sized by a first pass over the packed heads), which it
hands over as `EnzymeDigest.byEnzyme`; the panel takes the groups from
there and only groups the sites itself (`sitesByEnzyme`) for a result
carried through an edit. The digest's lengths stay views into the
transferred buffer (`NumberList`), so `gelProfile` takes any iterable.

**Each enzyme's lane is worked out when first asked for.** The panel's
entries carry `profile()`, memoised: a row on screen, a tick, the pair
finder or the band sort asks for it. In name order, the default, the first
render works out the lanes of the rows in the window and the ticked
enzymes, not of all 127 (or a REBASE table's thousands). Whether an enzyme
cuts at all, which the reversed band sort needs, is `cutting`.

**Blocked cuts are read off the marks.** `cuts(entry)` keeps a site whose
marks do not meet the document's methylation, instead of looking it up in
a set of blocked sites built on every open.

**The autosave waits for the input to be quiet** (`inputQuiet.ts`). Before
it asks the worker for the text and again before the put, an ordinary
save waits for an idle moment after a second (`QUIET_MS`) with no wheel,
scroll, key, press, drag or touch (a pointer passing over does not count),
and at most five seconds (`MAX_QUIET_WAIT_MS`) each time, so a long
session of scrolling does not leave an edit unsaved for long. Listening
starts when the app loads, on `window` in the capture phase, so a scroll of
any element is heard. The wait replaces #276's idle callback, which it
includes. `PersistenceService` takes the wait as its third argument, so a
test can hold a save at either point.

What was kept: the flush on leaving (`useFlushOnLeave`) waits for nothing,
as before; a save it overtakes while waiting finds out at the check after
the wait (or, as before, inside the put's transaction) and writes nothing;
saves still run one after another, each reading the tabs when its turn
comes, so an edit made while one waits is written by the next.

## Why not

- **The put in the save worker.** It would take the 33-46 ms clone of the
  text off the main thread, but needs a second Dexie connection and an
  order between the two threads' writes. With the put after the input is
  quiet, it lands after the scroll (open+6.3-6.5 s in the profiles), where
  nobody is waiting on a frame, so nothing more was needed.
- **Smaller slices.** At 10,000 sites a slice the long tasks were the
  same length: what is left in them is not the unpacking but a collection
  (below).
- **The lanes in the worker.** They depend on the gel options, which are
  the user's; taken as asked for, the first render needs a dozen of them.

## Tests

`analysisClient.test.ts`: `unpackScan` gives back the sites and digest
that went in, groups them as `sitesByEnzyme` does with the same site
objects, pauses between slices and after the last (not at all for one
slice), and gives the same whatever the slice. `EnzymePanel.test.tsx`: the
rows and the whole panel read the same from the unpacked digest as from
the worker's digest and from the sites alone, in band and name order.
`inputQuiet.test.ts`: the wait resolves at once on an untouched page,
waits out each input, counts the input kinds and not a hover, gives up at
the longest wait, starts over on input during the idle wait; the page's
own hears a scroll of any element. `autosaveWorker.test.ts`: the save
waits before the request and before the put; the flush on leaving does
not wait, and the save it overtook at either point writes nothing older;
an edit made while a save waits is written by the next save.
`persistence.test.ts`: the idle callback is asked for again before the put.

## What is left

At 4.64 Mb the receive is now two tasks of 54-106 ms (from one of 305-320
ms), at 1 Mb one of 52-68 ms (from 101-136 ms). Most of what is left is one
collection, 35-80 ms, set off while the 446,000 site objects are made,
whichever slice it falls in. Making fewer objects is a change of the
analysis state: keep the sites packed and make an enzyme's site objects
when they are asked for (the ticked enzymes for the views, a row on screen,
the cloning tab). That is for a follow-up issue.

See `docs/perf-notes.md` (#278) for the measurements.
