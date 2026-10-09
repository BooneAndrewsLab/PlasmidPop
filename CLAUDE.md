# PlasmidPop — Project Handoff

This file is loaded into every session, so it holds only what changes how
the code is worked on: decisions, rules, conventions, pointers. It is not a
changelog or a status report. A release updates its one version line and
nothing else; what a release did goes in the GitHub Release notes, why in a
design note, what is left in an issue. `src/claudeMd.test.ts` fails the
build if it grows past its budget or regains a per-release paragraph.

## What this is

PlasmidPop is a browser-based DNA sequence editor and plasmid viewer,
comparable in scope to SnapGene: open/edit/save sequences, annotate
features, linear and circular maps, restriction analysis, ORFs, primers,
pairwise alignment, sequencing reads, a cloning bench — all client-side.
A scientist opens a GenBank file and starts working with no account and no
server round-trip.

## Stack (decided)

- **Language:** TypeScript everywhere, strict mode, no `any`.
- **UI:** React + Vite. Teselagen Open Vector Editor and Lattice seqviz are
  reference implementations to study, not depend on; check licenses before
  copying anything.
- **Rendering:** Canvas 2D for the sequence view and the circular map. Never
  render the sequence with DOM or SVG — it will not scale past ~50 kb. SVG
  is only for publication-quality export. PixiJS/WebGL only if Canvas 2D
  is measured to be too slow.
- **Compute:** Plain TS in Web Workers; the main thread never blocks. Rust →
  WASM only where profiling justifies it (pairwise alignment and
  genome-scale restriction scans are the candidates); none shipped so far.
- **Data model:** Immutable document with undo/redo; sequence in a rope or
  piece table, features in an interval tree. Keep it CRDT-friendly so Yjs
  can be layered on later rather than retrofitted.
- **Storage:** Local-first, IndexedDB via Dexie. The app never writes to the
  user's disk: a document leaves as a download, never through a kept file
  handle (item 24).
- **Backend: none.** A static site on GitHub Pages, and it stays one. Auth,
  sync and team libraries are dropped, not deferred. Sharing is a link that
  carries the document in its URL fragment (item 11). The one third-party
  request is NCBI efetch by accession; only the accessions leave the browser.
- **File formats:** GenBank, FASTA, SnapGene .dna/.prot/.rna, AB1, FASTQ
  (gzipped too), protein FASTA/GenPept. The parsers and writers are ours;
  round-tripping is where third-party ones break.
- **Distribution:** PWA. No Electron/Tauri for v1.
- **Analytics:** Matomo, self-hosted. Page views and coarse feature events
  only, never sequence content or file names; no user-facing toggle;
  honours Do-Not-Track, cookieless, IP anonymised. `VITE_MATOMO_URL` and
  `VITE_MATOMO_SITE_ID` are build-time config; unset, the tracker is a
  no-op (item 38 catalogues the events).

## Domain rules that cause bugs

- Sequences may be linear or circular. Every position/range operation must
  handle wraparound on circular sequences.
- Be explicit about 0- vs 1-based indexing at every boundary. Internal model
  is 0-based half-open `[start, end)`; GenBank I/O is 1-based inclusive.
- Reverse-strand features have coordinates on the forward strand but read
  in reverse; translations must reverse-complement first.
- Features can be multi-segment (GenBank `join(...)`, `order(...)`).
  Preserve segments on round-trip.
- IUPAC ambiguity codes (N, R, Y, etc.) must be accepted in input and in
  restriction-site recognition sequences.
- Restriction enzymes: model recognition sequence, cut position on both
  strands (can be outside the recognition site, e.g. Type IIS), and
  palindromic vs. non-palindromic behavior. Digests respect the document's
  host methylation (dam/dcm).

## Releasing

Few, large, themed releases, one GitHub milestone each; current is 1.12.0
(2026-10-09). Each GitHub Release gets a Zenodo DOI; the concept DOI in
`CITATION.cff` stands for all of them. Before a release run
`npm run mutate` (Stryker, incremental, never in CI; item 50) and triage
its survivors. Bump `package.json` and `CITATION.cff` together. **The site
deploys only when a GitHub Release is published** (`deploy.yml`); a push to
main reaches no user until a release carries it. The guide's header shows
`__APP_VERSION__`, defined from `package.json` in `vite.config.ts`.

## Where things are written down

- **Design notes: `docs/design/`**, one file per numbered item of work —
  what was asked, what was built and why. "Item N" in code comments and
  here means `docs/design/NN-*.md`; read the relevant one before changing
  that area. `docs/design/README.md` indexes them.
- **What each release did:** GitHub Releases (`gh release view vX.Y.Z`).
- **Open work:** GitHub Issues (`gh issue list`, `gh issue view N`), not
  this file.
- **User guide:** `docs/guide/*.md`, rendered in the app by `src/app/help/`.
- **Perf measurements:** `docs/perf-notes.md`.

## Non-goals

Real-time multi-user editing, server-side computation, native desktop
packaging, genome-browser-scale (>10 Mb) sequences.

## Conventions

- Small, reviewable commits. Each domain-model change ships with tests.
  Prefer discriminated unions for feature/segment types. Profile before
  adding WASM or WebGL; write down the measurement. Keep third-party bio
  libraries behind our own interfaces.
- Keep the user guide in step with the code. Any change a user can notice
  (new feature, changed behaviour, new shortcut, bugfix that alters what
  the UI does or says) updates the relevant guide page in the same commit;
  a new feature gets a page or a section with a short how-to, plus an entry
  in `docs/guide/README.md` and `src/app/help/guide.ts`. Check
  `14-shortcuts.md` whenever a key binding is touched. `guide.test.ts`
  catches broken links between pages but not stale prose: reread the page.
- When a piece of work closes an issue, reference it in the commit
  (`Fixes #N`). When its reasoning is worth keeping, add or extend a design
  note in `docs/design/` in the same commit (next free number for new work,
  plus a line in its README's index) rather than writing it here. File
  follow-ups as issues rather than as a "Not yet" list.
