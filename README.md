# PlasmidPop

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22907552.svg)](https://doi.org/10.5281/zenodo.22907552)

Browser-based DNA sequence editor and plasmid viewer. Everything runs in
the browser: open a GenBank, FASTA or SnapGene file and start working with
no account, no upload and no server round-trip. Works offline once loaded.

**Try it:** https://booneandrewslab.github.io/PlasmidPop/

## What it does

- **Open** GenBank (`.gb`, `.gbk`, `.ape`, …), FASTA and SnapGene `.dna`;
  **download** GenBank (the file you opened is never written to), export
  FASTA, export the map or the sequence view as SVG, export a selection
  with its features.
- **View** a linear sequence with complement, ruler, feature lanes and
  amino acids under CDS features, next to a zoomable circular map with
  labels and cut sites.
- **Edit** by typing: insert, delete, replace, copy and paste with
  features, reverse complement, set the origin, switch between circular and
  linear, with full undo, a history list and tracked-changes marks over
  what you changed.
- **Annotate**: a feature list and editor with GenBank locations
  (`join`, `complement`, wrapping the origin, partial ends) and
  qualifiers.
- **Analyse**: restriction sites for about 130 bundled enzymes — or the
  whole of REBASE, imported from your own download — with fragment sizes,
  open reading frames, six-frame translation, primer design and primer
  checking with binding sites, pairwise alignment (global and local).
- **Clone in silico**: digest with chosen enzymes, collect fragments from
  several open documents, check every junction and ligate into a new
  construct, or run a Golden Gate reaction over the open parts.
- **Several documents at once**, each in its own tab, with the file list as
  a tab of its own.
- **Share** a document as a link that carries it whole in the URL fragment,
  so the sequence goes to the person you send it to without being uploaded
  anywhere. There is no backend at all.
- **Local first**: documents autosave to the browser, the open tabs are
  restored on reload, and the app installs as a PWA that opens sequence
  files from the file manager.

The **user guide** lives in [`docs/guide`](./docs/guide/README.md) and
opens inside the app from the **?** button at the right of the toolbar.
Start with [Getting started](./docs/guide/01-getting-started.md).

## Contributing

Issues and pull requests are welcome. PlasmidPop is MIT licensed
([LICENSE](./LICENSE)); see [CITATION.cff](./CITATION.cff) to cite it.
[CLAUDE.md](./CLAUDE.md) holds the architecture handoff and domain rules,
[docs/design/](./docs/design/README.md) the reasoning behind each piece of
work, and planned work and ideas are in the
[issue tracker](https://github.com/BooneAndrewsLab/PlasmidPop/issues).

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
    diff/       Myers diff of two document versions, for the edit marks
    cloning/    Digest into fragments, ligation and Golden Gate assembly
    analysis/   Genetic code + translation, ORF finder, enzyme table, cut-site scanner
    primers/    Nearest-neighbour Tm, primer QC, pair design, binding-site search
    alignment/  Gotoh affine-gap pairwise alignment (global/local), see docs/perf-notes.md
  view/         Canvas rendering (pure; no React)
    linear/     Row layout, feature lane assignment, linear view renderer
    circular/   Plasmid map geometry, label placement, map renderer
    svg/        The same renderers against an SVG context, for the exports
  workers/      Analysis Web Worker + client (inline fallback where Workers are missing)
  storage/      Dexie (IndexedDB) document store, file picker / save dialog wrappers
  io/           File formats behind one interface (parseSequenceFile)
    genbank/    GenBank flat-file parser + writer, location grammar
    fasta/      FASTA parser + writer
    snapgene/   SnapGene .dna reader (packets + XML), plus a tiny XML parser in io/xml.ts
    rebase/     Reader for a REBASE withrefm file the user imports
    fixtures/   Public NCBI records used by round-trip tests
  test/         Vitest setup and shared test helpers
fixtures/local/ Private test files (gitignored); tests use them when present
  main.tsx      Entry point
```

Persistence: open documents autosave to IndexedDB (as GenBank text) and the
tabs that were open are restored on reload. Nothing is ever written to a
file on disk: the first edit of an opened file forks a working copy, and a
document leaves the app as a download, which shows what the copy
changed first, or inside a share link. The download goes through the save
dialog where the File System Access API is available (the handle is used
once and dropped) and as an ordinary browser download otherwise. A share
link (`src/io/share/`, `src/app/share.ts`) is the document as GenBank,
deflated into the URL fragment — never sent to a server, since a fragment
does not leave the browser. The app is an installable PWA that works
offline.

Usage statistics: `src/app/analytics.ts` talks to a self-hosted Matomo
instance when `VITE_MATOMO_URL` and `VITE_MATOMO_SITE_ID` are set at build
time (the Pages workflow sets them); otherwise it is a no-op. Honours
Do-Not-Track, cookieless, and sends only coarse feature events, never
sequence data.

Coordinates: positions are 0-based; ranges are half-open `[start, end)`.
On circular sequences `end` may exceed the length to express a range that
wraps past the origin (`end - start` is always the base count). GenBank's
1-based inclusive coordinates are converted only at the parser/writer
boundary.

## Citing PlasmidPop

If you use PlasmidPop in your research, please cite it by its DOI:

> Usaj, M. PlasmidPop. Zenodo. https://doi.org/10.5281/zenodo.22907552

That DOI stands for every version and always leads to the newest one. Each
release has a DOI of its own as well, listed on the Zenodo record, for when
the exact version matters (1.0.0 is
[10.5281/zenodo.22907553](https://doi.org/10.5281/zenodo.22907553)). GitHub's
"Cite this repository" button gives the same citation in APA and BibTeX,
read from `CITATION.cff`.

## Licence

PlasmidPop is released under the [MIT License](LICENSE).
