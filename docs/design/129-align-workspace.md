# 129. The Align workspace, and the multiple alignment window with no document

Two issues, built in that order on one branch: #369's second stage, a
"Multiple alignment…" entry that needs no document, and #354, the Align tab
cut down to the common case with a workspace for the rest, on the model of
the primer workspace (item 107). The first is here because #354 was to
provide it a home and did not need to: the window is a dialog of its own.

## Stage 1: the multiple alignment window (#369)

**Asked:** the multiple alignment was reached only from a document's Align
tab, so aligning a few records meant opening some document first and
unticking "Include this document". Item 128 gave the group its own alphabet
detection; this stage gives it an entry that needs no document.

**Decided:**

- **A modal dialog, not a workspace page.** The workspace of #354 lives in
  a document's sidebar column and is about that document; a multiple
  alignment with no document has nothing to sit beside. So it is a dialog
  like Open from NCBI and Verify clones (`MsaWindow`), opened by a store
  flag (`msaDialog`, `requestMsa`/`dismissMsa`) from **File ▸ Multiple
  alignment…** and from the start page's "align several sequences
  together" link, which is the "File menu and/or start screen" of the
  issue read as "both": the File menu is only there with a document open,
  and the start page is where someone with three FASTA files and no
  plasmid begins.
- **The open document takes no part.** The window is for records alone;
  the Align tab's group is the route that includes the document. One
  rule, no tick box to explain.
- **The results window is the same `MsaDialog`**, selection, bar and
  Advanced copy included (item 127); closing it comes back to the box with
  the records kept, since the next run is usually the same records with
  the other alphabet or one record fewer. Escape goes to the results
  window while it is up (it listens on the document itself), to the input
  window after.
- **Nothing was rewritten twice.** The group's decision of what to align
  moved into `planMsa` (`src/app/msaPlan.ts`, pure: the alphabet in use,
  whether the document joins, the names and sequences, why Align is off,
  the notes), the run into `useMultipleAlignment` (busy, progress, cancel,
  the result shown), and the paste-or-drop box into `useRecordBox`, which
  the Align tab now uses too (`readFiles` and `warned` went to
  `sequenceRecords.ts` with it). `MsaControls` is the same group over
  those three; the window is the same three without a document.

**Built:** `src/app/components/MsaWindow.tsx`, mounted in `App` beside
`NcbiDialog`; the records listed under the box by name (the first twelve,
"and N more"), each with its file when several were dropped; "Letters
are" with Detected/Nucleotide/Protein as in the group; Align N together,
progress and Cancel. Analytics: `panel / open / msa-window` once per
visit, and the run's `align / msa` named by the alphabet as before. The
guide's "Without a document" section, and the Files page's one-liner.

