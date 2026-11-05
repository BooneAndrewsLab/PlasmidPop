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
