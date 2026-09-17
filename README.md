# PlasmidPop

Browser-based DNA sequence editor and plasmid viewer. Everything runs
client-side: open a GenBank file and start working with no account and no
server round-trip.

See [CLAUDE.md](./CLAUDE.md) for the architecture handoff and build order.

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
  view/         Canvas rendering (pure; no React)
    linear/     Row layout, feature lane assignment, linear view renderer
    circular/   Plasmid map geometry, label placement, map renderer
  workers/      Analysis Web Worker + client (inline fallback where Workers are missing)
  io/           File formats behind one interface (parseSequenceFile)
    genbank/    GenBank flat-file parser + writer, location grammar
    fasta/      FASTA parser + writer
    fixtures/   Public NCBI records used by round-trip tests
  test/         Vitest setup and shared test helpers
fixtures/local/ Private test files (gitignored); tests use them when present
  main.tsx      Entry point
```

Coordinates: positions are 0-based; ranges are half-open `[start, end)`.
On circular sequences `end` may exceed the length to express a range that
wraps past the origin (`end - start` is always the base count). GenBank's
1-based inclusive coordinates are converted only at the parser/writer
boundary.
