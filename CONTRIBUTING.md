# Contributing to PlasmidPop

Thanks for helping. Bug reports, feature ideas, test files that break a parser,
documentation fixes and pull requests are all welcome. Please follow the
[Code of Conduct](./CODE_OF_CONDUCT.md).

## Reporting a bug or asking for a feature

- Search the [issue tracker](https://github.com/BooneAndrewsLab/PlasmidPop/issues)
  first.
- For a bug, say what you did, what you expected, what happened, the version,
  and the browser. A small sequence file that reproduces it helps most; do not
  attach sequences you are not free to share.
- In the app, **Report this problem** prepares an email with the diagnostic
  details already filled in.
- Security problems: do not open an issue, see [SECURITY.md](./SECURITY.md).

## Before a large change

Open an issue first so we can agree on scope. [CLAUDE.md](./CLAUDE.md) holds the
architecture decisions and the domain rules that cause bugs (circular
wraparound, 0- versus 1-based coordinates, reverse-strand features, multi-segment
features, IUPAC codes). [docs/design/](./docs/design/README.md) records the
reasoning behind each piece of work; read the note for the area you touch.

PlasmidPop is a client-side static site. Changes that need a backend, an account,
or sending sequence data to a server are out of scope.

## Setting up

Node 22.22.2+ or 24.15.0+ (see `.nvmrc` and `engines` in `package.json`):

```sh
npm install
npm run dev
```

## Making a change

1. Branch from `main`, one branch per issue or piece of work.
2. Keep commits small and reviewable. Reference the issue (`Fixes #N`) in the
   commit that closes it.
3. Write tests with the change. A domain-model change ships with tests.
4. Keep the user guide in step: any change a user can notice updates the
   relevant page in `docs/guide/` in the same commit (and
   `docs/guide/14-shortcuts.md` if a key binding changes).
5. Run the full check, and make sure it passes:

   ```sh
   npm run check   # typecheck, lint, format check, tests with coverage
   ```

   Use `npm test` rather than a bare `npx vitest`: it pins the English locale
   the tests expect.

6. Open a pull request against `main` and fill in the template.

## Conventions

- TypeScript in strict mode, no `any`. Prefer discriminated unions.
- The sequence view and circular map are drawn on Canvas 2D, never DOM or SVG.
  Heavy computation runs in Web Workers so the main thread never blocks.
- File parsers and writers are our own; round-tripping must be preserved.
- Do not copy code from other editors without checking its licence. Bundle only
  data that may be redistributed (see [DATA-LICENSES.md](./DATA-LICENSES.md)).
- Formatting is Prettier (`npm run format`); lint is ESLint (`npm run lint`).

## Licence

By contributing you agree that your contribution is licensed under the
project's [MIT licence](./LICENSE).