Tests: `msaPlan.test.ts` (the box alone, the document first when it joins,
never read while it is out, the limit counted either way, a mixed set
waiting for a choice); `MsaWindow.test.tsx` (up only while asked for,
three records needed, a run opening the results and coming back to the
box, the alphabet from the letters with an override, dropped files named
by file, an unreadable file named and the rest kept, Escape's order);
the store flag; the start page's link; the File menu's item in the App
test's list. The existing `AlignPanel` and `MsaControls` tests guard the
extraction.

**Folded in after a look at the window (2026-11-04):** the "Letters are"
select and the file button took the app's `panel__select` and bordered
button classes (the group's select had the same gap and got the class
too); and the loaded records, which only a grey line had named, are a
counted row of chips under the box ("3 sequences", each with its name,
length and, when several files were dropped, its file), each with an × that
leaves it out (`useRecordBox.removeRecord`: a set from several files stays
a set with its box empty, otherwise the box becomes the rest as FASTA, the
qualities kept). The box says the files were taken and that a paste
replaces them.

## Stage 2: the Align workspace (#354)

**Asked:** the Align tab (1,200 lines of panel) held everything —
options, batch results, the alignment, the assembly with its map and
warnings, the consensus — cramped in a sidebar and in the way of the one
thing most people come for. A very basic side panel and a larger workspace,
as #300 did for primers (item 107).

**Decided**, the issue's four questions and the rest:

- **What stays in the panel: the one Align.** The box (paste, drop, Choose
  file…, Open tab…, the record picker), the **Reference** line (the
  document, its length and topology, or the selection when only that is
  aligned against, or "… is a read" the other way round), **Align** (or
  **Align all**) with its progress and Cancel, and a one-line summary of
  what came of it with **Results ›** or **Assembly ›**. Pairwise alignment
  _is_ the Align action (a sequence pasted); the multiple alignment and the
  assembly are links (**Multiple alignment ›**, **Assemble reads ›**, shown
  once the box holds two or more records) that open the workspace on their
  page, so a plate dropped on the panel is one click from either. **Options
  and more ›** opens the workspace on its Align page and is the button the
  keyboard comes back to on Escape, as "Design primers…" is for primers.
- **Shared state, yes — but not through panel memory.** The primer
  workspace shares a design through `useRemembered` (panel memory), whose
  setter runs inside React's state updater and so writes nothing once the
  component that called it is unmounted. An alignment runs in the worker
  and ends while the panel that started it may have given way to the
  workspace (one commit: the sidebar drops the panel, `App` mounts the
  workspace), or while neither is on screen. Its result has to land in
  something no component owns: `alignSession.ts` is a small external store
  per document (`useSyncExternalStore`), holding the box, the options and
  the results, and the running `AbortController` beside it. Everything the
  panel did is now `useAlignRun(doc)` (`components/alignRun.ts`) over that
  session, which both hosts render; the box hook from stage 1 takes the
  session's box and its setter. Leaving the tab still stops a run nobody
  would see the end of, but by a count of mounted hooks checked a tick
  later (`hosts`), so the panel giving way to the workspace is not a leave.
- **The #347 button and the assembly** live on the Assemble page:
  `AssemblyResult` unchanged, its `reference.onAlign` runs the batch and
  moves the workspace to Results, where the reads land. The Results page is
  the batch's list with **Large view of all**, or the one alignment
  (`AlignmentResult`, moved to `AlignResult.tsx` with `QualitySettings` and
  the difference lists), under a stale note "Input changed — Align again"
  that links back to the Align page; the page is disabled as the old
  fieldset was. A run started on the Align page moves to Results by itself
  (as a design moves to Results), with the progress bar and Cancel there
  too (`AlignProgress`), since that is where the eye is.
- **Phone: the primer workspace's layout.** `App` renders whichever
  workspace is open with `layout="phone"`; Align is a fifth Details subtab
  (`PhoneShell`), the slim panel there, so a read dropped on a phone has
  its Open Align workspace ›. Nothing phone-specific in the pages: the batch list
  scrolls sideways as the primer tables do.
- **One workspace at a time.** The store's `primerWorkspace: boolean`
  became `workspace: 'primers' | 'align' | null` with the same invariants
  (open ⇒ the sidebar on the tab of that name; another tab or the sidebar
  put away shuts it); `setPrimerWorkspace` stays as a wrapper. The column
  is one column: `layout.primerWorkspaceWidth` became `workspaceWidth`
  (a stored width from before is dropped once, the default 900 px taking
  its place), with `MIN_/MAX_WORKSPACE_PX`. The splitter names the
  workspace it resizes.
- **The chrome is shared, not copied.** `WorkspaceShell` is the region,
  top bar, foldable map strip, rail (a `tablist` with the arrow keys) and
  heading that `PrimerWorkspace` had; it takes the pages with their labels,
  headings, icons and badges, the page and its setter, and what to put
  beside the heading. The shell focuses the heading on a page change that
  is not the rail's own, which is item 107's `goTo(next, focus)` without
  the flag. One new rule for both: Escape is ignored when the event's
  target is outside the region's DOM — the large view and the MSA window
  are portals, in the React tree but not in the region, and their Escape
  must not also shut the workspace behind them.
- **The MSA group lost its frame**: `MsaControls` renders a section, the
  Multiple page's heading names it. Its tests never queried the group.

**Built:** `alignSession.ts`, `alignWorkspace.ts` (pages, open and close,
the focus request), `alignSummary.ts` (the panel's lines, pure, tested),
`components/alignRun.ts`, `AlignInput.tsx` (the box, the Align button, the
progress), `AlignResult.tsx`, `AlignPanel.tsx` (slim), `AlignWorkspace.tsx`,
`WorkspaceShell.tsx`; `App`, `Sidebar`, `PhoneShell`, the store and the
layout generalised. Analytics: `panel / open / align-workspace` once per
visit. The guide's new "The tab and the workspace" section, its sections
re-pointed from groups to pages, and the shortcuts page's workspace table
covering both.

**Tests.** `AlignPanel.test.tsx` renders the tab as the app mounts it (a
`Host` that follows the store, `renderAlign` opening the workspace, `page`
walking the rail), so its forty-odd flows run through the workspace's
pages; the slim panel has tests of its own there (the box, the reference
line, the summary and its links, a run surviving the move to the
workspace). `AlignWorkspace.test.tsx`: opening from the panel on a page,
the box shared both ways and the page remembered, the rail's keys, Escape
inside the large view not shutting the workspace, the store's shutting
rules, the phone layout, the badges. The store, `PhoneShell` and `App`
tests cover the kind, the subtab and the column. `alignSummary.test.ts`
the lines.

**Not seen in a browser.** As with item 107, the layouts were checked
through the DOM in tests; the look of the slim panel and the pages at
desktop and phone widths, and the chips in the MSA window, were not seen
by eye.

**When the worker fails, and when a run is slow (#373).** The client's
`onerror` used to answer every pending request with a fixed "Analysis
worker failed" and drop the event, so the cause was lost. It now keeps
`ev.message` and `filename:line` in the answer (`uncaught: true` in the
protocol's error), and `alignMultiple` throws it as `AnalysisWorkerError`,
told apart from a request's own error. `useMultipleAlignment` turns that
into `stopped` (the technical text, and whether Try again is still on
offer: once per run, never a loop) and times the run (`SLOW_RUN_MS`, 15 s)
for a "taking a while" notice beside Cancel. `MsaRunNotices` shows them in
both the group and the window; the technical text is behind a `<details>`,
never a stack. Only the multiple alignment has the notices so far; other
long requests get the fuller message in their error. Tests:
`analysisClient.test.ts` (fake worker firing `onerror`: message kept,
pending answered, new worker next time) and `MsaRunNotices.test.tsx`.
Not seen in a browser.
