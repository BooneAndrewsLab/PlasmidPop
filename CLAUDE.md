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
  Nothing on the user's disk is ever written to: a
  document leaves the app as a download, never through a kept file handle
  (item 24, `docs/design/24-download-only.md`).
- **Backend: none** (decided and built 2026-09-21). The app is a static site and
  stays one, so it deploys to GitHub Pages with nothing behind it. Auth,
  sync and team libraries are dropped rather than deferred; sharing, the
  one piece wanted from them, is a link that carries the document in its
  URL fragment and needs no server (item 11,
  `docs/design/11-share-links.md`). Server-side computation was never a goal and still is not.
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

## Status (2026-09-23)

**1.3.0** (2026-09-23) is the current release: sequencing reads (item 46).
AB1 and FASTQ files (gzipped too) open as documents that keep their base
qualities and trace; Align trims a read's poor ends, weighs each difference
by its quality and draws the trace under the alignment; long reads align in
a band around shared words (a 10 kb read in ~60 ms), and through the origin
of a circular plasmid; an opened AB1 shows its chromatogram above its bases.
**1.2.1** (2026-09-23) was fixes to Align from user
feedback (item 45): files dropped or picked into the Align box, with a
choice among several records; IUPAC codes scored by EDNAFULL; a 150 M-cell
limit (10 kb reads) with the strand picked first; a progress bar with
Cancel. **1.2.0** (2026-09-23) was the first of the themed
minor releases planned after 1.1. The GitHub milestones after it, reordered
the same day on user feedback about Align: 1.2.1 Align fixes and 1.3
sequencing reads (both done), then 1.4 cloning
bench, 1.5 workspace and map, 1.6 compare, history and sharing. 1.2.0 has
isoschizomers share a row, double cutters, a 4× faster scan, gel agarose and
ladder, double-digest partners (items 39–42), Dam/Dcm marks (item 44), CDS
translations re-checked as you edit (item 1), SnapGene primers fixed and
the reader checked against Biopython (item 43), sticky ends through FASTA
and SnapGene (item 10), a reverse complement that says what it changed
(item 34), and cross-tab paste with features (item 2).
**1.1.2** (2026-09-23): CDS translations read
`/transl_except`, so selenocysteine and pyrrolysine show instead of a stop
(item 1), and usage statistics carry a catalogue of every event (item 38).
**1.1.1** (2026-09-23) fixed two GenBank export faults: a LOCUS line
without a division, which Biopython refuses, and a site feature left off
the end of a circle by an edit (item 37). **1.0.0**
(2026-09-22) was the first public one, the version the repo went public at and the first archived
on Zenodo for a citable DOI. Bump `package.json` and `CITATION.cff` together;
each GitHub Release gets a DOI of its own, and the concept DOI in
`CITATION.cff` stands for all of them. **The site deploys only when a GitHub
Release is published** (`deploy.yml`; the `github-pages` environment allows
`main` and tags `v*`), so a push to main reaches no user until a release
carries it. The guide's header shows the version (`__APP_VERSION__`, defined
from `package.json` in `vite.config.ts`).

Build order steps 1–10 are implemented; step 11 (backend) is dropped. Well
beyond it: tabs, working copies and download-only saving, share links in the
URL fragment, tracked-changes marks on both views, Compare with…, SEGUID
checksums, restriction-ligation / Golden Gate / Gibson / PCR simulation, a
drawn gel with diagnostic-digest ranking, primer settings, every NCBI genetic
code, REBASE import, a phone reader, Matomo usage statistics. Perf
measurements live in `docs/perf-notes.md`.

## Where things are written down

- **Design notes: `docs/design/`.** One file per numbered item of work, with
  what was asked, what was built and why — read the relevant one before
  changing that area. "Item N" in code comments and in this file means
  `docs/design/NN-*.md`. `docs/design/README.md` indexes them and keeps the
  changelog and open questions as they stood at 1.1.0.
- **Open work: GitHub Issues** (`gh issue list`, `gh issue view N`). Bugs,
  feature ideas, the "Not yet" follow-ups of the design notes and open
  questions live there, not in this file.

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
- When a piece of work closes an issue, reference it in the commit
  (`Fixes #N`). When its reasoning is worth keeping, add or extend a design
  note in `docs/design/` in the same commit (next free number for new work,
  plus a line in its README's index) rather than writing it here. File
  follow-ups as issues rather than as a "Not yet" list.
