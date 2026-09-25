# 49. The Cloning Bench

Done, 2026-09-24 (#70; `src/app/components/Bench.tsx`, `BenchProduct.tsx`,
`src/app/state/benchSettings.ts`). The headline of 1.5: the Cloning tab
split in two, by what each part of it works on.

By 1.4 the sidebar's Cloning tab held a digest, the shelf, six reactions,
gels, warnings and the insert-primer design in one 300 px column. Worse
than the crowding was the structure: Gateway, Gibson and the In-Fusion
design pick _other_ tabs, and the insert design made you leave the tab to
select the insert and come back. Item 3 had already drawn the line the
split follows:

- **Bound to the front document:** Digest, PCR, Mutate. They draw on the
  map and the sequence view through the preview channel (item 26), and a
  fragment is picked by clicking it there, so they need the views beside
  them. They stay in the sidebar.
- **Across documents:** the shelf, Ligation, Golden Gate, Gibson (with the
  In-Fusion/NEBuilder design) and Gateway. They barely look at the front
  document. They moved to the Bench.

## What was decided, and why

- **The Bench is a tab, not a modal.** A modal hides the views and blocks
  "open another file, cut, shelve, come back", which is the whole
  workflow. The tab strip already had one tab that was not a document, the
  file list; the Bench is a second. `EditorState.front` says which of
  document, files and bench is in front, replacing "no active document"
  meaning the file list. It is fixed beside **Files**, with a count of the
  shelf's parts, and stays in the strip while the shelf holds anything, so
  it can be reached with every document closed. Left in front, it comes
  back in front after a reload (a sentinel in the last-document slot).
- **The sidebar picks one of Digest, PCR and Mutate.** The plan kept the
  digest always above a PCR/Mutate picker. But there is one preview
  channel, and the digest gave it up whenever PCR or Mutate was open;
  with the joining reactions gone, one of those two would always have
  been open and the digest would never have drawn. As a third choice it
  has the channel whenever it is shown. The shelf becomes one line with a
  link to the Bench, so a fragment is still seen landing.
- **The panels' settings live in the store.** Each reaction kept its ticks,
  enzymes, picked tabs and typed name in component state. That was fine in
  a sidebar that never unmounts on a tab switch; the Bench unmounts
  whenever a document comes to the front, and would have lost them every
  time. So `BenchSettings` holds them, and since they were in the store
  anyway they are remembered with the view preferences, best effort, like
  the rest. A stored entry is normalised field by field, and an older
  entry's single `cloningReaction` goes to whichever of the two places now
  shows the reaction it named. Parts are named by id (a tab's document id,
  a shelf part's id), so a tick against something gone is never looked up.
- **The shelf has an undo of its own, and nothing else on the Bench does.**
  Undo in the app belongs to documents, and the Bench changes no sequence:
  what it makes opens in a tab with its own history, and most of what it
  does (ticks, picks, a flip) is undone by doing it again. First
  recommended without undo, and questioned: **Remove** and **Clear shelf**
  can throw away fragments that took a digest in a tab since closed, and
  nothing brought them back. So shelf changes are steps (`changeShelf`,
  labelled "Remove pUC19 BamHI fragment"), undone with the toolbar's Undo
  and Ctrl+Z while the Bench is in front — where there is no document for
  them to be confused with. Changes made from the sidebar (**Add**,
  **Shelve**) are steps too; a restored shelf is where the history starts.
  Reaction settings are settings, not history. The shelf's property test
  models undo and redo against a plain stack.
- **The insert is picked on the Bench.** The In-Fusion/NEBuilder design
  offers the template tab's selection, each of its features (by
  `featureExtent`, now in `@/core`, which the map, Find and
  `selectFeature` had each written out), or all of a linear template.
- **The product is drawn beside the reaction.** The third column shows the
  product's map — first as `exportMapSvg` drew it, an image in print colours;
  on review the same day, with the editor's own canvas renderer instead
  (`DiffMap`, the save review's read-only map, which takes cut sites and a
  size now), in the app's theme and with the check digest's cuts marked. The
  full interactive map was not the answer: the product is not a document, so
  there is nothing to select or edit; hover and zoom there are #80. Before
  that it was drawn with `exportMapSvg` (25 ms for pBR322, and only
  when the product changes), and a check digest: every enzyme that cuts
  the product 1–6 times, with its methylation allowed for, ranked by
  `compareDiagnostic` as the Enzymes tab's band-separation sort is, the
  clearest first, and its lane on the gel. Scanning the product with the
  bundled table takes 4 ms at 4.4 kb and 9 ms at 13 kb, so it is done on
  the main thread (`docs/perf-notes.md`). An uncut circle is not drawn as a
  lane: supercoiled DNA does not run at its size. Each panel sends its
  product there through a portal (`BenchProductSlot`), so it keeps working
  its product out itself and still renders alone in tests.
- **No Bench on the phone reader**, which is for reading.
- **Add says it worked, and that the piece is already there** (#81, user
  feedback 2026-09-24). With the shelf on another tab an Add changed
  nothing in sight, and a double click shelved a piece twice unnoticed. A
  second copy stays allowed, since a tandem insert is a real assembly and
  the shelf is a list, but it is made visible rather than refused: the row
  says **On shelf ×n** and its button **Add again**, Add reads **Added ✓**
  for 1.5 s (with a polite live region), and the Bench tab's count pulses
  when a part arrives, not when a stored shelf is restored at load.
  `copiesOnShelf` matches a part by source, range and the set of its
  end enzymes, so a part turned over or dephosphorylated since still counts.

## Usage events

`cloning`/`bench` (once per visit, `tab` or `link`: which way people
reach it), `cloning`/`shelf-undo` and `cloning`/`shelf-redo`.
