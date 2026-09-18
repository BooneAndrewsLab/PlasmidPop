# PlasmidPop

Browser-based DNA sequence editor and plasmid viewer. Everything runs in
the browser: open a GenBank, FASTA or SnapGene file and start working with
no account, no upload and no server round-trip. Works offline once loaded.

**Try it:** https://booneandrewslab.github.io/PlasmidPop/

## What it does

- **Open and save** GenBank (`.gb`, `.gbk`, `.ape`, …), FASTA and SnapGene
  `.dna`; save back to the opened GenBank file, export FASTA, export the
  map as SVG, export a selection with its features.
- **View** a linear sequence with complement, ruler, feature lanes and
  amino acids under CDS features, next to a zoomable circular map with
  labels and cut sites.
- **Edit** by typing: insert, delete, replace, copy and paste with
  features, reverse complement, set the origin, switch between circular and
  linear, with full undo and a history list.
- **Annotate**: a feature list and editor with GenBank locations
  (`join`, `complement`, wrapping the origin, partial ends) and
  qualifiers.
- **Analyse**: restriction sites for about 130 enzymes with fragment
  sizes, open reading frames, six-frame translation, primer design and
  primer checking with binding sites, pairwise alignment (global and
  local).
- **Clone in silico**: digest with chosen enzymes, collect fragments from
  several files, check every junction and ligate into a new construct.
- **Local first**: documents autosave to the browser, the last one is
  restored on reload, and the app installs as a PWA that opens sequence
  files from the file manager.

The **user guide** lives in [`docs/guide`](./docs/guide/README.md) and
opens inside the app from the **?** button at the right of the toolbar.
Start with [Getting started](./docs/guide/01-getting-started.md).

## Contributing

Issues and pull requests are welcome. PlasmidPop is MIT licensed
([LICENSE](./LICENSE)); see [CITATION.cff](./CITATION.cff) to cite it.
[CLAUDE.md](./CLAUDE.md) holds the architecture handoff, domain rules and
the list of candidate features.

## Development

Requires Node 24 (see `.nvmrc`). On this machine Node lives in the
`node` conda env:

```sh
conda activate node
npm install
npm run dev
```

| Command                 | What it does                                 |
| ----------------------- | -------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                     |
| `npm run build`         | Typecheck, then production build to `dist/`  |
| `npm run test`          | Run the Vitest suite once                    |
| `npm run test:watch`    | Vitest in watch mode                         |
| `npm run test:coverage` | Tests with V8 coverage report in `coverage/` |
| `npm run typecheck`     | `tsc -b --noEmit` across all project configs |
| `npm run lint`          | ESLint (type-aware, strict)                  |
| `npm run format`        | Prettier, write mode                         |
| `npm run check`         | Typecheck + lint + format check + tests (CI) |

## Building and deploying

`npm run build` writes a static, installable PWA to `dist/` (service worker,
manifest, icons included). Serve it from any static host; `npm run preview`
serves the build locally. For a sub-path deployment set `BASE_PATH`, e.g.
`BASE_PATH=/PlasmidPop/ npm run build`. The `deploy.yml` workflow publishes
`dist/` to GitHub Pages on every push to `main`:
https://booneandrewslab.github.io/PlasmidPop/ (the site is public even
though the repository is private; the org plan cannot restrict it).

## Layout

```
src/
  app/          React shell: editor store, toolbar, sequence view, feature list
  core/         Pure-TS domain model, no React, worker-safe
    range/      0-based half-open "unrolled" ranges, wraparound-aware shifting
    sequence/   IUPAC alphabet helpers, persistent rope (SequenceText)
    features/   Segment/Feature types, FeatureSet with interval-tree index
    document/   Immutable SeqDocument + EditOp vocabulary
    history/    Generic undo/redo stack
    analysis/   Genetic code + translation, ORF finder, enzyme table, cut-site scanner
    primers/    Nearest-neighbour Tm, primer QC, pair design, binding-site search
    alignment/  Gotoh affine-gap pairwise alignment (global/local), see docs/perf-notes.md
  view/         Canvas rendering (pure; no React)
    linear/     Row layout, feature lane assignment, linear view renderer
    circular/   Plasmid map geometry, label placement, map renderer
  workers/      Analysis Web Worker + client (inline fallback where Workers are missing)
  storage/      Dexie (IndexedDB) document store, File System Access wrappers
  io/           File formats behind one interface (parseSequenceFile)
    genbank/    GenBank flat-file parser + writer, location grammar
    fasta/      FASTA parser + writer
    snapgene/   SnapGene .dna reader (packets + XML), plus a tiny XML parser in io/xml.ts
    fixtures/   Public NCBI records used by round-trip tests
  test/         Vitest setup and shared test helpers
fixtures/local/ Private test files (gitignored); tests use them when present
  main.tsx      Entry point
```

Persistence: open documents autosave to IndexedDB (as GenBank text) and the
last one is restored on reload; Save writes back to the opened file through
the File System Access API where available, otherwise downloads. The app is
an installable PWA that works offline.

Coordinates: positions are 0-based; ranges are half-open `[start, end)`.
On circular sequences `end` may exceed the length to express a range that
wraps past the origin (`end - start` is always the base count). GenBank's
1-based inclusive coordinates are converted only at the parser/writer
boundary.

## Licence

PlasmidPop is released under the [MIT License](LICENSE). If you use it in
your research, please cite it; a `CITATION.cff` is included and GitHub shows
a "Cite this repository" button from it.
