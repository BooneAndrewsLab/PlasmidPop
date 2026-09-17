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
  app/        React shell (components, routing)
  test/       Vitest setup
  main.tsx    Entry point
```

Domain code (document model, parsers, analysis) will live in dedicated
`src/` subpackages as it lands; see the build order in CLAUDE.md.
