# PlasmidPop

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.22907552.svg)](https://doi.org/10.5281/zenodo.22907552)

Browser-based DNA sequence editor and plasmid viewer. Everything runs in
the browser: open a GenBank, FASTA or SnapGene file and start working with
no account, no upload and no server round-trip. Works offline once loaded.

**Try it:** https://booneandrewslab.github.io/PlasmidPop/

## What it does

- **Open** GenBank (`.gb`, `.gbk`, `.ape`, …), FASTA, SnapGene `.dna`,
  GenPept and protein FASTA, sequencing reads (AB1 with their traces, FASTQ,
  gzipped or not), or a record from NCBI by accession;
  **download** GenBank (the file you opened is never written to), export
  FASTA or FASTQ, export the map or the sequence view as SVG, export a
  selection with its features.
- **View** a linear sequence with complement, ruler, feature lanes and amino
  acids under CDS features — numbered, if you like — next to a zoomable
  circular map with labels spread around crowding, cut sites and a second
  ring where it needs one.
- **Edit** by typing: insert, delete, replace, copy and paste with features,
  reverse complement, set the origin, switch between circular and linear,
  with full undo, a history list that **survives a reload**, named states
  and tracked-changes marks over what you changed. **Compare with…** any
  other tab or a file on disk.
- **Annotate**: a feature list and editor with GenBank locations (`join`,
  `complement`, wrapping the origin, partial ends) and qualifiers, and
  **Detect features** — a bundled library of common parts, fluorescent
  proteins and tags, matched on both strands, through the origin, and in the
  six translations for the parts every vector spells its own way.
- **Analyse**: restriction sites for about 130 bundled enzymes — or the
  whole of REBASE, imported from your own download — with fragment sizes, a
  drawn gel and diagnostic-digest ranking, open reading frames, six-frame
  translation, primer design and checking, a collection of **My primers**
  searched against any document, pairwise alignment (global and local), and
  protein properties for a protein document.
- **Clone in silico** on the **Bench**: digest (complete or partial) with
  chosen enzymes, collect fragments from several documents on a shelf, and
  ligate, assemble by Golden Gate, Gibson, In-Fusion or NEBuilder, or
  recombine by Gateway — every junction checked, with host methylation,
  dephosphorylation and misligation warnings. PCR with Taq or a
  proofreading polymerase, site-directed mutagenesis (Q5 or QuikChange), and
  a check digest of the product beside the empty vector before you pick
  colonies.
- **Made from**: every product records how it was made, kept in the GenBank
  file it is saved to, and a SnapGene file's own history is read into the
  same tree.
- **Several documents at once**, each in its own tab, with the file list and
  the Bench as tabs of their own.
- **Share** a document as a link that carries it whole in the URL fragment,
  so the sequence goes to the person you send it to without being uploaded
  anywhere. There is no backend at all.
- **Local first**: documents autosave to the browser, the open tabs and the
  undo history are restored on reload, and the app installs as a PWA that
  opens sequence files from the file manager. On a phone it opens as a
  reader.

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

Requires Node 24 (see `.nvmrc`):

```sh
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
`dist/` to https://booneandrewslab.github.io/PlasmidPop/ **when a GitHub
Release is published**, not on every push: `main` can move without the site
moving with it, and each release is archived on Zenodo with a DOI of its
own.

## Layout

```
src/
  app/          React shell: editor store, toolbar, views, panels, the Bench
    components/ Every panel and dialog; the sequence view and the map live here
    state/      The store, persistence, view preferences, panel memory
    help/       The user guide rendered in the app, from docs/guide
  core/         Pure-TS domain model, no React, worker-safe
    range/      0-based half-open "unrolled" ranges, wraparound-aware shifting
    sequence/   IUPAC alphabet helpers (DNA and protein), persistent rope
    features/   Segment/Feature types, FeatureSet with interval-tree index
    document/   Immutable SeqDocument + EditOp vocabulary
    history/    Generic undo/redo stack, with coalescing and named states
    diff/       Myers diff of two document versions, for the edit marks
    cloning/    Digest, ligation, Golden Gate, Gibson, Gateway, PCR, mutagenesis
    analysis/   Genetic codes, ORFs, enzymes and cut sites, gels, codon usage
    annotate/   Detect features: the bundled part library and the matcher
    primers/    Nearest-neighbour and NEB Q5 Tm, primer QC, design, binding sites
    alignment/  Gotoh affine-gap pairwise alignment (global/local)
    lineage/    "Made from": how a product was made, as a tree
    checksum/   SEGUID v2 checksums of a document
  view/         Canvas rendering (pure; no React)
    linear/     Row layout, feature lane assignment, linear view renderer
    circular/   Plasmid map geometry, label placement, map renderer
    svg/        The same renderers against an SVG context, for the exports
  workers/      Analysis Web Worker + client (inline fallback where Workers are missing)
  storage/      Dexie (IndexedDB) document store, history codec, file pickers
  io/           File formats behind one interface (parseSequenceFile)
    genbank/    GenBank and GenPept parser + writer, location grammar
    fasta/      FASTA parser + writer
    fastq/      FASTQ reader and writer, gzip-aware
    abif/       AB1 chromatograms: bases, qualities and the trace
    snapgene/   SnapGene .dna reader (packets, XML, its history tree)
    rebase/     Reader for a REBASE withrefm file the user imports
    ncbi/       Fetching a record by accession (the one third-party request)
    share/      A document packed into a URL fragment
    fixtures/   Public NCBI records used by round-trip tests
  test/         Vitest setup and shared test helpers
scripts/        Build-time tools: the feature database, icons, genetic codes
fixtures/local/ Private test files (gitignored); tests use them when present
docs/
  guide/        The user guide, also rendered in the app
  design/       One note per numbered piece of work, and why it is that way
  perf-notes.md Measurements, with what was tried and what it cost
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

Open from NCBI (`src/io/ncbi/`, `src/app/openFromNcbi.ts`) is the one
request the editor makes to a third party, and only when the user presses
Open: E-utilities `efetch` answers browsers directly (CORS), and what it is
sent is the accession numbers and `tool=PlasmidPop` — no cookies, no
referrer, no API key or e-mail address.

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
the exact version matters. GitHub's "Cite this repository" button gives the
same citation in APA and BibTeX, read from `CITATION.cff`.

## Licence

PlasmidPop is released under the [MIT License](LICENSE).

The bundled data is not code and comes with its own terms: the curated parts
from NCBI records, the fluorescent proteins from FPbase under CC BY-SA 4.0,
and the codon usage of the expression hosts from the Codon Usage Database.
See [DATA-LICENSES.md](DATA-LICENSES.md). Data this project may not
redistribute — a REBASE enzyme table, a ligase fidelity table — is not
bundled at all: the app reads a copy you bring yourself.
