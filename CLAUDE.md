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

## Status (2026-09-22)

**1.0.0 is the first public release** (2026-09-22), the version the repo went
public at and the first to be archived on Zenodo for a citable DOI. Bump
`package.json` and `CITATION.cff` together; each GitHub Release gets a DOI of
its own, and the concept DOI in `CITATION.cff` stands for all of them.
**The site deploys only when a GitHub Release is published** (`deploy.yml`;
the `github-pages` environment allows `main` and tags `v*`), so a push to main
reaches no user until a release carries it. The guide's header shows the
version (`__APP_VERSION__`, defined from `package.json` in `vite.config.ts`).

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
Translations / Cut sites toggles, the Format menu's sequence-view options,
the Edits baseline, the pane sizes and whether the sidebar is open are
remembered in localStorage
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
no edit (item 26). Added 2026-09-21: the boundaries between the map, the
sequence and the sidebar are **dragged** rather than fixed ratios
(`src/app/components/Splitter.tsx`, one splitter used twice; the fractions and
the sidebar's width are remembered in `viewPrefs`, **Format ▸ Reset the
layout** puts them back), and clicking the open sidebar tab collapses the
sidebar to its rail (item 28), and the Enzymes tab filters by how often an
enzyme cuts rather than only "once" (item 30; that filter and the supplier one
are remembered, the search box is not). Added 2026-09-21: a map label slides only
a short way from its own tick, the labels read in the order their ticks are
and their leaders do not cross, all three measured by rendering rather than
asserted (item 31), and the review before a download names the features a
removal took and where they were rather than counting them (item 27).
Added 2026-09-21: **every NCBI genetic code**, generated from
NCBI's own file rather than typed in — table 2's TGA is tryptophan, and
before this a mitochondrial gene was read with the standard code and chopped
short with nothing said (item 1) — a **Code** chooser for the Translate and
ORFs tabs (item 4), and a check of each CDS against the `/translation` its
file carries, reported in the status bar when a file is opened (item 1).
Added 2026-09-21: **File ▸ Compare with…**, which reads a file, says how the
open document differs from it and drops it, sharing its body with the
download review (item 33); features are matched by content there, since two
files agree on nothing internal. Added 2026-09-21: `Alt` **key bindings** for
the view toggles, the edit marks, the sidebar, the document tabs and the
share link, and `Ctrl+Shift+←`/`→` to extend a selection a codon at a time
(item 32). Added 2026-09-22: the **circular map marks tracked changes** too —
arcs over the backbone where bases are new or replaced, a wedge where they
closed up, an outline on a feature that was touched — and the review before a
download and **Compare with…** both open with that ring, so where a change
landed is the first thing said rather than the last (item 25). Added 2026-09-22:
a molecule has a **name that does not change with how it is written** — the
SEGUID v2 checksum (`src/core/checksum/`, our own synchronous SHA-1, checked
against the reference implementations' vectors), shown short in the status bar
and copied whole on a click. **Compare with… lines a rotated plasmid up**
before diffing it instead of calling it different throughout (item 33's last
open point), and a working copy carries
`PlasmidPop-derived-from: cdseguid=… pBR322.gb` into every file and share link
it leaves as, which is what items 22 and 11 were both waiting on. Added
2026-09-22: **turning a sticky-ended molecule over moves the window** the
sequence is written over, which the checksum had just caught it not doing
(item 34). Added 2026-09-22: **a phone reader** (`PhoneShell`, item 15) — under
600 px one pane at a time behind a bar of three tabs, a toolbar cut to the name
and the File menu, touch that taps and scrolls rather than selecting, and a
tapped feature keeping its label as a hovered one does. Added 2026-09-22:
**a diagnostic digest is chosen by its bands** rather than by how often an
enzyme cuts — every row carries the bands that enzyme alone would give and an
**Order** select sorts by how far apart they are, over a model of a 1 %
agarose gel (`src/core/analysis/gel.ts`, item 30). Added 2026-09-22:
**Gibson assembly** (`src/core/cloning/gibson.ts`, item 3), which joins parts
by the homology at their ends rather than by an enzyme's overhang, and takes
its parts from the open tabs and the ligation shelf alike, as Golden Gate now
does. Added 2026-09-22: the Cloning tab **shows one reaction at a time** and
**draws the digest's fragments on both views** through the preview channel,
where clicking one shelves it (item 3); **each document tab keeps its own
sidebar panel** (item 6). Added 2026-09-22: a feature that differs between
two files is **paired with the one it became** instead of being reported as a
loss and a gain, the review says what changed about it (`type gene → CDS`),
and the outline in the views is **solid where the bases moved and broken
where only the label did** (item 35). Added 2026-09-22: **PCR**
(`src/core/cloning/pcr.ts`, `src/core/primers/anneal.ts`, item 36) — the
Cloning tab's fourth reaction and the one that *makes* a part rather than
joining parts, annealing a primer by its 3′ end so a 5′ tail (a site, a
Gibson arm, a mutation) is carried into the product; and the **gel is drawn**
rather than only described (`src/app/components/Gel.tsx`, item 30), a lane
beside a chosen ladder under the Enzymes tab's ticked fragments and under the
PCR products, where clicking a band selects that piece. Tests: 939 passing.
Perf measurements live in `docs/perf-notes.md`.

## Potential new features (not scheduled)

Ideas judged worthwhile, roughly in priority order. None is committed to;
pick from here when the current work is done.

1. ~~**Amino-acid translation under CDS features**~~: done. One line per
   CDS between the strands and the feature lanes, codon-aligned with
   alternating shading, honouring `/codon_start`, `/transl_table`, joins,
   reverse strand, partial ends and origin wrap
   (`src/core/analysis/cdsTranslation.ts`, `drawTranslations` in
   `renderLinear.ts`); "Translations" toggle in the toolbar.
   - **Every genetic code, 2026-09-21.** `codons.ts` shipped tables 1 and 11
     and they shared one codon map, so they differed only in start codons;
     anything else a file asked for was read with the standard code and
     nothing said so. A `/transl_table=2` gene came out chopped at the first
     TGA, which is tryptophan under that code. All 27 NCBI codes are now
     generated from NCBI's own `gc.prt` by `scripts/make-genetic-codes.py`
     into `src/core/analysis/geneticCodes.ts` — a hand-copied 64-character
     string is how a translation table ends up quietly wrong — and compiled
     to maps on first use. `TranslationTable` is the union of the ids we
     ship; `isStopCodon` takes one too, without which `findOrfs` ended an ORF
     at a codon the chosen code reads as an amino acid. A `/transl_table`
     naming no code NCBI uses (7, 8 and 17–20 were withdrawn) falls back to
     the standard code and says so in `CdsTranslation.unknownTable`.
   - **Checked against the file's own `/translation`, 2026-09-21**
     (`src/core/analysis/translationCheck.ts`). Most records state the
     protein they expect; that qualifier is the one honest oracle for the
     genetic code, `/codon_start`, splicing a `join(...)`, the reverse strand
     and a CDS that wraps the origin, because someone else translated the
     same bases. `checkTranslations` compares them when a file is opened and
     reports a disagreement through the status bar's parse warnings
     (`src/app/translationWarnings.ts`): the feature, where it is, the first
     residue that differs, eight at most and the rest counted. Residues
     neither side claims to know are excused — an `X` on either side, and the
     `U`/`O` of selenocysteine and pyrrolysine, which come from the
     `/transl_except` we still do not read. The six committed records state
     19 proteins and agree with us on all of them, which is a test
     (`src/io/genbank/storedTranslation.test.ts`, local fixtures included
     when present).
   - Not yet: `/transl_except`; re-checking a `/translation` as the sequence
     is edited (the check runs at open, not per keystroke).
2. ~~**Copy and paste with features.**~~ done. Ctrl+C/X in the sequence
   view copies the selection as a `SeqFragment` (bases plus trimmed
   features, `source` left behind; `src/core/document/fragment.ts`) under
   both `text/plain` and a JSON MIME type, remembering it in-tab as a
   fallback (`src/app/clipboard.ts`). Ctrl+V applies one `insertFragment`
   op (delete selection, insert bases, add shifted features with fresh
   ids), so it is a single undo step. Not yet: cross-tab paste in browsers
   that strip custom clipboard types (only the plain bases arrive there).
3. ~~**Simulated cloning.**~~ done: restriction-ligation, Golden Gate and
   Gibson. The
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
   reverse-complementing it. Not yet: partial digests,
   dephosphorylation, resolving IUPAC codes in overhangs, mixing two
   enzymes in one Golden Gate, and checking whether a set of Golden Gate
   overhangs would misligate.
   - **Gibson, 2026-09-22** (`src/core/cloning/gibson.ts`, the third reaction
     the Cloning tab's picker offers). The reaction has no enzyme, no site and no scar: each
     piece is made to end in the bases the next one starts with, and an
     exonuclease, a polymerase and a ligase join them in one tube. So there
     is nothing to digest and no overhang table to consult — the whole
     question is which end matches which, and whether that order is forced.
     `terminalOverlap` takes the *longest* shared stretch within
     `minOverlap`..`maxOverlap`, because a designed 30-mer also has a
     matching 15-base suffix and the designed one is the true junction.
     - **The product is seamless**, which is the whole point: every shared
       stretch is in it once. Each part gives up the homology it shares with
       the part before it, *except* the closing one of a circle, which is
       taken off the last part's tail instead — trimming the first part's
       head was the first cut, and it gave back the same circle written from
       an origin the user never chose. Caught by asserting the product is
       the sequence the parts were cut from, not merely its length.
     - **A circle can be followed one way round; a linear product cannot.**
       The chain walks forward from the first part, and for a linear product
       also backward, because the part the user happened to open first may
       be in the middle of it. Golden Gate never needed this: its product is
       always circular.
     - **One part is an assembly** when its own two ends share homology,
       which is how a PCR product is circularised.
     - Junctions carry the overlap's melting temperature
       (`meltingTemperature`, already there for primers). The reaction is
       held at 50 °C, so the panel marks a junction under 48 °C rather than
       refusing it: whether it anneals is a bench question, and the homology
       is real either way.
     - Circular documents are dropped with a sentence rather than ignored, as
       Golden Gate drops a piece that keeps its site. 1.0 ms for six 2 kb
       parts (`docs/perf-notes.md`), so it sits in the same main-thread memo
       the Golden Gate does.
     - **The tube takes the shelf too, 2026-09-22**, for Golden Gate as well
       as Gibson (`tube.ts`, `PartsTube.tsx`, shared by both panels). A real
       assembly mixes them — a backbone cut out of a plasmid with an insert
       amplified from somewhere else — so the open documents and the ligation
       shelf are one list with a tick each rather than a choice between them.
       A shelf fragment goes in as `documentFromFragment` makes it, the same
       linear document with its ends and features that **Open** gives, so
       neither `gibson` nor `goldenGate` changed at all. Two fragments of one
       digest with the same enzyme at both ends share a default name, and a
       name is how both panels report an ambiguity, so a repeat is numbered.
       A shelf fragment carrying no Type IIS site survives the Golden Gate's
       digest whole and joins on the sticky ends it already has, which is
       what the reaction does in the tube and needed no special case.
     - Not yet: homology *inside* a part that would anneal as readily as the
       junction it was designed for is not looked for, and neither the
       chew-back's length nor the fill-in is modelled, so a very long part
       with a very short overlap can fail on the bench while looking right
       here.
   - **One reaction at a time, and the fragments on the views, 2026-09-22.**
     Three reactions stacked down a 300 px column made the tab 3,482 px tall
     against a 931 px viewport, measured rather than guessed. They are
     alternatives, not steps, so a segmented picker under the digest chooses
     one (`cloningReaction`, kept with the view preferences because a lab
     that does Gibson does Gibson every week) and only that one renders: 807
     px, one screen. The fragment list scrolls inside itself as the enzyme
     list does, since the picker is below it and a digest of every single
     cutter of pBR322 is 35 rows.
     - The picker sits **under** the digest rather than at the top of the
       tab. The digest is the one part that is about the document in front of
       you; the three reactions work across the open tabs, and two of them
       never look at it. The line between them is the thing the tab was
       missing.
     - **The digest draws its fragments on both views** through item 26's
       preview channel, which its note had named as the obvious next caller.
       Each is a `span` — a dashed arc with a tick at either end — so a ring
       of fragments reads as fragments rather than as one unbroken band, and
       the ticks land where the enzyme cuts. The one under the pointer is an
       `arrow` instead: solid, with a head. That needed no rendering work,
       which is the channel paying for itself; two shapes it already had say
       "these are the pieces" and "this is the one you are asking about".
     - The question the preview answers is which piece is the backbone. The
       sizes cannot say where they are, and clicking a row to select it
       answers for one piece at a time.
     - **A previewed fragment is clickable** (2026-09-22) and goes to the
       shelf exactly as its **Add** button does; the panel switches to
       Ligation so it can be seen landing. The views know nothing of
       fragments: a span carries `clickable` and a click raises
       `previewActivated` (owner, id, nonce) for whoever drew it, as `reveal`
       is raised for the views. Only clickable spans answer, so Find's 200
       matches and the Primers arrows keep the behaviour the views already
       had where they are drawn — on the map that matters, because the
       preview ring is inside the backbone's own hit band and would otherwise
       shadow half of it. The nonce is seeded at mount, or coming back to the
       tab would answer the last click again and shelve a fragment by itself
       (caught by a test, not by reading).
     - Not yet: the Golden Gate and Gibson products are not previewed at all,
       which would need somewhere to draw a molecule that is not open; and a
       digest of dozens of fragments draws a busy ring, which is honest but
       not useful.
4. ~~**Translation of any selected range in six frames**~~ done. The
   Translate sidebar tab shows the selection (or the whole sequence when
   nothing is selected) in frames +1..+3 and −1..−3
   (`translateSixFrames` in `src/core/analysis/sixFrame.ts`; −1 starts at
   the 3′ end of the selection), with stop codons marked, per-frame Copy
   and an Export FASTA button that writes one protein record per frame
   (`src/app/sixFrameExport.ts`). A **Code** select (2026-09-21) picks any of
   the 27 genetic codes of item 1; it is `SharedState.geneticCode`, kept with
   the view preferences and shared with the ORFs tab
   (`GeneticCodeSelect.tsx`), because a six-frame translation and an ORF scan
   have no feature to ask which code they are reading — unlike a CDS, which
   is always read with its own `/transl_table`. The scan follows it too:
   which codons stop a reading is what an ORF is made of, so changing the
   code drops every open document's analysis, **Add as CDS feature** writes
   `/transl_table` when it is not the standard code, and the six-frame FASTA
   names it in the description lines. Clicking a residue to select its codon
   is item 19. Not yet: nothing outstanding here.
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
   reveal, find, feature editing, overwrite prompt, sidebar tab) and a
   `SharedState` for the app (view prefs, cut-site toggle, ORF threshold,
   error, assembly shelf, preview); `getState()` flattens the front tab into the same
   `EditorState` shape the views always read, plus `documents`. Methods act
   on the front tab unless they take an id (`apply`, `markDownloaded`,
   `requestSaveReview`, `activateDocument`, `closeDocument`); `setAnalysis`
   files results by the document they are for, so a slow worker answer lands
   in the right tab. `openDocument` returns the id, reuses the tab of a file
   already open (`findOpenCopy`: same file name and the document as read
   from it) and takes over an untouched "New" tab. **The sidebar tab is a
   document's own** (2026-09-22): it was shared, so opening a fragment from
   the Cloning tab moved the file it was cut from to Features as a side
   effect of the new tab wanting it. A new tab opens on the panel the last
   one was on, since opening the insert is part of the same piece of work,
   and the explicit switches after an assembly still apply to the product
   alone. The strip
   (`DocumentTabs.tsx`) has a fixed **Files** tab (the start screen,
   `showFiles`), one tab per document with a dirty dot and ×, and +; the
   editor area is keyed by document so views start afresh on a switch while
   the sidebar keeps its panels' state. Autosave writes every changed tab
   (`PersistenceService.autosaved` remembers what was written) and records
   the open ids and the front one (`openDocumentIds` in the repository);
   `restoreLastSession` reopens them all. `Alt+1`..`Alt+9` bring the
   first to the ninth tab forward (item 32). Not yet: a binding to close a
   tab (Ctrl+W belongs to the browser), dragging tabs to reorder,
   remembering scroll and zoom per tab across a switch.
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
    - **`Alt+L`** copies one without opening the File menu (item 32).
    - **`ShareNotice`** under the toolbar says what was copied — the length,
      that nothing was uploaded, and that anyone with the link can open it —
      and takes itself away after twelve seconds. A link cannot be withdrawn
      or updated, which the guide says plainly (`docs/guide/02-files.md`,
      "Sharing a link").
    - **A shared working copy now says where it came from** (2026-09-22): the
      `PlasmidPop-derived-from:` comment of item 22 is written by
      `writeGenBank`, so it is inside the payload and the reader sees the
      original's checksum and file name under the toolbar.
    - Not yet: a link always carries the whole document
      (a selection, or a document without its references, would make a much
      shorter one), and a link is GenBank only, so SnapGene-specific
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
15. ~~**Mobile-friendly layout**~~ done, 2026-09-22, as a **reader**, not a
    smaller editor. The question asked first was who holds the phone and why,
    and the answer shaped everything: someone opened a link a colleague sent
    (item 11 made that inevitable — plasmids now travel in chat messages, and
    messages are read on phones), someone at the bench or the freezer wants a
    list (which enzyme cuts once, what are the fragments), or someone is
    showing a map to a colleague. Nobody designs a primer or types a base on a
    phone. So the target was "a share link reads well on a phone", and the
    centre of gravity moved from the map to the list.
    - **`PhoneShell`** (`src/app/components/`) at `PHONE_QUERY` (600 px,
      `layout.ts`): one pane at a time — **Map**, **Sequence**, **Details** —
      behind a bar of three 48 px tabs at the foot of the screen, with the
      safe-area inset under it. Details is the Features and Enzymes panels
      alone (`SidebarPanel`, lifted out of `Sidebar` for it), on the store's
      own `sidebarTab` so a tab any other code opens is honoured, falling back
      to Features from one the phone has not got. The pane is local state,
      starting on the map, because that is what a link is opened to see; it is
      not a view preference. Tapping a row in a list bumps `reveal`, and on a
      phone the view is on another pane, so the shell answers a reveal raised
      while on Details by going to the view pane last looked at; a reveal from
      a view itself changes nothing, and the nonce present at mount is never
      answered.
    - **The toolbar is the name, the size and shape, and the File menu.** The
      view switcher is the shell's bar; the toggles, Format, Edits and History
      are for editing. `.toolbar__meta`, hidden at 720 px to make room for the
      toggles, comes back at 600 px because the toggles have gone and "4,361
      bp, circular" is the first thing a reader wants. No splitters; the
      sidebar's 200 px row of the stacked layout is overridden away.
    - **Touch is a tap, not a drag**, decided by `pointerType` rather than by
      screen size, so a tablet in the desktop layout gets the same. On the
      sequence view a finger down decides nothing — the browser owns the drag
      (`touch-action: pan-x pan-y pinch-zoom`) and the view acts on the tap at
      `pointerup` if the finger lifted within `TOUCH_SLOP` (10 px); a scroll
      arrives as a `pointercancel` or an up elsewhere and is left alone. The
      press itself is the same `press()` a mouse takes, so a tap on a feature
      bar selects the feature and one on the bases places the caret. On the
      map a finger drag was already a pan or a pinch (`touch-action: none`);
      what was missing was hover. **A tap on a feature sets the hover** to it,
      and `onPointerLeave` — which fires the moment a finger lifts — leaves a
      touch hover alone, so the tapped feature's label comes back if the ring
      dropped it and stays until the next tap. That is item 29's recovery for
      dropped labels, made to work without a pointer that rests.
    - **The reader shows the bases alone**: `LinearSequenceView`'s `reader`
      prop applies neither the Complement nor the Translations toggle, since
      each adds a line to every row and a phone has the height for neither.
      The stored preferences are untouched. Cut sites are left to the toggle:
      they rank below features in the label layout, so they cost the features
      nothing (measured: pBR322 at 390×600 draws 24 feature labels with no cut
      sites and 24 with 35), and the Enzymes tab's own "Show cut sites" link
      still works.
    - **Measured** in `labelCollisions.test.ts`, which now has a 390×600 case:
      pBR322 with every feature named draws 24 and drops 32 at zoom 1 (34 and
      22 at 900×700), 31 and 60 with 35 cut sites; the 13.8 kb construct draws
      30 and drops 26. 0 collisions, leaders ≤ 54 px, 1–5 ms. Those drop
      counts are the argument for item 29's second label ring and item 31's
      spreading a crowd about its centre: a phone is where they would pay.
    - **`@media (pointer: coarse)`** grows the things a finger lands on:
      buttons and segmented buttons to 36 px, document tabs and their × to
      36/28 px, the map's zoom buttons, the sidebar's tabs to 40 px.
    - A **notice** under the toolbar says once that this is the reader and
      editing works best on a larger screen, with **Got it** remembered in
      `localStorage` — without it the missing toolbar reads as broken. The
      guide's "On a phone" section (`03-viewing.md`) says the rest.
    - **The first look on a real phone found a map bug** (2026-09-22): the
      name in the centre of the ring was drawn as a squeezed script.
      `drawCentre` handed `fillText` its `maxWidth`, which condenses the
      glyphs sideways rather than doing anything readable (and the SVG export
      did the same through `lengthAdjust="spacingAndGlyphs"`); with four
      lanes of features inside a 390 px ring there are ~40 px in the middle.
      `fitTitle` now steps the title font down to `MIN_TITLE_PX` (11) and past
      that the name is **left out**, not shortened — the first cut ellipsized
      it, and "SYN…" says nothing the toolbar's name does not, on a phone or on
      a desktop map dragged narrow (which squished the same way). The length
      is whole or absent too, and takes the middle when the name has gone.
      Nothing on the map passes a `maxWidth` any more. Tested through the SVG:
      "pBR322" stays at 15 px, "pLenti-CMV-EGFP1" steps down whole, "SYNPBR322
      copy" at a phone's size draws nothing, and no `textLength` is written.
    - **Not done from here: tested on a real device**, which the item asked
      for and which a jsdom test cannot stand in for. Also not yet: long-press
      to select a stretch of sequence for copying (the one editor-ish thing a
      reader might want, and it fights the browser for the gesture); the
      Features list's edit and delete buttons are still there on a phone, so
      the reader can fork a working copy by accident; whether the messaging
      apps people actually use pass a 10 k-character URL fragment intact
      (Slack and email do; some SMS apps rewrite long links), which decides
      whether the link case is real; a Web Share Target so a GenBank
      attachment can be opened from a phone's mail app; hiding cut sites by
      default on a phone; and the phone pane is not remembered across a tab
      switch or a reload.
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
    space. `Ctrl+Shift+←`/`→` do it from the keyboard
    (item 32): the first press takes the codon the caret is in, as
    `Shift+Arrow` takes the base it is on, and each press after that adds one
    — along the row rather than along the protein, so a reverse-strand CDS
    extends leftwards, as dragging already did.
20. ~~**Hide cut sites without losing the enzyme selection.**~~ done. A
    **Cut sites** toggle sits next to Complement / Translations in the
    toolbar (`showCutSites` in the store); off, the sequence view, the
    circular map and both SVG exports draw no cut sites while
    `shownEnzymes` is untouched, so the chosen set comes back intact. The
    Enzymes tab says so while they are hidden, with a "Show cut sites"
    link, and its fragment list and the Cloning digest follow the ticks,
    not the toggle (both headings now say "ticked enzymes"). The toggle
    is remembered across reloads with the other view preferences
    (`src/app/state/viewPrefs.ts`) and bound to `Alt+R` (item 32).
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
    the sequence-view SVG exports too. Requested 2026-09-18. `Alt+E` turns the marks
    off and back to the chosen baseline (item 32). Not yet: the circular map
    (item 25), anything for a rename or topology change beyond the menu's
    tally.
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
      by the reference *JavaScript* implementation over the same files
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
    - **The persistent-storage request is explained before it is made**
      (2026-09-22). A user reported Firefox's "store data in persistent
      storage" dialog appearing, unexplained, after their first file was
      opened. `requestPersistentStorage` now asks the Permissions API first:
      where the state is `prompt`, `StorageNotice` (a banner under the
      toolbar, the same shelf as `DownloadNotice`) says where the documents
      are and why the browser will ask, and **Keep my documents** makes the
      request from the click, so the dialog follows the user's own action.
      The answer is reported rather than assumed: Chromium also answers
      `prompt` and then refuses in silence unless the app is installed,
      bookmarked or used often (checked in Chrome 147), so a refusal gets a
      second sentence and the guide says what helps. The choice is
      `plasmidpop.storageChoice` in localStorage (`state/storageChoice.ts`):
      `keep` asks silently every session until granted, `no` never asks. The
      start screen carries one priming sentence about it, and the guide's
      Usage statistics section explains Chrome's *local network* prompt,
      which is the Matomo host resolving to a private address on the lab
      network and nothing the app can change.
    - Not yet: nothing tells the user which stored documents have never been
      downloaded (every document lives in the browser now, so a per-row
      marker would be noise — the Files screen says it once instead).
      **File ▸ Compare with…**, the obvious companion to this, is item 33.
25. ~~**A diff on the map, not only in the sequence.**~~ done, 2026-09-22. The
    tracked-changes marks of item 21 lived only in the sequence view and its SVG
    exports; a plasmid is read as a ring, and the circular map said nothing.
    Asked for by items 22 and 33 — the review before a download and **Compare
    with…** both answered "is this the same construct" with a column of
    sequence hunks, which says *where* last.
    - **One map with marks, not two side by side**, which is the open question
      the note left. The diff is already in the newer document's coordinates
      (`featuresRemoved` carries its own mapped locations, item 27), so there
      is one molecule to draw and no second circle whose different length
      would need a geometry of its own. `CircularRenderParams.edits` is the
      same `DocumentDiff` the sequence view takes, from the same
      `useEditDiff()`, so the Edits menu's baseline drives both views and they
      cannot disagree.
    - **The marks are the backbone.** A stretch of new or replaced bases *is* a
      stretch of the molecule, so it is drawn as an arc over the ring itself
      rather than in a band of its own — which is also the only radius left:
      the feature lanes are inside it, item 26's preview ring just under it,
      and the ruler's ticks and numbers just outside, where item 29 placed
      them first and immovably. Green for inserted, amber for replaced, the
      sequence view's own colours. A mark too short to see is widened about
      its centre to 7 px of arc, item 16's rule for a short selection: a
      single inserted base of pBR322 is 0.4 px and would otherwise be nothing
      at all.
    - **A deletion has no width on the ring** — the bases it took are not on
      the molecule any more — so there is nothing to sweep, only a place to
      point at: a line across the ring at the join and a wedge just inside it
      pointing out, as the sequence view puts one over the strands. Inside
      because outside is the ruler's.
    - **Features added or edited are outlined** in the colour of the change,
      as they are in the sequence view (`editOutline`, the same shape as the
      hover outline and outranking it — the pointer already says which feature
      it is on, the colour says something nothing else does). Since
      2026-09-22 the line says which kind of change it was as well: solid
      where the feature covers different bases, broken where it covers the
      same ones under another label (item 35).
    - **The geometry is measured in text**, like everything else outside the
      backbone since item 29: the arc's thickness and the wedge are
      `mapMetrics` derived from the sans font, so a large export does not draw
      them as hairlines. That was a latent bug the first cut had, caught by
      asking the question item 29 had already answered for the label ring, and
      it is a test rather than a note.
    - **`DiffMap` puts the ring at the top of both review dialogs**
      (`DiffReview`, shared by the download review and **Compare with…**), the
      whole molecule at a fixed 380 px with no selection, cut sites or
      preview. It is `renderCircularMap` at another size, as `DiffStrip` is
      `renderLinearView` at another size, so neither review can drift from
      what the editor draws. `readCircularTheme` was lifted out of
      `CircularMapView` for it, beside the `readLinearTheme` that `DiffStrip`
      already shared.
    - **Export map as SVG carries the marks** too, as the sequence-view export
      has since item 21.
    - Measured (`docs/perf-notes.md`): 0.6 ms with no diff, 0.7 ms with ten
      marks and ten deletions, 2.4 ms with two hundred of each — there is
      nothing to lay out, and the diff itself was already computed for the
      sequence view.
    - Not yet: a **removed** feature is named in the review's Features list
      but is not drawn on the ring — where a deletion took it the wedge is
      already there, and a ghost arc for one deleted by hand has nowhere to go
      that the preview ring and the lanes have not taken. Nothing on the ring
      is clickable, so a mark cannot be jumped to (item 33 wants the same
      thing for stepping between differences). The review's map is the front
      document's own ring, not two rings tied across, so a circular plasmid
      written from another origin still reads as changed throughout — that is
      item 22's `cdseguid` checksum, not a rendering question.

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
      **Add both as features** is still the only thing that edits. **Hide
      gives the product selection back** as well as the drawing (2026-09-22,
      reported the same day): a highlight left behind reads as a pair still
      being shown, which is confusing while the other pairs are being
      hovered. Only the range **Show** selected is cleared — a selection made
      since is the user's and is left alone — which is why the panel holds
      the range it selected rather than a flag. Under
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
    - **A span can be clicked** (2026-09-22), where the panel that drew it
      marks it `clickable`: the view reports it through
      `editorStore.activatePreview` and knows nothing more. The Cloning tab's
      digest fragments were the first caller and are the reason the flag
      exists — a preview that answers a click everywhere would shadow the
      backbone's own hit band on the map, and a find match has nothing to
      say to one.
    - **PCR was the third caller** (2026-09-22, item 36) and cost the channel
      no rendering work at all: a product is a stretch of the template, so it
      is a span, and the two primers are arrows. It did show up the one-channel
      limit in the flesh — the digest above it in the same tab draws fragments
      — so the digest now stands aside while that panel is open, which is a
      decision made twice now and wants a rule if a third panel needs one.
    - Not yet: ORFs and a previewed Golden Gate or Gibson product are the
      obvious next callers, the last needing somewhere to draw a molecule
      that is not open; there is one channel, so two panels pointing at once
      means the last one wins; a preview does not come back after leaving the
      sidebar tab; and a previewed primer still does not draw its mismatches,
      which is the thing a scientist squints at.
27. ~~**Name the features a diff removed.**~~ done, 2026-09-21.
    `SaveReviewDialog`'s Features list named what was added (`+ lacZα`) and what
    changed (`~ tet changed`), but a removal was one anonymous line —
    `− 3 features removed`. The names are the thing the reviewer wants: three
    features removed from a plasmid could be three stray `misc_binding`s or it
    could be the resistance marker.
    - **The asymmetry had a cause**, and the fix the note proposed — make
      `featuresRemoved` a `ReadonlySet<FeatureId>` and resolve it against the
      baseline — is half of one. A removed feature is in *neither* document the
      dialog holds: the current one has lost it, and the baseline puts it at
      coordinates the edits have since moved. So `DocumentDiff.featuresRemoved`
      is a `ReadonlyMap<FeatureId, Feature>` carrying the feature itself with
      its location mapped through the diff (`mapFeature`, using the
      `positionMapper` that was already there for `sameFeature`). `.size`
      stands in for the old number in `isEmptyDiff` and `describeEditDiff`, so
      the Edits menu's one-liner still ends in `· −3 features` — a summary line
      is the wrong place for names.
    - **A name alone is not enough**, as the note said: after item 23 most
      features on a real record are unnamed and fall back to their type, so
      every line carries where it is — `− misc_binding 411..414`, and the same
      for added and changed features in their own coordinates. The positions
      are written the way the rest of the dialog writes one (1-based, inclusive,
      grouped), not as GenBank locations.
    - **A deletion is said once.** Deleting a stretch takes every feature on it,
      and seven lines is seven times the same event; a removed feature whose
      mapped location has collapsed onto a deletion boundary is grouped with
      the others that collapsed there: `− the deletion at 1,205 took 7 features
      with it: bla, tet, rop and 4 more`. It has to *be* a deletion — a 1 bp
      feature removed by hand also comes back covering one base — and the
      collapsed location is not always a point: delete `4..12` of a sequence
      whose base at 4 repeats after the cut and the shortest edit script
      deletes `5..13` instead, so the feature's ends map either side of the
      boundary. The rule is "covers at most one base and a deletion is at it".
    - **Each list is capped** at eight lines with the rest counted (`and 5 more
      features removed`), which none of the three had: the sequence hunks above
      stop at a dozen and say so, and the Features section could run to a
      screenful under them. A deletion's grouped line counts for all the
      features it stands for.
    - The rows are built in `src/app/featureChanges.ts` rather than in the
      dialog, which now maps over them; `featureNames` is gone.
    - A changed feature's line said only `~ tet changed` until 2026-09-22; it
      names what changed now (item 35).
    - Not yet: nothing else shows the names — the Edits menu's tally and the
      sequence view's marks are unchanged — and a removed feature's line is
      not clickable, though its location is now known.

28. ~~**Drag the boundary between the map and the sequence.**~~ done,
    2026-09-21. Asked for the same day: in the **Both** view the two panes were
    a fixed ratio (`minmax(280px, 2fr) minmax(0, 3fr)`, and stacked under
    1000 px `minmax(240px, 1fr) minmax(0, 1.4fr)`), and a user who wanted the
    map at half the screen could not have it.
    - **One `Splitter`, used twice** (`src/app/components/Splitter.tsx`): a grid
      item of its own between two panes, so the panes stay plain children and
      the container only has to give the track a width. It reads the geometry
      off the DOM — its own parent is the container — rather than being told
      the sizes, which is why nothing had to be taught that the panes changed:
      both views already re-measure themselves with a `ResizeObserver`, and the
      map keeps its zoom and pan across a resize. `onMove` hands back the first
      pane's size and the room the two share, both in px and already held to
      the floors (map 200, sequence 260 wide or 160 tall, sidebar 240, editor
      360); the caller turns that into whatever it stores. `role="separator"`
      with `aria-orientation`, `aria-valuenow`/`valuetext`, arrow keys (16 px),
      Page Up/Down (64 px), Home/End to either floor, double-click to put that
      one boundary back, and pointer capture so a fast drag keeps the grab.
      Whether a drag is under way is a **ref**, not state: the first
      `pointermove` can arrive before React has re-rendered, and a boundary
      that ignores it jumps when the second one lands (found in the browser,
      not by the tests, which flush between events).
    - **Two fractions and a width**, in `SharedState.layout`
      (`src/app/state/layout.ts`), remembered with the other view preferences:
      `viewsSplit` for the side-by-side layout, `viewsSplitStacked` for the
      stacked one — a ratio chosen for a wide window is the wrong one on the
      other axis — and `sidebarWidth` in px. The breakpoints are named there
      as well as in `styles.css` (`useMediaQuery`), because the handle has to
      know which axis it is dividing; the stylesheet keeps the old ratios as
      the fallback. **Format ▸ Reset the layout** (`resetLayout`) puts all
      three back and opens the sidebar.
    - **The sidebar puts itself away.** Asked for alongside it: clicking the
      sidebar tab that is already open collapses the sidebar to its 30 px rail
      (`sidebarOpen`, `.sidebar--collapsed`), giving the views the whole width,
      and clicking any label opens it again on that tab — the tool-window
      behaviour of the IDEs the rail was modelled on (item 18). The rail is
      always there, so there is no separate control to hide or show it and no
      way to get stuck; the panel is `hidden` rather than unmounted, so what
      was typed into it survives. A toolbar toggle was built first and taken
      out again as redundant.
    - `Alt+S` collapses the sidebar and brings it back (item 32). Not yet: no
      binding to move a boundary without tabbing to it; the stacked (≤720 px) sidebar is still a fixed
      200 px row with no handle, which belongs with item 15; and a splitter
      cannot be dragged past its floor to collapse a pane.

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
      clear of the canvas so that outline is never clipped. Its leader waits
      for the end with it: drawn in `placed` order it was painted over by
      every muted leader crossing it, so the highlight showed only on the
      stretch where nothing else ran. One the ring had
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
    - Three things asked for alongside it: a left click on empty map space
      clears the selection (a press that turns into a pan does not —
      `CLICK_SLOP`); selecting a feature scrolls its row into view when the
      Features tab is open; and a selection now remembers the feature it came
      from (`selectedFeatureId`, cleared by any plain `setSelection`), so
      clicking pBR322's CDS selects that one row rather than both it and the
      gene of the same extent. The Features tab still lights up every feature
      matching a range the user selected by hand, because a range says nothing
      about which feature was meant. The highlighted leader on the map starts
      at the *hovered* feature's lane, not the labelled one's, so hovering a
      `mat_peptide` inside a CDS draws a line that reaches the arc under the
      pointer.
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
30. ~~**Filter the enzyme list by how many times an enzyme cuts, not just
    "once".**~~ done, 2026-09-21. Asked for the same day: dual cutters are what a
    diagnostic digest wants — BsrGI after an LR reaction, or checking a Golden
    Gate assembly — and the panel could only narrow to single cutters.
    - **A "Cuts" select** in place of the `singleOnly` checkbox
      (`src/app/state/cutFilter.ts`: `CutCountFilter` is `any | once | twice |
      once-or-twice | up-to-three`, with the option label and the phrase a
      sentence needs beside each value, so the control and the prose cannot
      drift apart). `matchesCutCount` is the one place the counts are decided;
      it also refuses a zero, because the list is of enzymes that cut.
    - **The two things written for the boolean follow it.** The footer reads
      "N of M enzymes cut twice" through `cutCountPhrase`, and the offer shown
      when nothing is ticked offers what the filter asks for — "Tick the 4
      enzymes that cut twice" — falling back to the single cutters when the
      filter is *any*, which is what it always did. The offer still ignores the
      name and supplier boxes (it answers "I have nothing on the map", not "the
      list in front of me"), and it is now capped at `MAX_SHOW_LISTED` like
      **Show listed**, since "3 times or fewer" over a REBASE table is hundreds
      of enzymes and more labels than the views can draw. The default tick on
      opening a document is untouched: single cutters, up to
      `MAX_DEFAULT_ENZYMES`.
    - **Where the choice lives, which the item left open: a view preference.**
      `enzymeCutFilter` and `enzymeSupplier` are in `SharedState` and in
      `viewPrefs`, so they survive a tab switch and a reload — they say what
      the user is looking for in general, and a lab that buys from one supplier
      buys from it for every plasmid. The search box is *not* persisted: it is
      a question about the list in front of you, and coming back to a filtered
      list with a forgotten word in the box would be a puzzle. A stored
      supplier code that the table in use does not have (a different import, or
      back to the bundled table) is ignored rather than emptying the list.
    - **The larger want behind it is answered too, 2026-09-22.** A diagnostic
      digest is chosen by the *fragment sizes* it gives, and the panel
      computed those only for the ticked enzymes; a cut count says nothing
      about whether the pieces can be told apart. Every row now carries the
      bands that enzyme alone would give (`src/core/analysis/gel.ts`), and an
      **Order** select sorts the list by how far apart they are, so *Cuts:
      twice* plus *Order: band separation* is the answer rather than the two
      steps towards it. On pBR322 that puts DrdI first at 3,948 + 413 bp and
      BtsI last, whose two cuts are 20 bp apart.
      - **A gel is what is modelled, not a fragment list.** Two fragments
        within 15 % of each other run as one band, so they are *written* as
        one (`2,181 ×2`); under 100 bp a band may run off the end, and more
        than one fragment over 10 kb compresses near the well. They are the
        rules of thumb for a 1 % agarose gel and they are `GelOptions` rather
        than constants, so the judgement is in one place and a caller at
        another percentage can say so.
      - **`misleading` and `readable` are different questions**, which the
        first cut ran together and the browser caught: an enzyme that
        linearises a plasmid is not a diagnostic digest, but flagging it with
        a warning reads as "this enzyme is bad" when a unique cutter is the
        most useful enzyme there is. The ⚠ is for a lane that *hides*
        something — fragments running as one band, bands off the gel. The
        sort uses `readable`, which also wants two bands.
      - `compareDiagnostic` orders by readable, then the tightest pair of
        neighbouring bands, then fewer bands, then fewer fragments hidden
        under a shared band. The tightest pair is the measure because that is
        what "far enough apart to tell on a gel" means.
      - The profiles are computed for every enzyme rather than for the rows on
        screen, since the list can be ordered by them: 35.8 ms for a REBASE
        table of 1,581, paid once when a scan comes back rather than while
        anything is typed (`docs/perf-notes.md`). The **Fragments from ticked
        enzymes** section gained the same reading of the whole lane, which no
        single row can predict.
      - **And the lane is drawn, 2026-09-22** (`Gel.tsx`), which is what the
        note above asked for. The same numbers, not new ones: `migration` is
        written from the `maxResolved` and `minVisible` the warnings already
        use, so the picture and the prose cannot disagree about where the gel
        stops saying anything, and a band is the `GelBand` the text was built
        from. Mobility goes as the log of the length and anything off either
        end of that range is pinned to the well or the dye front. A ladder is
        chosen to span the sample — 100 bp when everything is small, 1 kb
        otherwise — since a lane with nothing to measure against is a picture
        rather than a reading. A short band is drawn faint, because a stain
        binds by mass and a 200 bp band beside a 4 kb one really is; the
        square root keeps that honest without making it invisible. Clicking a
        band selects that piece in both views, which answers the question the
        sizes cannot — which of these is the backbone.
        - SVG rather than canvas, unlike the sequence and the map: a dozen
          rectangles, not fifty thousand bases, and being in the DOM is what
          lets a band be a button and a test read the lane off without a
          rasteriser.
        - **Labelling a crowded lane took a look at a real one.** Pushing the
          numbers apart keeps every band named, which is what a three-piece
          digest wants; with pBR322's 35 single cutters ticked, sixteen bands
          sit at the foot of the lane and pushing them apart drew a fan of
          leaders across the gel. So the lane pushes only while a number stays
          within two line heights of its own band and otherwise drops what
          will not fit, as the ladder always does — the sizes are listed under
          the picture in any case, so a dropped label costs a glance and not
          the number. (The first cut computed which labels to drop and then
          drew them all anyway, which the browser caught and no test did.)
      - **A double digest is drawn beside the single ones, 2026-09-22.** Tick
        two or three enzymes and the gel has a lane for each alone and a last
        one (`Both`, `All 3`) for the digest together, which is how one is
        run and read: a band in the combined lane that is in no single lane
        is the piece between two enzymes' sites. `Gel` takes `lanes` now
        (PCR passes one). Only the last lane has its sizes written beside it —
        numbers between lanes would need the label room five times over and
        the gel would shrink until nothing on it could be read — so the
        others are named on hover and listed in a line under the picture.
        Lanes narrow from 42 to 32 units when they share the slab, a name
        longer than seven characters is cut with an ellipsis and given in
        full on hover, and the SVG's `max-width` grows with the lane count
        at the scale one lane had, so a wider gel is wider rather than
        smaller. Clicking a band in a single lane selects that enzyme's own
        piece. Past three the lane is a survey of cut sites rather than a
        digest anyone runs, and it stands alone as before.
      - **And pairs are ranked, 2026-09-22** (`bestPairs`): with the list
        ordered by band separation a **Double digests** section offers the
        five best pairs of the listed enzymes cutting ≤ 3 times, judged by
        `compareDiagnostic` on the digest with both, so every filter narrows
        the pairs too; **Tick both** ticks that pair alone and the gel above
        draws it beside each single lane. A pair whose cuts are all one
        enzyme's own is left out (it is that enzyme's digest). Quadratic, so
        at most 120 are paired, fewest cuts first — 14 ms
        (`docs/perf-notes.md`, which has how 111 ms became that).
      - **The ranking was capped because of it.** The first list of pBR322
        pairs was led by 4,259 + 102 bp — 41 times apart and a band nobody
        would see — because `compareDiagnostic` rewarded the raw ratio. Now
        separation counts up to `plenty` (2×, as distinct as bands get),
        then the smallest band up to `bright` (500 bp, since stain goes by
        mass), then the raw ratio. That moved the single-enzyme order too:
        on pBR322 *Twice* now reads HincII (3,254 + 1,107), BstAPI, DrdI
        (3,948 + 413), where DrdI led before. Both are `GelOptions`.
      - Not yet: the gel is one percentage; the ladder cannot be chosen; the
        order cannot be reversed; and the pairs are among the listed enzymes
        only, so "a partner for EcoRI" means filtering down to it and its
        candidates by hand.
    - The control took a row of its own in a 330 px sidebar (the buttons wrap
      below it); on a sidebar widened past ~430 px they share a line again,
      which is item 28 paying for itself.

31. ~~**A crowded side of the map places its labels outrageously.**~~ fixed
    2026-09-21. Reported 2026-09-21 with a screenshot: pBR322 zoomed in, the ring
    a shallow arc down the right of the pane, and the cut sites of 3,400–4,300
    labelled in a column far out to the left — `SspI (4,171)`, `ScaI (3,847)`,
    `PvuI (3,737)`, `ZraI (4,287)`, `PstI (3,612)`, `AseI (3,539)`,
    `BsaI (3,428)` — with long leaders fanning across the gap and crossing each
    other, and the labels not in the order their ticks are. Item 29 fixed labels
    landing *on top of* one another (0 collisions in 128 renders); this was the
    cost it paid for that, and it showed worst zoomed in, where one crowded arc
    holds every label at once.
    - **The slide is charged for now.** `layoutLabels` let a label slide
      `lineHeight * 16` along the ring — about 190 px, most of a pane — rather
      than be left out, and nothing charged for the distance. It is eight line
      heights (~110 px), so a label that cannot be reached in a glance from its
      own tick is left out instead and counted in the `+N` line, which is what
      item 29 made affordable. A pixel cap rather than an angular one on
      purpose: zoomed in the radius is large, so the same slide is a small
      angle, and a whole crowd could slide the same way with the angular
      spacing never looking wrong — which is exactly what the screenshot was.
    - **The ring's order is kept and no leader crosses another.** Both of the
      note's candidate rules, in the end, and it took a second report to learn
      why both are needed. The first cut tested only the leaders — a slot whose
      line back to the elbow would cut across one already drawn is refused
      (`crossesRun`, filed by the stretch of ring a leader runs over and
      compared a turn either way, because the two sides meet at 12 o'clock;
      this needed the elbow radius, which `layoutLabels` was not told, so
      `elbowRadius` is an option now). That left `SspI (4,171)` drawn *above*
      `ZraI (4,287)` on the left of the ring, 88 px from its own tick, with
      nothing crossing: a label sitting at its own anchor has only an 8 px
      radial stub for a leader, and another can slide clean past it without
      touching anything. Crossing is a consequence of breaking the order, not
      the same thing as it. So a slot must also lie between the slots its
      neighbours along the ring took (`rung`, `slots`). Over the harness's 268
      renders that is **337 pairs out of order before, 39 after**, and it is
      measured now rather than reasoned about — a third measure, read off the
      drawn leaders, since an inversion shows up in neither the collision nor
      the crossing count.
    - **They are rules and not laws.** Refusing outright cost names that
      nothing else would have lost: on the bundled pBR322 the SVG export went
      from dropping none to dropping two, because `bla` and the
      `beta-lactamase` mat_peptide inside it sit at nearly the same angle and
      one of them has to give way. So a label the rules refuse is offered what
      room is left in a second pass, with a much shorter slide
      (`rescueShift`, two line heights by default): a pair that meet beside
      their own features is a blemish, a missing name is not, and a label that
      has to travel *and* break a rule to find room is the tangle this was
      about. Over the 268 renders that pass is worth 53 labels for 14 crossing
      pairs and 39 inversions, none of them more than two in one render;
      letting it slide as far as the first pass does would buy 264 more labels
      for 289 crossings and 398 inversions, which is the disease.
    - **The export buys the long leader the screen refuses**
      (`labelShiftLines`, 16 for `exportMapSvg`, which sets `rescueShift` to
      the same budget). A figure has no pointer, so a name the ring has no room
      for beside its own feature is lost rather than one hover away — the same
      reason the export grows its canvas instead of dropping, and the reason it
      will take a long leader and a broken order rather than leave one out.
      With it the bundled pBR322 exports with nothing left out as before, at
      any size, with or without its cut sites; the absurd case of every feature
      named drops 28 where it dropped 38.
    - **Measured by rendering, as item 29 was**
      (`src/view/circular/labelCollisions.test.ts`). Two measures were added,
      since none of this overlaps and the collision count could not see it: the
      length of a leader's run from the elbow to its label, and the number of
      pairs of runs that cross, both read off the drawn SVG. So were the
      viewports the report was taken in — `fitRange` on four arcs of each
      molecule at two pane sizes, which is what a double-click on a feature and
      the **Sel** button do. Over 268 renders: **1,052 crossing pairs before,
      14 after**, **337 pairs out of order before, 39 after**, longest leader
      **209 px before, 110 after**, and the cost is 5,195 labels drawn before
      against 4,665 after (the rest are in the `+N` line and one hover away).
      Collisions stay at 0. The whole map got *faster* — 6.7 ms to 3.5 ms in
      the absurd case — because the shorter slide halves the slots a crowded
      label tries and the order rule cuts the search short as soon as a
      neighbour's slot is reached (`docs/perf-notes.md`).
    - Not yet: the labels are still placed greedily in rank order, so the
      highest-ranked of a bunch keeps its ideal spot and its neighbours work
      around it — which is why a crowd against 12 or 6 o'clock, where the ring
      has no more room in the direction the order demands, loses its
      pole-most labels to the `+N` count. A pass that spread a crowd about its centre instead would fit
      more of them at the same quality, and that — with item 29's second label
      ring — is what would raise how much a crowded map can hold rather than
      how well it is spaced.

32. ~~**Key bindings for the things that were only ever a click away.**~~ done,
    2026-09-21. Five items had ended with the same footnote — the Cut sites
    toggle (20), the Edits baseline (21), collapsing the sidebar (28),
    switching document tabs (6) and the share link (11) — plus extending a
    selection by codon (19). Separately each is a footnote; together they are
    the difference between using the app with a pointer and using it while
    working.
    - They are all `Alt` and one key, which is not a style choice: in the
      sequence view every bare letter types a base, and `Ctrl` is spoken for
      by the browser and by editing, so `Alt` is the one modifier a document
      editor can spend. `isAltKey` (`src/app/keys.ts`) matches the physical
      `code`, because on macOS `Alt+C` arrives as `ç` and a shortcut that
      works on one keyboard and not another is worse than none.
      `useViewShortcuts` (`src/app/state/`) holds them; it does nothing while
      a modal is up or a text field has the key.
    - `Alt+C`/`Alt+T`/`Alt+R` the three toolbar toggles, `Alt+E` the edit
      marks off and back to the baseline that was chosen (remembered in a
      ref, so it is the user's choice that returns), `Alt+S` the sidebar,
      `Alt+L` a share link, `Alt+1`..`Alt+9` the nth open document.
    - **Selecting by codon** lives in the sequence view, where the CDS is:
      `Ctrl+Shift+←`/`→`, the first press taking the codon the caret is in as
      `Shift+Arrow` takes the base it is on, each press after that adding
      one. Along the row rather than along the protein, so a reverse-strand
      CDS extends leftwards — which is what dragging a translation line
      already did, since it follows the pointer. `CdsTranslations` is now
      built whether or not the Translations toggle is on: the keyboard needs
      the codons even when nothing is drawing them.
    - Not yet: nothing for the view switcher, the Format menu or the sidebar
      tabs; no way to close a tab from the keyboard (`Ctrl+W` is the
      browser's); the bindings are fixed, not configurable.

33. ~~**File ▸ Compare with… another file on disk.**~~ done, 2026-09-21; asked
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
    - Not yet: no key binding; the comparison is against the front document
      only, and closing or switching tabs takes it away; nothing lets you open
      the other file from the dialog, or step from one difference to the next
      in the views.

34. ~~**Turning a sticky-ended molecule over loses the window shift.**~~ fixed
    2026-09-22. Found the same day by the checksum of item 22, which is what a
    checksum is for: `ldseguid` is invariant to which strand is on top, so
    turning a fragment over and getting a different one says the *turn* is
    wrong, not the checksum. `SeqDocument.reverseComplement` reverse-complemented
    the top strand and swapped the ends (`flipEnds`), but the new top strand is
    the old *bottom* strand, which starts and ends elsewhere: a molecule with an
    EcoRI 5′ overhang at the left and a PstI 3′ one at the right has 4 bases at
    each tip with nothing under them, and after the turn the document claimed
    all of them were double-stranded and 8 bases that are not there at all.
    Same molecule in, different molecule out.
    - **The window is one calculation now, in `ends.ts`.** `flipWindow(ends)`
      gives the bases a bottom-strand overhang carries just outside the
      sequence and that come into it (`head`, `tail`) and the bases of the
      sequence that only the top strand has and that leave it (`trimStart`,
      `trimEnd`), with `windowShift` and `flippedLength` derived from them.
      `flipFragment` (`src/core/cloning/ligate.ts`), which had the arithmetic
      right all along and inline, now asks the same function — the fragment
      and the document were never going to be two different questions, and
      `FragmentEnd` is `StrandEnd`.
    - **The document reframes itself before it reverses.** `onBottomStrand` is
      four existing ops — insert the two bottom-strand overhangs, delete the
      two top-strand ones, then put the ends back, since each of those edits
      reaches a tip and `endsAfterEdit` rightly blunts what it reaches — and
      `reverseComplement` runs over what comes out. So the trimming carries a
      feature annotated on an overhang away with the overhang, through the
      same `delete` as everywhere else, rather than through a second copy of
      extract's logic (`extractRange` cannot be imported here: it imports
      `SeqDocument`).
    - **A sticky flip changes the length**, which is the visible part and the
      reason this was its own decision rather than part of the checksum work.
      `selectionAfterOp` mirrors about the *new* length and about the moved
      window, clamping each end, so a selection on an overhang that has gone
      collapses to the tip it was at instead of pointing past the document.
      The caret path (`mapPositionThrough`) is untouched: it has never mirrored
      a reverse complement, and the store already clamps it.
    - `seguid.test.ts` has the invariance test for a sticky molecule beside the
      blunt one, `ends.test.ts` the window, the round trip and the clipped
      feature, and `editing.test.ts` the selection. All four fail without the
      fix, which was checked by taking it out.
    - Not yet: nothing tells the user the length changed — the History step
      still reads "Reverse complement" and the Edits marks show the whole
      molecule as replaced, which for a flip they always did.

35. ~~**A feature whose type changed reads as a removal and an addition.**~~
    fixed 2026-09-22, reported the same day: change a feature's type and
    **Compare with…** listed it twice, removed and added, at the same name and
    the same location. Not a bug in the pairing so much as its limit. Within
    one document the edit keeps the feature's id, so it was already reported
    as changed; across two files every id is fresh (item 33), so leftovers are
    paired by *content*, and both `bucketKey` and `sameFeature` required the
    type to be equal. A feature differing only in type paired with nothing.
    - **`pairByContent` has a second, looser pass now**
      (`src/core/diff/documentDiff.ts`). The first pairs features that agree
      about everything, which says nothing to the user; the second asks the
      weaker question of whatever is left over — is this the same feature with
      something changed about it? A feature is *somewhere*, so the mapped
      location has to match, and it has to still be recognisable: the same
      name, or failing that the same type. That catches an edited type (the
      name matches) and a rename (the type matches), and the pair is reported
      as one change rather than a loss and a gain at one place. Two lines read
      as "you have lost a feature", which is the frightening reading and the
      wrong one.
    - **A shared location alone is not enough**, which is the rule that keeps
      it honest: pBR322 carries a `gene` and the `CDS` inside it over exactly
      the same bases, twice, and they are not versions of one another. That is
      a test.
    - **`featuresChanged` carries the before**, mapped into the newer
      document's coordinates as `featuresRemoved` already was, rather than
      being a bare set of ids: a paired feature has a different id on each
      side, so there is nothing to look the older version up by, and the
      review wants to say what changed anyway. `.has` and `.size` are what the
      renderers and the Edits tally use, so a Map was a drop-in.
    - **The review says what changed**, not merely that it did:
      `~ tet type gene → CDS` (`describeFeatureChange` in
      `src/app/featureChanges.ts`), naming the fields that are one thing each
      — type, name, strand, whether it moved — and counting qualifiers, since
      a `/note` can be a paragraph. Where it went is the column every row
      already has.
    - **The outline says which kind of change it was** (2026-09-22): solid
      where the feature covers different bases than it did, broken where it
      covers the same ones under another label — retyped, renamed, a
      qualifier edited. That is the one distinction a line can carry and the
      one worth carrying, since the first can break a construct and the
      second cannot. `sameFeatureLocation` answers it off the before the diff
      now holds, which is already mapped into the newer document's
      coordinates, so a feature that only *shifted* under an edit elsewhere
      is not called moved. Both renderers and so both review dialogs and both
      SVG exports get it from the one helper.
    - Not yet: a feature that both moved *and* was renamed pairs with nothing,
      since the location is the one thing the looser pass will not give up.
36. ~~**PCR: the reaction that makes a part.**~~ done, 2026-09-22
    (`src/core/cloning/pcr.ts`, `src/core/primers/anneal.ts`, the Cloning
    tab's fourth reaction). A digest takes a molecule apart and Golden Gate
    and Gibson put molecules together, but nothing could *make* a part, so an
    assembly could only be built out of files that already existed. Almost no
    bench work is like that: the insert is amplified, the backbone is
    amplified, and the homology a Gibson joins them by is on the primers
    rather than in any file. Item 3 and item 26 both end on wants this
    answers.
    - **A primer is not its binding site.** It is a 3′ part that anneals and a
      5′ tail that does not, and the tail is where the restriction site, the
      homology arm, the tag or the mutation lives.
      `findPrimerBindingSites` asks whether the *whole* oligo matches, which
      is the right question for "is this specific to my plasmid" and cannot
      see a cloning primer at all. `findAnnealingSites` walks back from the 3′
      end instead — the end a polymerase extends from, and where a mismatch
      stops the reaction whatever the rest does — and reports the leftover as
      a tail. The run is trimmed back to a match, so a site never begins on a
      mismatch, and a tail base that happens to pair does pair: that changes
      the report and not the molecule, which is a test rather than a note.
    - **The product is the primers' sequence, not the template's.** The first
      cycle copies the template and every cycle after copies the product, so a
      mismatch under a primer is a mutation to write down rather than an error
      to flag. Site-directed mutagenesis therefore needs nothing of its own:
      design the primer with the change in it and amplify.
    - **Upper case in the product means "not from the template".** The
      annealed bases are written in the template's own case and only the
      tails and the mismatches in the primer's, so the capitals in a product
      are exactly what the template did not supply — which is how a primer is
      written out in a paper, and is free. (Writing the oligo over the
      template shouts the whole annealing region, since primers are cleaned
      to upper case and an ORIGIN block is lower: seen in the browser, not in
      a test, and now both.)
    - **Inverse PCR needs no case either.** On a circle the product is the
      stretch from the forward primer round to the reverse one, so back-to-back
      primers give nearly the whole plasmid — which is how a vector is
      linearised for a Gibson. A pair pointing away from each other on a
      *linear* template is refused with that sentence.
    - **The panel asks for two oligos and nothing else**, because everything a
      designer decided is already in them. It reports what they would do: the
      lengths, the tails, the Tm of the annealing part, where each lands, and
      the products — cleanest and shortest first, since an exactly-matched
      short amplicon out-competes the rest in the tube. Every product and
      every site is drawn through item 26's preview channel until one is
      picked, which is how an off-target band is seen beside the wanted one;
      clicking a previewed product opens it, as clicking a digest fragment
      shelves it. The digest gives up the preview channel while the panel is
      open, there being one of them.
    - **PCR is first in the picker** and, with the digest, one of the two
      things in the tab that are about the document in front of you rather
      than about the tube of open tabs: a PCR has one template.
    - The products are drawn as a gel (item 30). One band is what a real gel
      gets compared against; two are the question of whether they could be
      told apart, which is why the gel is drawn at all.
    - **Measured** (`docs/perf-notes.md`): 2.1 ms for a plasmid, 11 ms for
      50 kb, so it runs in a main-thread memo on every keystroke like the two
      one-pot panels. The 50 kb case gives six spurious products, which is not
      a modelling error — over 100 kb of searchable strand a 15-base 3′ match
      with two mismatches turns up by chance, and a long template really does
      prime in more places. It is why the products are sorted by mismatches
      first and capped.
    - The last test amplifies a vector by inverse PCR, amplifies an insert
      from a *different* molecule with tails that anneal nowhere on it, and
      hands both to `gibson`: the loop this closes.
    - Not yet: the template is the document in front of you, so amplifying
      from another tab means switching to it, and the product is not put on
      the ligation shelf for you (**Open** it and it joins the tube like any
      other tab). A-tailing is not modelled, so the product is blunt and TA
      cloning is not there; neither are primer dimers, nor the polymerase's
      processivity beyond a flat 20 kb ceiling; a mismatched site's Tm is
      reported as if it matched.

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
- Whether the `/translation` check should follow edits rather than run only
  when a file is opened, and where a per-feature "this no longer matches"
  marker would live if it did (item 1).
- Auth provider: moot, there is no backend (decided 2026-09-21).
- Where to refuse a share link for length, and what a document opened from
  one counts as in item 22's terms (item 11).
- Whether a preview can show a molecule that is not open. The channel draws
  spans on the document in front of you, which is why a Golden Gate or Gibson
  product cannot be previewed before it is assembled: it is a different
  molecule, not a range of this one. A PCR product *is* a range of this one,
  which is why item 36 could preview its products and those two still cannot.
  Opening it and looking is the answer for now, and a second surface to draw
  on is a much larger idea than the want behind it (items 3, 26 and 36).
- Whether the shelf is the ligation's or the bench's. Both one-pot reactions
  take parts from it now, and a fragment clicked in a view lands there, but
  it still lives under **Ligation** and adding to it switches the picker
  there. If it grows a third use it wants a place of its own (item 3). A PCR
  product is the obvious third thing to put on it and deliberately is not:
  it opens as a tab, which the tube already takes (item 36).
