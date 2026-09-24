# 33. File ▸ Compare with… another file on disk, or another tab

Done, 2026-09-21; asked
for by items 22 and 24 and wanted by item 25. The diff engine has been
there since item 21 and the review since item 22, but both could only look
at two versions of one document. The question a scientist asks is about
two files: is this the same construct as the one my colleague sent, and if
not, where do they part company. A map that looks right is how a wrong
plasmid gets used.

- **Nothing is opened, written or stored.** The file is read, diffed and
  dropped (`src/app/compare.ts`, `SharedState.comparison`), so it is safe
  to point at a colleague's copy; the picker is the same `openWithPicker`
  as Open file, with the toolbar's own hidden input as the fallback where
  there is no File System Access API.
- **The review body is shared with the download review** — `DiffReview`
  (`src/app/components/`), lifted out of `SaveReviewDialog` — so the
  summary line, the hunks drawn by the same renderer as the sequence view
  and the named feature changes of item 27 cannot drift apart between the
  two dialogs. `CompareDialog` diffs directly rather than through
  `editDiffBetween`, whose one-slot cache belongs to the sequence view's
  marks and would be evicted on every render.
- **Features had to stop being matched by id**, which the first test
  caught: two files parsed separately give every feature a fresh id, so
  `diffDocuments` called all fifty of pBR322's features removed and added
  again. Leftovers no id matched are now paired by what they are — type,
  name, strand, qualifiers and mapped location, bucketed so it stays
  linear (`pairByContent`). That is the better answer inside one document
  too: a feature deleted and typed back identically is no longer two lines
  of noise. A feature that really differs is still reported both ways,
  since without ids nothing says it is the same one edited.
- **Two ways it reads oddly are said out loud.** A circular plasmid
  written from another origin has nothing in common with this one as text,
  so the dialog says so when both are the same length and the diff came
  out coarse; two unrelated sequences come out as "too different to follow
  in detail", which `describeEditDiff` already knew how to say.
- **The origin-rotation case is fixed, 2026-09-22**, by item 22's checksum.
  `alignToDocument` (`src/core/checksum/align.ts`) works out how the other
  file's copy has to be turned before it is diffed — rotated to another
  origin, read from the other strand, or both — and the dialog says what
  it did, because the differences shown are then against the file turned
  rather than against the file as written. Exactly, when the two
  `cdseguid`s agree: the same molecule for certain, and the rotation is
  then one `indexOf` in the sequence doubled. Otherwise by voting on where
  a handful of shared 32-mers land, which is the case anyone actually
  compares — the same plasmid, from another origin, with an edit in it, so
  no checksum agrees. It takes a majority of the anchors that voted and at
  least two, so one chance stretch in common moves nothing. The old "set
  the origin and compare again" note is now only for the case where
  nothing long enough is shared to line anything up.
- **`Alt+K` came with #34.** **Any tab, opening the other side, marks
  in the views and stepping, 2026-09-24 (#37).** With another tab open,
  Compare with… first asks what with (`CompareChooser`, in the toolbar
  beside the picker's fallback input): the other tabs by name, not the one
  in front and not the Bench, or **A file on disk…**; with none it is the
  picker, as before. `SharedState.comparison` became a `Comparison` union,
  `choose` then `review`, so every "a modal is up" check held without
  change. A tab is compared as it is now; the dialog stays a modal and a
  tab switch still takes it away.
  - **The review keeps its source** (`ComparisonSource`): the `File` itself
    for a file, so **Open** runs `openFile` and gets exactly what File ▸
    Open gives — the origin, `findOpenCopy`, the working-copy fork — rather
    than a tab built from the parsed document, which would have had no
    origin to protect. **Go to** is `activateDocument`.
  - **Mark in the views** is a fifth baseline, `'compared'`, over
    `DocumentState.compared` (the other side as the dialog lined it up, via
    `applyAlignment`, and its name). Per document, like `markedDoc`,
    because a comparison is between two particular documents; the choice is
    shared, so a tab without one reads `'compared'` as `'opened'`
    (`effectiveEditsBaseline`) and the Edits menu shows that rather than a
    "Compared with" naming nothing. Not stored with the document or in the
    view preferences, where it comes back as `'opened'` as `'marked'`
    does: the other side was a file read once or a tab of this session.
  - **Next / Previous change** (`Alt+N`, `Alt+Shift+N`, both free) step
    through `changeStops` of the current diff, whatever the baseline: each
    mark's span and each deletion as a caret, ordered by start then end, so
    a caret on a mark's start goes to that mark and a deletion there comes
    first; on a circle a mark to the end and one from 0 are one wrapping
    stop. `stepChange` compares the selection in the same order and wraps.
    A feature changed without its bases is not a stop: the stops are the
    marked bases, and the feature list already goes to a feature.
    With nothing to step to the keys are not taken, so the browser keeps
    them.
