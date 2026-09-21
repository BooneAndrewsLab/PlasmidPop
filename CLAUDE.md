# PlasmidPop — Project Handoff

## What this is

PlasmidPop is a fully browser-based DNA sequence editor and plasmid viewer,
comparable in scope to SnapGene. Core capabilities: open/edit/save sequences,
annotate features, view linear and circular maps, find restriction sites,
ORFs, primers, and run pairwise alignments — all client-side. Cloud sync,
sharing and team libraries are optional add-ons, not requirements.

Design principle: a scientist should be able to open a GenBank file and start
working with no account and no server round-trip.

## Stack (decided)

- **Language:** TypeScript everywhere (UI, workers, backend). Strict mode on.
- **UI:** React + Vite. Reference implementations to study, not depend on:
  Teselagen Open Vector Editor, Lattice seqviz. Verify licenses before
  copying anything.
- **Rendering:** Canvas 2D for the linear sequence view and circular map.
  Do NOT render the sequence with DOM or SVG — it will not scale past
  ~50 kb. SVG is used only for exporting publication-quality plasmid maps.
  Escalate to PixiJS/WebGL only if Canvas 2D is measured to be too slow.
- **Compute:** Plain TS first. Move hot paths to Rust → WebAssembly
  (wasm-pack / wasm-bindgen) when profiling justifies it. Expected WASM
  candidates: pairwise alignment (Needleman-Wunsch, Smith-Waterman),
  restriction scanning on genome-scale inputs. All compute runs in Web
  Workers; the main thread never blocks.
- **Data model:** Immutable document with undo/redo. Sequence stored in a
  rope or piece table; features in an interval tree. Feature coordinates
  must update correctly on insert/delete, including features that span the
  origin of a circular sequence.
- **Collaboration (future):** Yjs. Design the document model so a CRDT can
  be layered on later; do not retrofit.
- **Storage:** Local-first. IndexedDB via Dexie (or OPFS for large files).
  Cloud sync is opt-in. Nothing on the user's disk is ever written to: a
  document leaves the app as a download, never through a kept file handle
  (item 24 under "Potential new features").
