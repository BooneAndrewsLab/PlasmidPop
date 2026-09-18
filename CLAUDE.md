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
  names or other scientific data. Opt-in with a visible toggle, honours
  Do-Not-Track, IP anonymisation on. Instance URL and site id are
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
   Access API with download fallback. Matomo tracking (opt-in, see Stack).
10. Primer design, pairwise alignment (first TS, then WASM if needed).
11. Optional backend: auth + sync + share links.

## Status (2026-09-18)

Build order steps 1–10 are implemented and committed; step 11 (backend)
is not started. Beyond the build order, these have landed: Save GenBank /
Save as / write-back through the File System Access API, SVG map export,
selection export, find (Ctrl+F), a full feature editor, and a bundled
example (pBR322). The logo (`design/logo/`, made in Claude Design) is used
for the favicon, PWA icons (`scripts/make-icons.sh`) and the toolbar lockup
(`src/app/components/Logo.tsx`; wordmark outlined by
`scripts/make-wordmark.py`, no webfont). Tests: 312 passing. Perf measurements live in
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
2. **Copy and paste with features.** Copy a selection as a sub-document
   (see `extractRange`) and paste it into another document, shifting and
   merging annotations; internal clipboard first, then a JSON MIME type.
3. **Simulated cloning.** Cut with the shown enzymes, list fragments with
   overhangs, ligate compatible ends into a new document; later Gibson
   and Golden Gate assembly from primer/fragment sets.
4. **Translation of any selected range in six frames** with the protein
   shown in a panel and exportable as FASTA.
5. **History panel** listing undo steps with labels; jump to any state.
6. **Multiple open documents (tabs)**, prerequisite for cloning workflows
   that move DNA between constructs.
7. **Enzyme table from REBASE** once the licence question is settled;
   supplier filter and methylation sensitivity.
8. **Linear map export as SVG** (the current viewport or a chosen range),
   reusing `SvgContext`.
9. **Sequence view options**: font size, bases per row override, show
   line numbers for the complement, colour bases.
10. **Linear molecule end handling**: sticky ends and overhangs on the
    document itself after a simulated digest.
11. **Backend (step 11)**: auth, sync, share links, team libraries. Needs
    an auth-provider decision first.
12. **User documentation**: a short guide (getting started, file formats,
    editing, analysis, keyboard shortcuts) reachable from the app, plus a
    README that reads as a landing page. Required by JOSS and NAR web
    server reviewers, so it should land before any publication attempt.
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
16. **Make tiny features visible on the circular map.** Selecting a very
    short feature in the feature list (e.g. the 2 bp feature at 141..142
    in the pBR322 example) highlights a sliver that is impossible to see.
    Extend the selection highlight inward towards the centre of the map,
    or outward past the outer ring, so even a 1 bp selection is obvious.

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

## Open questions

- Enzyme database source and license (REBASE vs. curated subset).
- Which SnapGene .dna versions to support and where to get test fixtures.
- Auth provider if/when the backend lands.
