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
  Cloud sync is opt-in.
- **Backend (thin):** Auth, sync, sharing links, team libraries only. No
  computation server-side. Node/TS (Hono or Fastify) or Rust/Axum, Postgres,
  S3-compatible object storage. Supabase is acceptable for a fast launch.
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
11. Optional backend: auth + sync + share links.

## Status (2026-09-18)

Build order steps 1–10 are implemented and committed; step 11 (backend)
is not started. Beyond the build order, these have landed: Save GenBank /
Save as / write-back through the File System Access API, SVG map export,
selection export, find (Ctrl+F), a full feature editor, a History sidebar
tab, sequence-view / selection SVG export, tracked-changes marks for the
sequence view (`src/core/diff/`, the **Edits** menu), a bundled example
(pBR322), and Matomo usage statistics (`src/app/analytics.ts`,
always on when configured, no user toggle by decision of 2026-09-18;
events at file open/new/save/export, enzyme show, primer design, align,
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
reload, and Golden Gate assembly (items 5 and 3 under "Potential new
features"). Tests: 580 passing. Perf measurements live in
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
   one Type IIS enzyme (`isTypeIIS`, `GOLDEN_GATE_ENZYMES`, BsaI by
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
   on the front tab unless they take an id (`apply`, `markSaved`,
   `setFileHandle`, `requestOverwrite`, `closeDocument`); `setAnalysis`
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
7. **Enzyme table from REBASE**: supplier filter and methylation
   sensitivity, over the 127 enzymes hand-typed from supplier catalogues in
   `src/core/analysis/enzymeTable.ts`. Shelved 2026-09-19, but the licence
   question is settled and the route is chosen; what is left is the work.
   - **Licence.** Every REBASE data file opens with `Copyright (c) Dr.
     Richard J. Roberts, <year>. All rights reserved.` — no redistribution
     grant in the file. (The CC BY-NC that search engines offer up covers
     the *NAR papers*, not the data.) So shipping REBASE data in this repo
     or on the Pages site needs permission, whoever fetches it and however
     it gets there.
   - **The app cannot fetch it at runtime.** `rebase.neb.com` sends no
     `Access-Control-Allow-Origin`, so a browser `fetch()` from our origin
     is blocked; `ftp.neb.com` is moot since Chrome 95 dropped FTP. A CORS
     proxy would be both a server (a non-goal) and us redistributing it
     anyway; downloading at build time is bundling with extra steps;
     third-party GitHub mirrors do send `access-control-allow-origin: *`
     but are someone else's copy of an all-rights-reserved file.
   - **Chosen route: import, do not ship.** The user downloads
     `link_emboss_e` (or `withrefm`) from rebase.neb.com themselves and
     opens it; we parse once and keep it in IndexedDB. No CORS, no server,
     no redistribution, works offline after the first time, and it doubles
     as a custom-enzyme-list feature. Nothing about it is blocked. Keep the
     curated table as the default set, and its supplier/methylation columns
     can be typed from supplier catalogues by hand the way the sites were.
   - **If a full bundle is ever wanted**, ask Dana Macelis
    , who runs REBASE distribution, copying Rich Roberts
    , the copyright holder and correspondence author on
     every REBASE paper. The ask that gets a yes is narrow: the data file
     keeps REBASE's own terms and notice rather than falling under our MIT
     grant, we cite the NAR paper in the UI, and we refresh from the
     official files rather than forking them. Asking them to effectively
     MIT-license REBASE is a different and much larger request.
   - **Format notes for the importer.** `link_emboss_e` is
     `name pattern len ncuts blunt c1 c2 c3 c4`, and `c1`/`c2` use our own
     convention — offsets from the first base of the site, EcoRI is `1 5`,
     Type IIS have `c1 > len` — so the parse is nearly a straight read.
     But `c3`/`c4` are a *second* pair of cuts: BcgI and the other
     double-cutters excise a fragment, and `Enzyme` has room for one pair.
     An import either skips `ncuts == 4` or the model grows, which reaches
     `digest`, `ligate` and the cut-site drawing. REBASE cuts a release a
     month (609 was 2026-08-27), so show the version loaded.
   - **Before shipping thousands of enzymes**, measure: ~4,000 patterns
     over a 5 kb plasmid is ~20M mask ops a scan, fine in the worker but it
     belongs in `docs/perf-notes.md`, and `EnzymePanel` needs virtualizing
     or a default "commercially available only" filter before it renders
     that many rows.
   - The real prize is methylation sensitivity: Dam is `GATC` and Dcm is
     `CCWGG`, so a per-enzyme flag plus the flanking bases lets us mark
     *the site in this plasmid* as blocked, not just warn about the enzyme.
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
11. **Backend (step 11)**: auth, sync, share links, team libraries. Needs
    an auth-provider decision first.
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

- Enzyme database source: settled on licence (REBASE data is all rights
  reserved, see item 7) and on route (user-imported file, not bundled);
  the work itself is shelved.
- Which SnapGene .dna versions to support and where to get test fixtures.
- Auth provider if/when the backend lands.