- **Backend: none** (decided and built 2026-09-21). The app is a static site and
  stays one, so it deploys to GitHub Pages with nothing behind it. Auth,
  sync and team libraries are dropped rather than deferred; sharing, the
  one piece wanted from them, is a link that carries the document in its
  URL fragment and needs no server (item 11 under "Potential new
  features"). Server-side computation was never a goal and still is not.
- **File formats:** GenBank, FASTA, SnapGene .dna are required from day one.
  Geneious and ApE are nice-to-haves. Teselagen `bio-parsers` is an
  acceptable starting point; plan to own the GenBank writer eventually
  because round-tripping is where third-party parsers break.
- **Distribution:** PWA. No Electron/Tauri for v1. A Tauri wrapper may come
  later for enterprise/local-install demands.
- **Analytics:** Matomo (self-hosted). Usage tracking is a feature to
  include: page views and coarse feature-usage events (e.g. "opened
  GenBank", "ran restriction analysis"), never sequence content, file
  names or other scientific data. No user-facing toggle (decided
  2026-09-18); honours Do-Not-Track, cookieless, IP anonymisation on. Instance URL and site id are
  build-time config (`VITE_MATOMO_URL`, `VITE_MATOMO_SITE_ID`); when
  unset the tracker is a no-op, so local-first use never phones home.

## Domain rules that cause bugs

- Sequences may be linear or circular. Every position/range operation must
  handle wraparound on circular sequences.
- Be explicit about 0- vs 1-based indexing at every boundary. Internal model
  is 0-based half-open `[start, end)`; GenBank I/O is 1-based inclusive.
- Reverse-strand features have coordinates on the forward strand but read
  in reverse; translations must reverse-complement first.
- Features can be multi-segment (GenBank `join(...)`). Preserve segments on
  round-trip.
- IUPAC ambiguity codes (N, R, Y, etc.) must be accepted in input and in
  restriction-site recognition sequences.
- Restriction enzymes: model recognition sequence, cut position on both
  strands (can be outside the recognition site, e.g. Type IIS), and
  palindromic vs. non-palindromic behavior.

## Suggested build order

1. Repo scaffold: Vite + React + TS strict, Vitest, ESLint, Prettier, CI.
2. Core document model (sequence + features + undo) with exhaustive unit
   tests, especially circular/wraparound and coordinate-shift cases.
3. GenBank + FASTA parser/writer with round-trip tests against real files.
4. Canvas linear sequence view: bases, complement, features, ruler,
   selection, virtualized scrolling.
5. Editing: insert, delete, replace, reverse-complement, set origin.
6. Circular map view.
7. Restriction analysis (bundled enzyme table), ORF finding, translation.
8. SnapGene .dna import.
9. Local persistence (Dexie), PWA manifest, file open/save via File System
   Access API with download fallback. Matomo tracking (see Stack).
10. Primer design, pairwise alignment (first TS, then WASM if needed).
11. ~~Optional backend~~ — dropped (see Stack); share links instead, item 11.

## Status (2026-09-21)

Build order steps 1–10 are implemented and committed; step 11 (backend) is
dropped rather than pending — the app stays a static site, and sharing is a
link, not an account (decided and built 2026-09-21, item 11). Beyond the build order, these have landed: Download GenBank
(write-back through the File System Access API came first and item 24 took
it out again), SVG map export, selection export, find (Ctrl+F), a full
feature editor, a History sidebar tab, sequence-view / selection SVG
export, tracked-changes marks for the sequence view (`src/core/diff/`, the
**Edits** menu), a bundled example
(pBR322), an optional REBASE enzyme table imported from the user's own
download (`src/io/rebase/`), and Matomo usage statistics (`src/app/analytics.ts`,
always on when configured, no user toggle by decision of 2026-09-18;
events at file open/new/download/export, enzyme show, primer design, align,
ligate, history jump, edit-mark baseline; the Pages workflow sets the
instance URL and site id 6). The view switcher, the Complement /
Translations / Cut sites toggles, the Format menu's sequence-view options
and the Edits baseline are remembered in localStorage
(`src/app/state/viewPrefs.ts`, applied and watched by `useViewPrefs`);
documents and enzyme ticks are unaffected. The logo
(`design/logo/`, made in Claude Design) is used for the favicon, PWA icons (`scripts/make-icons.sh`) and the toolbar lockup
(`src/app/components/Logo.tsx`; wordmark outlined by
`scripts/make-wordmark.py`, no webfont). Added 2026-09-19: runs of typing
coalesce into one undo step, the Cloning tab's assembly shelf survives a
reload, Golden Gate assembly (items 5 and 3 under "Potential new
features"), and the rough edges the REBASE import left (item 7) are
cleared. Added 2026-09-20: working copies, so the file a document was opened
from is never written to (item 22). Added 2026-09-21: **nothing writes to a
file at all any more** — a document lives in this browser and leaves it as a
download (item 24). Added 2026-09-21: a feature takes its name from the
qualifiers that suit its type, so `/gene` no longer labels every feature
inside a gene (item 23). Added 2026-09-21: **File ▸ Copy share link** — a
document travels whole inside the URL fragment, so it reaches the person it
is sent to without being uploaded anywhere, and the Matomo call now reports
a page URL with the fragment cut off (item 11). Added 2026-09-21: the
circular map's labels are spaced against the ruler's numbers and each other,
slide along the ring rather than across the map, and are left out with a
count in the corner rather than stacked on top of one another when the ring
is full — hovering a feature or a cut site brings its own back, and the SVG
export grows its canvas instead of dropping anything (item 29). Added 2026-09-21: a
**preview channel** both views draw beside the document's own annotation
(`src/view/overlay.ts`), used by the Primers tab for a designed pair and its
product and by Find for every match at once, so weighing up candidates costs
no edit (item 26). Tests: 689 passing. Perf measurements live in
`docs/perf-notes.md`.

## Potential new features (not scheduled)

Ideas judged worthwhile, roughly in priority order. None is committed to;
pick from here when the current work is done.

1. ~~**Amino-acid translation under CDS features**~~: done. One line per
   CDS between the strands and the feature lanes, codon-aligned with
   alternating shading, honouring `/codon_start`, `/transl_table`, joins,
   reverse strand, partial ends and origin wrap
   (`src/core/analysis/cdsTranslation.ts`, `drawTranslations` in
   `renderLinear.ts`); "Translations" toggle in the toolbar. Not yet:
   `/transl_except`, comparing against a stored `/translation`.
2. ~~**Copy and paste with features.**~~ done. Ctrl+C/X in the sequence
   view copies the selection as a `SeqFragment` (bases plus trimmed
   features, `source` left behind; `src/core/document/fragment.ts`) under
   both `text/plain` and a JSON MIME type, remembering it in-tab as a
   fallback (`src/app/clipboard.ts`). Ctrl+V applies one `insertFragment`
   op (delete selection, insert bases, add shifted features with fresh
   ids), so it is a single undo step. Not yet: cross-tab paste in browsers
   that strip custom clipboard types (only the plain bases arrive there).
3. ~~**Simulated cloning.**~~ done: restriction-ligation and Golden Gate. The
   Cloning sidebar tab digests the document with the enzymes ticked in the
   Enzymes tab (`digest` in `src/core/cloning/digest.ts`: fragments with
   both ends described as blunt / 5′ / 3′ plus the overhang bases) and lets
   fragments be collected into an assembly that survives opening another
   file, so vector and insert can come from different documents. Parts can
   be flipped and reordered; every junction is checked (`endsCompatible`,
   `assemblyJunctions` in `ligate.ts`) and `ligate` opens the product as a
   new circular or linear document with the fragments' features; a fragment
   can also be opened on its own (**Open**, item 10). The shelf survives a
   reload: it is a row of its own in IndexedDB (Dexie version 2, table
   `shelf`), written by `useAutosaveShelf` and read back by
   `restoreLastSession`, which gives way to a shelf the user has already
   started filling. A **Golden Gate** section below it takes whole open
   documents instead (`goldenGate` in `src/core/cloning/goldenGate.ts`):
   one Type IIS enzyme (`isTypeIIS`, `goldenGateEnzymes`, BsaI by
   default), digest every ticked document, drop the pieces that still carry
   a site or lack two sticky ends, then walk the overhangs, flipping a part
   where that is how it fits, and refuse with a sentence rather than guess
   when they do not force one circle. It costs a few ms on the main thread
   (`docs/perf-notes.md`). `flipFragment` was fixed along the way: a
   fragment's `sequence` is its top strand alone, so turning it over moves
   the window by an overhang at each end rather than just
   reverse-complementing it. Not yet: Gibson assembly, partial digests,
   dephosphorylation, resolving IUPAC codes in overhangs, mixing two
   enzymes in one Golden Gate, and taking Golden Gate parts from the
   assembly shelf rather than from open documents.
4. ~~**Translation of any selected range in six frames**~~ done. The
   Translate sidebar tab shows the selection (or the whole sequence when
   nothing is selected) in frames +1..+3 and −1..−3
   (`translateSixFrames` in `src/core/analysis/sixFrame.ts`; −1 starts at
   the 3′ end of the selection), with stop codons marked, per-frame Copy
   and an Export FASTA button that writes one protein record per frame
   (`src/app/sixFrameExport.ts`). Not yet: alternative genetic codes,
   clicking a residue to select its codon.
5. ~~**History panel**~~ done. The **History** sidebar tab lists every
   recorded change newest first with its number, label, time and what it did
   to the document (`+12 bp`, `−3 bp`, `+1 feature`, `circular`), marks the
   state the file on disk holds and the current one, greys undone steps, and
   jumps to any state on a click; **Latest** redoes everything undone
   (`src/app/historyView.ts`, `src/app/components/HistoryPanel.tsx`; the core
   `History` now carries a timestamp per step, `steps`, `stateAt`, `size` and
   `truncated`). A run of typing is one step, not one per base:
   `History.push` takes an optional `Coalesce` whose two keys chain a run
   (`src/core/document/coalesce.ts` defines typing, Backspace and Delete),
   and `seal()` ends a run where the present must stay reachable — on
   undo, redo and jump, on save, and on "Mark from here". A run also breaks
   on a two-second pause, at 60 bases, and when the caret moves. Not yet:
   naming or bookmarking a state, a diff of what a step changed.
6. ~~**Multiple open documents (tabs)**~~ done. The store keeps one
   `DocumentState` per open document (history, selection, file name and
   handle, saved/opened/marked versions, warnings, analysis, enzyme ticks,
   reveal, find, feature editing, overwrite prompt) and a `SharedState` for
   the app (view prefs, sidebar tab, cut-site toggle, ORF threshold, error,
   assembly shelf); `getState()` flattens the front tab into the same
   `EditorState` shape the views always read, plus `documents`. Methods act
   on the front tab unless they take an id (`apply`, `markDownloaded`,
   `requestSaveReview`, `activateDocument`, `closeDocument`); `setAnalysis`
   files results by the document they are for, so a slow worker answer lands
   in the right tab. `openDocument` returns the id, reuses the tab of a file
   already open (`findOpenCopy`: same file name and the document as read
   from it) and takes over an untouched "New" tab. The strip
   (`DocumentTabs.tsx`) has a fixed **Files** tab (the start screen,
   `showFiles`), one tab per document with a dirty dot and ×, and +; the
   editor area is keyed by document so views start afresh on a switch while
   the sidebar keeps its panels' state. Autosave writes every changed tab
   (`PersistenceService.autosaved` remembers what was written) and records
   the open ids and the front one (`openDocumentIds` in the repository);
   `restoreLastSession` reopens them all. Not yet: a key binding to switch
   or close tabs (Ctrl+Tab/Ctrl+W belong to the browser), dragging tabs to
   reorder, remembering scroll and zoom per tab across a switch.
7. ~~**Enzyme table from REBASE**~~: done, as an import rather than a
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
     covers the *NAR papers*). `rebase.neb.com` sends no
     `Access-Control-Allow-Origin`, so the app cannot fetch it either, and a
     proxy or a build-time download would just make us the redistributor.
     The user's own copy in the user's own browser is none of those things.
     If a bundle is ever wanted, ask Dana Macelis, who
     runs REBASE distribution, copying Rich Roberts; the
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
     *own* methyltransferase modifies the site, not what your *E. coli*
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

8. ~~**Linear map export as SVG**~~: done. **File ▸ Export sequence view as
   SVG** writes the sequence rows (ruler, strands, translations, cut sites,
   feature lanes) through `SvgContext` at a fixed 60 bases per row, and
   **Export selection view as SVG** cuts it down to the rows holding the
   selection, keeping document positions and highlighting it
   (`exportLinearSvg` in `src/view/svg/exportLinear.ts`; the same
   `renderLinearView` as the canvas, with a print theme and a Courier metric
   the SVG text estimator matches). Refuses over 100,000 bases. Not yet: a
   chosen range other than the selection, a bases-per-row control in the UI,
   page-sized (A4) pagination.
9. ~~**Sequence view options**~~: done. A **Format** menu in the toolbar
   sets the text size (Small / Medium / Large, with the rest of the row
   scaling with it through `linearMetrics` in `src/view/linear/layout.ts`),
   the bases per row (Fit the window, or a fixed 30 / 60 / 90 / 120, which
   scrolls sideways when it does not fit), whether the row's position
   number is repeated beside the complement, and whether the bases are
   coloured (one drawing pass per colour with the other columns blanked
   out, measured in `docs/perf-notes.md`). The choices are remembered with
   the other view preferences and the sequence-view SVG exports follow all
   but the text size. Not yet: a bases-per-row number of the user's own,
   colours the user can change, a font family choice.
10. ~~**Linear molecule end handling**~~: done. A `SeqDocument` carries the
    shape of its two ends (`src/core/document/ends.ts`: kind, overhang bases
    in the same top-strand convention as a digest fragment, and the enzyme),
    null for a circular molecule or a plainly blunt linear one. `digest`
    gives the outer fragments the molecule's own ends, a linear `ligate`
    product keeps the outermost ends of the assembly, and
    `documentFromFragment` (**Open** in the Cloning tab) opens a fragment as
    a document. An edit that reaches a tip blunts that end, reverse
    complement swaps them, making the molecule circular drops them. The
    sequence view washes over single-stranded bases, leaves a gap opposite
    them and draws a bottom-strand overhang in the gutter beyond the first
    or last column (the gutters grow to fit); the toolbar names both ends.
    They survive a save: GenBank has no field for them, so they ride in a
    `PlasmidPop-ends:` comment that the parser turns back into ends
    (`src/io/genbank/endsComment.ts`). Not yet: filling in or chewing back an
    overhang (Klenow / T4 blunting), ends on the circular map, and any
    carriage through FASTA or SnapGene.
11. ~~**Sharing, without a backend.**~~ done, 2026-09-21. The backend was
    dropped as a goal the same day: auth, sync and team libraries bought
    nothing the app needs, and a static site on GitHub Pages — no origin to
    run, nothing to keep up, no account between a scientist and their
    plasmid — is worth more than all three. Sharing was the one piece
    wanted, and it needs no server, because **the document travels in the
    URL fragment**.
    - **File ▸ Copy share link** puts `…/#d=<payload>` on the clipboard
      (`copyShareLink` in `src/app/share.ts`). Everything after `#` is never
      sent in the HTTP request and is left out of `Referer`, so the sequence
      reaches whoever the link is sent to without touching Pages, us, or
      anyone's log — the same promise as the rest of the app rather than a
      carefully-worded exception to it.
    - **The payload** is `writeGenBank(doc)` through `CompressionStream
      ('deflate-raw')`, base64url, behind a `1` that says which encoding it
      is (`src/io/share/link.ts`). GenBank rather than a format of our own:
      the writer and parser are already tested against real files, and the
      ends comment rides along, so a linear molecule keeps its overhangs.
      `Blob.stream` is not used — jsdom has no such thing — so the codec
      feeds one buffer through the stream by hand, not awaiting the write
      before reading or a buffer past the queue size would deadlock.
    - **Measured**: AJ237582 (206 bp) 1.3 k characters, AF177870 (3.1 kb)
      3.9 k, L09137 (2.7 kb) 4.5 k, U49845 (5 kb) 5.6 k, pBR322 (4.4 kb)
      10.8 k, NC_001422 (5.4 kb) 11.3 k. `MAX_SHARE_PAYLOAD` refuses past
      32,000 with the length in the message and a word about downloading the
      file instead. A cleverer encoding would not raise that ceiling: of
      pBR322's 10.8 k, the ORIGIN block is 2.1 k of the compressed bytes and
      the header, references and 50 features are 5.8 k — it is the
      annotation that fills a link, so two-bit packing the bases would save
      about 1 k of 8 k and cost a format of our own.
    - **Matomo would have posted the whole fragment.** The tracker takes
      `window.location.href` unless told otherwise, so a page view from an
      opened share link would have sent the entire compressed sequence to
      the analytics instance — the one thing `analytics.ts` promises never
      to send. It now pushes `discardHashTag` and an explicit
      `setCustomUrl` of `trackableUrl()`, with a test that a page carrying a
      fragment reports a URL without one.
    - **A shared document is the reader's own.** It opens with no file name
      and no origin (`openSharedPayload`), so there is nothing to fork a
      working copy off and "dirty" keeps its meaning — not downloaded in
      this browser yet. The fragment comes off the address bar before
      anything else (`takeShareFragment`, `history.replaceState`), so the
      sequence is not left in the URL or in the browser's history; that also
      makes the effect safe to run twice, as React does in development. The
      restore of the last session runs first and the shared document opens
      last, so it is the tab in front and the session's own tabs are behind
      it rather than replaced.
    - **`ShareNotice`** under the toolbar says what was copied — the length,
      that nothing was uploaded, and that anyone with the link can open it —
      and takes itself away after twelve seconds. A link cannot be withdrawn
      or updated, which the guide says plainly (`docs/guide/02-files.md`,
      "Sharing a link").
    - Not yet: no key binding; a link always carries the whole document
      (a selection, or a document without its references, would make a much
      shorter one); nothing on the receiving side says where a document came
      from, which is where item 22's `PlasmidPop-derived-from:` checksum
      would belong; and a link is GenBank only, so SnapGene-specific
      material a `.dna` import dropped is not in it either.
12. ~~**User documentation**~~: done. Fourteen guide pages in
    `docs/guide/` (getting started, files, viewing, editing, features,
    find, enzymes, ORFs, translation, primers, alignment, cloning,
    history, shortcuts), each with a how-to, rendered in the app from the same
    files by a "?" button at the right of the toolbar (also the `?` key;
    `src/app/help/`, own Markdown subset in `markdown.ts`), plus a README
    that reads as a landing page. Keep it current, see Conventions.
13. ~~**Licence**~~: done. MIT (`LICENSE`, `package.json`, `CITATION.cff`).
    Keep REBASE data out of the repo; its terms restrict redistribution.
14. ~~**Circular map zoom**~~: done. Wheel and pinch zoom about the
    cursor, drag to pan, +/−/Fit/Sel buttons, double-click a feature to
    fit it (`src/view/circular/viewport.ts`, `CircularMapView.tsx`).
    Lane widths and fonts do not scale; ticks densify with zoom.
15. **Mobile-friendly layout**, probably view-only at first: a phone or
    tablet should be able to open a file and read the map, features and
    sequence, with the sidebar and views collapsing into tabs. Editing
    on a touch screen is hard to get right and can wait; test on real
    devices, not only a narrow desktop window.
16. ~~**Make tiny features visible on the circular map.**~~ done. A
    selection whose arc would be under 7 px on screen (the 2 bp feature at
    141..142 of pBR322, say) is widened about its centre to that much
    (`selectionSweep` in `src/view/circular/renderCircular.ts`) and drawn
    again over the features as a needle from just outside the backbone in
    to the inner edge of the lanes. Not yet: the same treatment for the
    caret, or for a tiny feature that is not selected.
17. ~~**Create from scratch**~~: done. "New" in the toolbar and "start a
    new sequence" in the empty state open an empty linear "Untitled"
    document (`editorStore.newDocument`) with the caret placed and the
    sequence view focused, so typing starts at once; it is not autosaved
    until something is typed. Ctrl+V with nothing open (or into a
    still-empty document) opens pasted GenBank/FASTA text as a record and
    bare bases as a new document (`openPastedText` in
    `src/app/openFile.ts`). Not yet: choosing circular/name up front (use
    "Make circular" and rename after).
18. ~~**Sidebar tab strip that stays on one row.**~~ done, as option (a)
    of the four considered on 2026-09-18. The tabs are a 30 px vertical
    rail down the sidebar's outer edge with the labels turned a quarter
    turn, JetBrains style, and the panel beside them; the sidebar is
    330 px wide so the panel keeps its old 300 px (`.sidebar`,
    `.sidebar__tabs`, `.sidebar__tab-label` in `src/styles.css`). Every
    tab is shown whatever their number: on a window too short for them at
    full length they shrink and the labels ellipsize (about 80 % of each
    label survives at a 500 px viewport), and the rail scrolls only past
    that. Under 720 px, where the sidebar is short and wide instead, the
    tabs go back to the grid of equal cells above the panel. Not yet:
    arrow-key navigation along the rail (the tabs are plain buttons in
    the Tab order), icons instead of words.
19. ~~**Selecting amino acids in the sequence view.**~~ done. Clicking an
    amino acid on a translation line selects its codon and dragging along
    the line extends the selection codon by codon in reading order, so a
    reverse-strand CDS selects right to left and a codon that crosses a
    `join(...)` boundary or the origin comes out whole (`codonIndexAt`,
    `codonSpan` in `src/core/analysis/cdsTranslation.ts`, which now
    records the feature's `strand`; the drag itself is in
    `LinearSequenceView`). Clicking the feature bar still selects the
    whole feature, and so does a click on a part of a translation line
    with no codon under it — an intron, or the bases `/codon_start`
    skips. The canvas cursor now follows what is under the pointer
    (`cursor` state in `LinearSequenceView`): a hand over a feature bar or
    a residue, the text caret over the bases, the arrow over empty lane
    space. Not yet: extending the selection by codon from the keyboard
    (`Shift+Arrow` still moves one base).
20. ~~**Hide cut sites without losing the enzyme selection.**~~ done. A
    **Cut sites** toggle sits next to Complement / Translations in the
    toolbar (`showCutSites` in the store); off, the sequence view, the
    circular map and both SVG exports draw no cut sites while
    `shownEnzymes` is untouched, so the chosen set comes back intact. The
    Enzymes tab says so while they are hidden, with a "Show cut sites"
    link, and its fragment list and the Cloning digest follow the ticks,
    not the toggle (both headings now say "ticked enzymes"). The toggle
    is remembered across reloads with the other view preferences
    (`src/app/state/viewPrefs.ts`). Not yet: a key binding.
21. ~~**Show edits in the sequence view.**~~ done, with all three
    baselines of the open question, chosen from an **Edits** menu in the
    toolbar: Off / Since opened (the default) / Since last save / Mark
    from here (`editsBaseline`, `openedDoc`, `markedDoc` in the store;
    the mode is remembered with the other view preferences, "marked"
    coming back as "opened"). The marks are a diff of two `SeqDocument`s
    (`src/core/diff/`): a Myers O(ND) diff after stripping the common
    prefix and suffix, which splits on a shared 32-mer when one stretch
    needs more than 1,000 steps and only then reports "this whole stretch
    was replaced". A shortest script is not the clearest one on four
    letters — two edits a dozen bases apart come out as a scatter of
    one-base specks — so each neighbourhood of changes is re-aligned with
    `alignPairwise` (`refine.ts`), whose affine gaps prefer one long gap
    to six short ones; those windows are small enough for O(nm) (1.3 ms
    for a normal session, ~37 ms worst case, `docs/perf-notes.md`). Inserted bases are
    tinted green with an underline, changed bases amber, deletions get a
    red wedge and a line at the boundary; features added or edited are
    outlined, and a feature that merely moved with an edit elsewhere is
    not (its old location is mapped through the diff). The marks are in
    the sequence-view SVG exports too. Requested 2026-09-18. Not yet: the
    circular map, a key binding, anything for a rename or topology change
    beyond the menu's tally.
22. ~~**Working copies: the opened file is never written to.**~~ done,
    2026-09-20, asked for because a PI was uneasy that a user can edit a
    plasmid and wanted to know a file had not been quietly altered. A
    `DocumentState` records the file it was read from (`origin`: that file's
    name and the document exactly as read) and whether it has been forked off
    it (`derived`). The first edit of a document with an origin forks it in
    `apply`: the `fileHandle` is dropped, so `save()`'s write-back path cannot
    be reached for that file. Two conditions, deliberately separate. `derived`
    latches and is never cleared, because the handle cannot be got back. The
    copy's *name* is decided per edit instead — a working copy never carries
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
    sequence view's own marks share it. Not yet: the other provenance ideas
    offered alongside this one — a rotation- and strand-invariant sequence
    checksum shown in the UI and written into the file (the SEGUID v2 family,
    `cdseguid` for a plasmid), **File ▸ Compare with…** against any file on
    disk, a `PlasmidPop-derived-from:` comment carrying the original's
    checksum, and persisting the history log across reloads. The two rough
    edges left here are moot under item 24: no file handle is kept to be
    lost on a rename, and undoing back to the original is not possible at
    all, because the copy's history starts under its own name.
23. ~~**Feature naming: `/gene` outranks `/product`, so one gene's name spreads
    over every feature that mentions it.**~~ fixed 2026-09-21. Noticed 2026-09-20 on the bundled
    example, which appears to show "two tet features at 86..1276". It is not
    a parsing bug: J01749 really carries `gene 86..1276 /gene="tet"` and
    `CDS 86..1276 /gene="tet"`, which is how NCBI writes a gene, and `bla` at
    `complement(3293..4153)` is the same pair. What makes the pair read as a
    duplicate is `deriveFeatureName` (`src/io/genbank/parseGenBank.ts`), whose
    `NAME_QUALIFIERS` precedence is one global list —
    `label, gene, product, locus_tag, standard_name`. Two consequences: the
    CDS is shown as `tet` rather than its own
    `/product="tetracycline resistance protein"`, which is exactly what would
    have told the two rows apart; and `/gene` on a *non-gene* feature is a
    cross-reference to the gene it sits in, not a name, so
    `misc_feature 146..147`, `misc_binding 411..414`, `misc_difference 426`,
    `misc_binding 469..472` and `old_sequence 526..528` are all labelled
    `tet` too — 7 features named `tet` and 4 named `bla` in one 50-feature
    record.
    - **The precedence is type-aware now.** `NAME_QUALIFIERS` is gone;
      `nameQualifiersFor(type)` gives `gene` → `label, gene`; `CDS` and the
      transcripts (`mRNA`, `tRNA`, `rRNA`, `ncRNA`, `tmRNA`, `misc_RNA`,
      `precursor_RNA`) → `label, product, gene`; everything else →
      `label, product` and *not* `gene`, each ending in
      `locus_tag, standard_name` so a CDS or gene carrying only a
      `/locus_tag` still has a name. Unnamed falls back to the empty string,
      since the list and the map already show the type (`misc_binding
      411..414` reads as itself). On the bundled example: `tet` and `bla`
      went from 7 and 4 features to 1 each, the two CDSs took their own
      `/product`, and 38 unnamed features became 44 of 50.
    - **Round-trip survives it**, checked rather than assumed: the fixtures
      pass, and the writer now asks the *same* question the parser does —
      `featureLines` compares the name against `deriveFeatureName(type,
      qualifiers)` rather than against any qualifier in a global list. That
      also fixes a case the old check got wrong: a CDS renamed to its
      `/product` while still carrying a `/label` of its own wrote no
      `/label` and read back under the old one.
    - **Still open: collapse a `gene` that exactly coincides with a `CDS`**
      of the same name into one bar, as SnapGene does. Display only, no data
      implications. Much less pressing now — after the naming fix the pair
      no longer *has* one name, so there is nothing to collapse on the
      bundled example; it would only bite a file where both carry the same
      `/label`.
24. ~~**One way out: download, never write**~~: done, 2026-09-21, replacing
    the write-back half of item 22. The File System Access API was doing two
    jobs — picking a file to read, and holding a handle to write back to —
    and the second one made the app behave differently per browser: Chromium
    users' `Ctrl+S` wrote silently to a file, Firefox and Safari users got a
    new numbered download every time (`pBR322_copy(1).gb`, reported by the
    user and not fixable from the page, since those browsers will not let one
    ask where a download goes). One model everywhere is worth more than
    write-back for one browser family:
    - **File ▸ Download GenBank… (`Ctrl+S`, `Ctrl+Shift+S`)** is the only way
      sequence leaves the app (`PersistenceService.download`). A working copy
      is reviewed first — `SaveReviewDialog`, now shown before *every*
      download rather than once — and the dialog's own button is the user
      gesture the save dialog needs. Where the File System Access API exists
      the write still goes through `showSaveFilePicker`, so the user can
      replace their own file; the handle is used for that one write and
      dropped. `downloadNameFor` offers the name the document was last
      written under (never the origin's), so replacing is one click.
    - **No handles are kept anywhere.** `fileHandle`, `written`,
      `overwritePrompt`/`OverwriteDialog`, `writeBackTarget`,
      `ensureWritePermission`, the repository's handle methods and Dexie's
      `handles` table are gone (version 4 drops the table, which also drops
      handles an older build stored — none may survive a reload). `pickOpenFile`
      returns a `File`, not a handle.
    - **The fork resets the history.** The first edit of a document with an
      origin starts a new `History` at the file's contents *under the copy's
      name* (the user's name when that edit is their rename, and then there
      is no step to record). So undo reaches what the file holds and stops
      there, `savedDoc` becomes null, and the per-edit re-naming that item 22
      needed — the name travelled with undo, so every edit had to check it —
      is deleted. `CopyBanner` names the copy and renames it in place
      (`InlineRename`), because that name is what the download will be called.
    - **"Dirty" means "changed since the last download."** The unload warning
      is gone (nothing is bound to a file and the session comes back); in its
      place `useFlushOnLeave` writes the open documents on `pagehide` and on
      `visibilitychange`, which is what that dialog was really protecting.
      The first autosave asks for persistent storage
      (`requestPersistentStorage`: Chromium decides, Firefox asks the user),
      so the browser does not evict documents when space runs low. The Edits
      menu's second baseline is **Since last download**, and for a copy that
      has never been downloaded it falls back to the file it came from.
    - **Coming up from an older build is covered by a test**
      (`src/storage/migration.test.ts`): anyone who used the deployed site has
      a Dexie version 1 database with a `handles` table, so version 4 drops
      that table under them in one open. The documents survive it, they read
      back as neither `derived` nor having an `origin`, and the tab that build
      remembered reopens — it wrote only `plasmidpop.lastDocument`, never the
      `openDocuments` that `restoreLastSession` prefers.
    - Not yet: nothing tells the user which stored documents have never been
      downloaded (every document lives in the browser now, so a per-row
      marker would be noise — the Files screen says it once instead), and
      **File ▸ Compare with…** against a file on disk is still the obvious
      companion to this (item 22's list).
25. **A diff on the map, not only in the sequence.** The tracked-changes marks
    of item 21 exist only in the sequence view (and its SVG exports); the
    circular map and the feature lanes show nothing. A map-based diff would
    put the same `editDiff` on the circular map — arcs for inserted, changed
    and deleted stretches around the backbone, a marker where a deletion
    closed up, features outlined where they were added or edited — so a
    glance at the map says what changed, which is how a plasmid is usually
    read. Open: whether the two documents are drawn as one map with marks
    (needs the diff's position mapping to place the old coordinates on the
    new molecule) or side by side with the changes tied across; what a
    change in length does to a circle's geometry; whether this shares the
    `DiffStrip` in `SaveReviewDialog` or gets a map of its own there. The
    diff itself is already there (`src/core/diff/`, `editDiffBetween`,
    `diffHunks`) — this is a rendering question. Related: item 22's
    **File ▸ Compare with…**, which would want exactly this view for two
    different files rather than two versions of one.
26. ~~**Preview a primer before it becomes a feature.**~~ done, 2026-09-21,
    and not primer-shaped: what was built is the **overlay channel** the note
    asked for. A preview is a list of `OverlaySpan`s — id, label, an
    *unrolled* range, strand, and `arrow` (the thing itself) or `span` (the
    stretch between two things) — that both renderers draw beside
    `doc.features` (`src/view/overlay.ts`). It lives in the store as
    `preview` (`SharedState`, carrying the document it was computed for and
    the panel that put it there; `compose` hides it behind another document
    tab, `apply` drops it because an edit moves the ground under it, and a
    panel clears only its own on the way out — the find bar and a sidebar
    tab can both be open). Nothing previewed is in the document, the History
    or the SVG exports.
    - **In the sequence view** the spans take a band of their own outside the
      feature lanes, and the rows grow for it exactly as they do for
      translation lines (`overlayHeight`, `RowLayout.overlays`, `overlayTop`,
      and an `overlay` hit kind that is deliberately inert — a click there
      does nothing rather than dropping a caret). The lanes are packed by the
      *same* greedy colouring the features use: `assignLanes` and
      `lanesPerRow` are now thin wrappers over `packLanes` and
      `itemLanesPerRow`, which take `{ id, pieces }`.
    - **On the map** they are a ring in the 12 px gap between the backbone and
      the first feature lane. The *last* lane takes that gap, so a primer's
      solid arc is drawn in the clear and it is the bracket's dashed line that
      crosses the features. A span too short to see is widened by
      `selectionSweep` — item 16's rule for a short selection — so a 22 nt
      primer on a 4 kb plasmid is still an arrow with a head on it.
    - Everything is dashed, in `--seq-preview`, a colour used for nothing
      else. That needed `setLineDash` on `DrawingContext` (canvas has it;
      `SvgContext` writes `stroke-dasharray`), which is also how the renderer
      tests can assert what was drawn.
    - **Primers**: **Show** on a pair draws its two sites as arrows and the
      product as a bracket, and selects the product — the cheap half the note
      predicted would carry most of the value. Hovering a pair shows it while
      the pointer is there, **Hide** or leaving the tab takes it off, and
      **Add both as features** is still the only thing that edits. Under
      **Check a primer** every binding site is previewed at once, so
      off-target sites are seen together instead of one selection at a time.
    - **Find** draws every match while the bar is open, the current one still
      the selection on top; past 200 matches it draws none, because the count
      answers that question better than 200 marks would.
    - A wrapped product taught the convention the hard way: a range over the
      origin must be **unrolled** (`unrollRange`), or `rangePieces` hands back
      a piece with `end <= start` and the span silently draws nothing. That
      was a real bug in the first cut of the Primers panel, found by reading
      the store in the browser rather than by a test.
    - Not yet: nothing in the band is clickable (the hit kind is there for
      it); ORFs, the Cloning tab's digest fragments and a previewed Golden
      Gate product are the obvious next callers; there is one channel, so
      two panels pointing at once means the last one wins; a preview does
      not come back after leaving the sidebar tab; and a previewed primer
      still does not draw its mismatches, which is the thing a scientist
      squints at.
27. **Name the features a diff removed.** `SaveReviewDialog`'s Features list
    names what was added (`+ lacZα`) and what changed (`~ tet changed`), but
    a removal is one anonymous line — `− 3 features removed` — and the Edits
    menu's one-liner likewise ends in `· −3 features`. The names are the
    thing the reviewer wants: "3 features removed" from a plasmid could be
    three stray `misc_binding`s or it could be the resistance marker.
    - **The asymmetry has a cause.** `featuresAdded` and `featuresChanged`
      are sets of ids that `featureNames` resolves against `current`, which
      the dialog holds; `featuresRemoved` is a bare `number`
      (`src/core/diff/documentDiff.ts`) because those features exist only in
      the baseline. The fix is to make it a `ReadonlySet<FeatureId>` like the
      other two and resolve it against the baseline document — `origin.doc`
      in the dialog, already at hand. Small and mechanical: the set's `.size`
      replaces the number in `isEmptyDiff` and `describeEditDiff`
      (`src/app/editsView.ts`), and no consumer of the cached diff outside
      the dialog needs the names.
    - **A name alone may not be enough.** After item 23 most features on a
      real record are unnamed, so `featureNames` falls back to the type and a
      list can read `misc_feature, misc_binding, misc_binding`. What tells
      them apart is where they were, which means the removed feature's old
      location mapped through the diff (`positionMapper` is right there in
      `diffFeatures`) — `− misc_binding 411..414`. Worth doing for added and
      changed features too, in their own coordinates.
    - **Then the list needs a cap.** None of the three lists has one today.
      Deleting 2 kb of a plasmid removes every feature on it, and the
      Features section would run to a screenful where the hunks above it
      stop at a few with "and N more places not shown"; removals should get
      the same treatment, and a removal caused by a deletion could be said
      once ("the deletion at 1,204 took 7 features with it") rather than
      seven times.
    - Touches item 21's summary line and item 22's review dialog. No data
      implications — the diff already knows everything needed.
28. **Drag the boundary between the map and the sequence.** Asked for
    2026-09-21: in the **Both** view the two panes are a fixed ratio, and a
    user who wants the map at half the screen cannot have it. The split is
    `.app__views--both` in `src/styles.css` —
    `minmax(280px, 2fr) minmax(0, 3fr)` side by side, and under 1000 px
    `minmax(240px, 1fr) minmax(0, 1.4fr)` stacked with the map on top.
    - A splitter between the panes, with the fraction remembered in
      `viewPrefs` beside the other view preferences. Two fractions, not one:
      the two layouts divide different axes, and a ratio chosen for a wide
      window is the wrong one stacked. Both views re-measure themselves
      (`ResizeObserver` in `CircularMapView` and `LinearSequenceView`), so
      nothing else has to be told the panes changed size; the map keeps its
      zoom and pan across a resize, which is right — the radius follows the
      smaller dimension.
    - Details that decide whether it feels made rather than added:
      `role="separator"` with `aria-orientation`, arrow keys to move it and
      a double-click to put it back (a drag handle is easy to make the only
      way), pointer capture so a fast drag does not lose the grab, and a
      floor on both sides — the map clamps itself to 200 px, the sequence
      view needs enough width for a column of bases at the chosen size.
    - The sidebar is a fixed 330 px (item 18) and wants exactly the same
      handle on its inner edge, so build the splitter once and use it
      twice. Guide: `03-viewing.md`.
29. ~~**Map labels are written over by the ruler, and drift across the map as
    they are spaced.**~~ fixed 2026-09-21. Reported 2026-09-21 ("the map labels
    are kind of overlap on top of each other … unless I zoom in a lot") with a
    screenshot of a 13,799 bp lentiviral construct, about 40 named features, no
    enzymes ticked. Four faults, all of them in how the ring was laid out
    rather than in how many labels there were, and one measured rather than
    seen: 610 cut-over-feature pairs, 862 feature-over-feature and 85
    cut-over-cut across 48 renders of pBR322 (`cceb5df`).
    - **The ruler's numbers are in the spacing pass now.** `drawRuler` wrote
      each tick number at `radius + 12` knowing nothing about the labels, and
      `drawLabels` placed its ring at `radius + 34` knowing nothing about the
      ticks, so `1,000` went through `CAP binding site`. `rulerTicks` works out
      where the numbers go before anything is placed and hands them to
      `layoutLabels` as `obstacles`: placed first, never moved, never dropped.
    - **A crowded label slides along the ring, not down the canvas.** The old
      pass pushed a label down and kept its `x` at the anchor's, which near 1
      o'clock carried it *inside* the circle and over the feature arrows. The
      offsets tried are now angular, so where the ring runs steeply (3 and 9
      o'clock) the label stacks vertically exactly as before, and where it runs
      flat (12 and 6) the labels spread sideways instead. A label may not slide
      past 12 or 6 o'clock: the text runs outwards from the ring, so one that
      crossed a pole would be written back across the map — found by rendering,
      not by reasoning, and the reason `PlacedLabel` carries its `box`.
    - **The drawn box is what is tested against the canvas**, not the anchor.
      `nearCanvas` admitted an anchor within `textWidth + 56` of the edge,
      which says nothing about where the text ends up, so long names on the
      left ran off it. A label is now a candidate when its *anchor* is on the
      canvas (the thing it names is on screen); its text is ellipsized to the
      room left on that side, and its box has to fit the canvas at whatever
      slot it takes.
    - **When the ring is full the map leaves labels out and says so.** The two
      clamps that squeezed a stack back inside the canvas height could only
      compress, so past a certain density labels landed on each other with
      nothing said — that, not the kind of label, is where the 610 pairs came
      from. `layoutLabels` now places in **rank** order and drops what finds no
      slot: `{ placed, dropped }`. Rank is a property of the document, never of
      the canvas, so panning does not reshuffle which labels survive — whatever
      the pointer is on first, then features longest first, then cut sites
      rarest first (a unique cutter is what a cloner is looking for). A
      `+7 labels not shown` line sits in the bottom-left corner.
    - **Hovering brings a left-out label back**, which is what makes the
      dropping affordable. The hovered label is drawn last and in a rounded
      outline (`drawBubble`) — it is the one label that may lie over its
      neighbours, and a bare rectangle of background over them reads as a hole
      punched in the map — and `EDGE_INSET` keeps every label a few pixels
      clear of the canvas so that outline is never clipped. One the ring had
      no room for is drawn on top of whatever is there, with a leader of its
      own back to the feature (`drawFloatingLabel`). Cut sites had no hit
      region at all — `hitTest` knows `backbone` and `lane` — so `cutAt` in
      `CircularMapView` finds the tick under the pointer within 6 px and
      passes `hoveredCut`; it is hover only, and a press near the backbone
      still starts a selection.
    - **Hovering does not change the layout**, which took two goes to get
      right (reported 2026-09-21 with four screenshots of pBR322's bla). The
      hovered label was ranked first so that it could never be dropped, which
      let it take the slot nearest its anchor and pushed its neighbours
      around: `beta-lactamase` and `bla` swapped places as the pointer moved
      between the two arcs. Rank is the document's alone now, and a hovered
      label that did not fit comes back through the floating path instead,
      which costs the layout nothing. The second half of the same report:
      `featuresToLabel` collapses same-named features into one label, so the
      feature under the pointer often has *no* label of its own — pBR322's
      `mat_peptide` beta-lactamase sits inside the CDS of that name — and
      nothing was highlighted while a second copy of the name was floated over
      the first. `hoveredLabelId` resolves the pointer to the nearest label of
      the same name, so the label that is already there lights up, leader and
      all.
    - **Leaders are drawn before every piece of text, and text sits on a plate
      of the background.** A label a neighbour's leader ran through was as hard
      to read as one a neighbour's name ran through, and no spacing rule can
      help with a line. An export asked for a transparent background paints no
      plate, which is the right answer for one.
    - **The map's own geometry is measured in text now** (`mapMetrics`): the
      tick, number, elbow and label radii and the line height all come from the
      sans font's size, and come out at the offsets the map has always used
      (7, 12, 26, 34) at 12 px. The export scales its fonts with `size` and had
      a fixed 14 px line height, so a 2,000 px export would have overlapped
      every label; nothing exposes `size` yet, so it was latent.
    - **The SVG export buys room instead of dropping** (`PAD_STEPS`): it
      re-renders with a larger canvas and the same circle — `outerMargin` grows
      with the canvas, so the radius does not move — and keeps the first size
      that loses nothing. A figure has no hover, so a name left out of one is
      lost for good. A 900 px export of the reported construct fits at once; a
      deliberately small 400 px export of pBR322 with every feature named grew
      to 496 px.
    - **`SvgContext.measureText` uses Helvetica's advance widths** rather than a
      flat 0.55 em. The estimate is what decides what fits, and "MCS" is 2.2 em
      of Helvetica against 1.65 em of the average — the difference between two
      labels clearing each other in an export and running together. The
      monospace path (the sequence-view export's Courier metric) is untouched.
    - **Measured by rendering, not by asserting on the layout**
      (`src/view/circular/labelCollisions.test.ts`, the harness the earlier
      count was taken with, now committed): pBR322 with every feature named and
      a 13.8 kb construct shaped like the reported one, at four canvas sizes,
      four zooms and 0/10/20/35 cut sites, comparing every drawn text box with
      every other. **0 collisions** in all 128 renders, against the 1,557 pairs
      before. `LABEL_REPORT=1` prints the table. Cost is in
      `docs/perf-notes.md`: 1.3 ms for 50 features, 6.5 ms for the absurd case
      of every cut site of all 127 bundled enzymes.
    - Not yet: **a second label ring**, which is what SnapGene does with a
      crowded map and the only thing that would raise how much fits rather than
      how well it is spaced — the drop counts are the evidence for whether it
      is worth it, and they are now visible (`+N`): a roomy canvas loses
      nothing on a real record, the Both view's 420 × 560 pane loses 19 of 42
      on the reported construct. Note that at the sides a second ring is really
      a second *column* and needs the widest text in the first one (~140 px)
      before it helps, which `OUTER_MARGIN` (110) cannot fund without shrinking
      the circle. Also not yet: the leader lines still fan out in a near-parallel
      tangle where a dozen labels bunch, nothing in the ring is clickable, and
      the label ring is sized for the sans font but `OUTER_MARGIN` is still a
      constant.
30. **Filter the enzyme list by how many times an enzyme cuts, not just
    "once".** Asked for 2026-09-21: dual cutters are what a diagnostic
    digest wants — BsrGI after an LR reaction, or checking a Golden Gate
    assembly — and the panel can only narrow to single cutters.
    - `EnzymePanel` has a `singleOnly` checkbox and filters
      `g.sites.length === 1`. The generalisation is a small control (any /
      1 / 2 / 1–2 / ≤3, or a number) in its place, with today's checkbox
      surviving as one of its values.
    - Two things are written for the boolean and have to follow it: the
      offer shown when nothing is ticked, **Tick the N enzymes that cut
      once** (`singleCutters`, which deliberately ignores the filters), and
      the footer's "N of M enzymes cut once". The default tick on opening a
      document stays single cutters (`MAX_DEFAULT_ENZYMES` in
      `editorStore.ts`) — that is a sensible default, not a filter.
    - The filter is component state, so it is forgotten on a tab switch and
      on a reload. Decide whether a cut-count choice is a view preference
      like the others or belongs to the document being looked at; the
      supplier filter and the search box have the same question and no
      answer yet.
    - **The larger want behind it.** A diagnostic digest is chosen by the
      *fragment sizes* it gives — two bands far enough apart to tell on a
      gel — and the panel already computes those for the ticked enzymes
      (`digestFragments`). "Which enzyme cuts this plasmid into bands I can
      distinguish" is a different feature from a cut-count filter, and a
      better answer to the same need: fragment sizes per enzyme in the row,
      or a sort by how well separated they are. Worth its own item if the
      filter turns out not to be enough.
    - Guide: `07-enzymes.md` describes the checkbox twice, in the filters
      list and in the how-to at the foot.

## Non-goals for v1

- Real-time multi-user editing
- Server-side computation
- Native desktop packaging
- Genome-browser-scale (>10 Mb) sequences

## Conventions

- Small, reviewable commits. Each domain-model change ships with tests.
- No `any`. Prefer discriminated unions for feature/segment types.
- Profile before adding WASM or WebGL; write down the measurement.
- Keep third-party bio libraries behind our own interfaces so they can be
  swapped out.
- Keep the user guide (`docs/guide/*.md`, rendered in the app by
  `src/app/help/`) in step with the code. Any change a user can notice
  (new feature, changed behaviour, new shortcut, bugfix that alters what
  the UI does or says) updates the relevant page in the same commit; a new
  feature gets a page or a section with a short how-to, plus an entry in
  `docs/guide/README.md` and `src/app/help/guide.ts`. Check `14-shortcuts.md`
  whenever a key binding is touched. `guide.test.ts` catches broken links
  between pages but not stale prose: reread the page.

## Open questions

- Enzyme database source: settled and built (item 7). REBASE data is all
  rights reserved, so it is imported from the user's own download rather
  than bundled. Only a full bundle would need NEB's permission.
- Which SnapGene .dna versions to support and where to get test fixtures.
- Auth provider: moot, there is no backend (decided 2026-09-21).
- Where to refuse a share link for length, and what a document opened from
  one counts as in item 22's terms (item 11).
