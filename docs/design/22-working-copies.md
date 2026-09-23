# 22. Working copies: the opened file is never written to

Done,
2026-09-20, asked for because a PI was uneasy that a user can edit a
plasmid and wanted to know a file had not been quietly altered. A
`DocumentState` records the file it was read from (`origin`: that file's
name and the document exactly as read) and whether it has been forked off
it (`derived`). The first edit of a document with an origin forks it in
`apply`: the `fileHandle` is dropped, so `save()`'s write-back path cannot
be reached for that file. Two conditions, deliberately separate. `derived`
latches and is never cleared, because the handle cannot be got back. The
copy's _name_ is decided per edit instead — a working copy never carries
the origin's name (`copyNameFor` in `src/app/state/derive.ts`: `pBR322` →
`pBR322 copy`, numbered when another tab has it, never stacking
`copy copy`) — because the name lives in the document and so travels with
undo: undoing to the start brings the original's name back, and the next
edit has to take a copy name again. A rename is the user naming it
themselves and keeps their name. Opening the same file
again no longer reuses a derived tab (`findOpenCopy`), so the original
comes back in a tab of its own to compare with. The bundled example is
opened by `openExample` with an explicit `origin: null`: its file name is
there to save under and names nothing on the user's disk, so editing it
forks nothing. The origin and the flag
survive a reload: they are stored beside the document in Dexie (optional
`origin`/`derived` on `StoredDocument`, non-indexed, so no schema version
bump), and autosave deletes the stored handle of a derived document that
has no handle in the store, so a reload cannot hand the file back.
`Ctrl+S` on a working copy opens `SaveReviewDialog` before writing: a summary line
(`describeEditDiff`), then each changed neighbourhood drawn by `DiffStrip`
— the same `renderLinearView` and the same tracked-changes marks as the
sequence view, at a fixed 60 bases a row, scrolled to that hunk — headed
with where it is and what happened there (`around 1,204  inserted 5 bp;
deleted 3 bp`), then the features added, changed or removed. The
neighbourhoods come from `diffHunks` (`src/core/diff/hunks.ts`), which
pads each change by 30 bases and merges the ones whose padding touches,
and carries a per-hunk tally. The dialog's **Download** goes straight to
the save dialog (the click is the user gesture it needs). **Superseded in
part by item 24:** there is no write-back any more, so the review is shown
before every download rather than once, and the `written` flag that told
those apart is gone. A browser that will not let a page ask where a
download goes numbers each one instead (`pBR322_copy(1).gb`), which
nothing in the page can change, so a `DownloadNotice` banner under the
toolbar says where the file went and that the next one will not replace
it, once, with **Got it** remembering that in localStorage and **How to
keep one file** opening the guide at "Downloading in Firefox and Safari"
(`openGuide` in `src/app/help/`, a window event, since the dialog belongs
to the toolbar's `HelpButton`). Guide headings now carry
GitHub's slug as their id, so a `#…` link scrolls the dialog instead of
opening a tab (which is what `[working copy](#working-copies)` had been
doing), and `openGuide` takes `02-files#a-section`.
A `CopyBanner` under the toolbar names the file the copy came from and
offers the same review at any time. The diff is computed only while the
dialog is up: `editDiffBetween`'s cache holds one pair of versions and the
sequence view's own marks share it. **File ▸ Compare with…** is item 33.

- **The checksum and the provenance comment landed 2026-09-22**, which were
  the two provenance ideas offered alongside this and the thing items 11
  and 33 were both waiting on. A plasmid has no first base and DNA has no
  top strand, so the same construct written by two programs shares no
  text; SEGUID v2 hashes the smallest rotation of whichever strand sorts
  first and so survives both (`src/core/checksum/`). All four variants
  are there — `documentChecksum` picks `cdseguid` for a plasmid and
  `ldseguid` for a linear molecule, with item 10's sticky ends written as
  the `-` the spec uses for a staggered end, because a fragment with EcoRI
  ends is not the blunt fragment of the same bases. They are checked
  against the reference implementations' own vectors
  (`seguid/seguid-tests`), not against ourselves, since a checksum nobody
  else computes the same way is worth nothing. The published vectors are
  eight bases long, so all six NCBI fixtures are pinned to values computed
  by the reference _JavaScript_ implementation over the same files
  (`genbank.test.ts`) — that checks the whole path on a real record:
  reading the ORIGIN block, the topology off the LOCUS line, the strand
  and the rotation. pBR322 is `cdseguid=H-FY2ZzvKeazrRW2dNeSeMikjoc`.
  - **The SHA-1 is written rather than taken from `crypto.subtle`**, which
    is asynchronous and undefined outside a secure context: the checksum
    is wanted where a file is being built as a string and where a status
    bar is being drawn, and the app has to work served over plain http on
    a lab machine's LAN address. FIPS 180-1's vectors pin it. 0.92 ms for
    pBR322, linear in the length (`docs/perf-notes.md`).
  - **The status bar** shows the short form and copies the whole thing on
    a click. **Compare with…** shows both, and lines the other file up
    before diffing it (item 33).
  - **`PlasmidPop-derived-from: cdseguid=… pBR322.gb`** is written by the
    fork into `DocumentMetadata.derivedFrom` and rides in every file and
    share link the copy leaves as, handled exactly as `PlasmidPop-ends:`
    is (`src/io/genbank/derivedComment.ts`); a damaged line stays a
    comment rather than being swallowed, which the ends parser already
    did and the first cut of this broke. The checksum is the load-bearing
    half: a file name is what someone called a file once, a `cdseguid` is
    the molecule. A quiet banner says so when such a file is opened.
    Not yet: persisting the history log across reloads. The two rough
    edges left here are moot under item 24: no file handle is kept to be
    lost on a rename, and undoing back to the original is not possible at
    all, because the copy's history starts under its own name.
