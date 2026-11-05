// `npm run mutate:triage [-- <git ref>]`: what a finished mutation run leaves
// to read, from reports/mutation/mutation.json and the lines changed since a
// ref (default: the latest tag): the survivors and uncovered mutants per file,
// with the skipped suites (MUTATION_SKIP) that reach the file, and the
// timeouts, loops apart from the rest (item 50, "At 1.21: mutants that timed
// out"; #355). It runs at the end of `npm run mutate:changed`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import {
  MUTATION_SKIP,
  changedRanges,
  domTestsOf,
  matchGlobs,
  readSources,
  relatedTests,
  triageText,
} from './mutationTools.mjs';

const ref =
  process.argv[2] ??
  execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();
const ranges = changedRanges(
  execFileSync('git', ['diff', '-U0', '--no-renames', ref, 'HEAD', '--', 'src'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }),
);
const parsed = /** @type {unknown} */ (
  JSON.parse(readFileSync('reports/mutation/mutation.json', 'utf8'))
);
const report = /** @type {import('./mutationTools.mjs').MutationReport} */ (parsed);
const sources = readSources();
const dom = domTestsOf(sources);
// The skipped suites that import the file, or import a module that does
// (two imports away). Further out nearly every suite is reached through a
// barrel, which says nothing: the Sanger assembly oracle reaches `assemble.ts`
// through its harness and two more modules, so item 50 names it instead.
const skippedSuitesFor = (/** @type {string} */ file) =>
  matchGlobs(MUTATION_SKIP, relatedTests(sources, [file], { domTests: dom, maxDepth: 2 }));

process.stdout.write(
  `Lines changed since ${ref}.\n${triageText(report, ranges, skippedSuitesFor)}\n`,
);
