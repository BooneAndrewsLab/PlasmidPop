// `npm run mutate:changed [-- <git ref>] [flags] [stryker flags]`: the
// pre-release mutation pass (item 50), limited to what changed since a ref
// (default: the latest tag). Three things keep it short (#320, #355):
//
//   - Only the changed lines of the changed files of stryker.config.json's
//     `mutate` list are mutated (`--mutate src/a.ts:10-20,...`), so little is
//     instrumented; the incremental file still holds and reuses every other
//     verdict. The dry run, which is one process and the longest part, took
//     about 30 min with all 81 files instrumented and under 9 min with two.
//   - Only the test files that can reach those files, by their imports, run in
//     the dry run (PLASMIDPOP_MUTATION_TESTS, read by vite.config.ts). A leaf
//     module is reached by a handful of tests; a core one by most of them.
//   - The suites in `MUTATION_SKIP` (scripts/mutationTools.mjs) never run.
//
// Flags:
//   --whole-files       mutate the whole of each changed file, not just its
//                       changed lines (the survivor policy only triages the
//                       changed lines, so this is for a wider look).
//   --all-tests         run every test in the dry run, not only those that
//                       reach the changed files.
//   --incremental-from <file>
//                       copy this incremental report over the local one first
//                       (a run on another machine starts from the
//                       workstation's, not from a thin one).
//   --skip-loops        leave out UpdateOperator mutants (`i++` to `i--`). In
//                       the 1.19.0 run 150 of its 253 were timeouts (a loop
//                       that never ends) and only 2 survived, and each
//                       timeout costs its whole budget; the other 90 were
//                       killed by a test, so the pass loses that signal on
//                       loop counters.
//   --remeasure <file>  mutate the whole of this file and rerun every one of
//                       its mutants (`--force`), changed or not (repeatable).
//                       The incremental report keeps a survivor's verdict
//                       while its lines stand, so a test added since never
//                       gets to kill it; the stale-survivor warning names
//                       the files this is for.
//   --without <file>    leave this file out of the pass (repeatable). A file
//                       with no baseline here that changed is mutated whole and
//                       its instrumented suites can be very slow; one that did
//                       not change is reported as unmeasured and left out
//                       anyway. Mutate such a file on the machine that has its
//                       results and bring the report back with
//                       --incremental-from.
//   --unit-only         run the tests without the jsdom component tests
//                       (*.test.tsx) that the mutated files do not need; a
//                       mutant only a component test would kill then
//                       survives and is triaged.
//
// Every run keeps a copy of the incremental file taken before it (an
// interrupted Stryker writes its report only at the end) and its own log, and
// ends with `npm run mutate:triage`'s listing.
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { dirname } from 'node:path';

import {
  MUTATION_SKIP,
  busyWarning,
  changedRanges,
  domTestsOf,
  isTestFile,
  matchGlobs,
  mutatePatterns,
  splitUnbaselined,
  staleBaseWarning,
  staleSurvivors,
  readSources,
  relatedTests,
  workerCount,
} from './mutationTools.mjs';

const out = (/** @type {string} */ text) => process.stdout.write(`${text}\n`);

const args = process.argv.slice(2);
const take = (/** @type {string} */ flag) => {
  const at = args.indexOf(flag);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
};
const takeValue = (/** @type {string} */ flag) => {
  const at = args.indexOf(flag);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (value === undefined) throw new Error(`${flag} needs a value`);
  args.splice(at, 2);
  return value;
};
const skipLoops = take('--skip-loops');
const unitOnly = take('--unit-only');
const wholeFiles = take('--whole-files');
const allTests = take('--all-tests');
const incrementalFrom = takeValue('--incremental-from');
/** Files of the `mutate` list to leave out of this pass (repeatable). */
const without = /** @type {string[]} */ ([]);
for (let file = takeValue('--without'); file !== undefined; file = takeValue('--without')) {
  without.push(file);
}
const first = args[0];
const ref =
  first !== undefined && !first.startsWith('-')
    ? String(args.shift())
    : execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();

// The default base is the latest local tag; one never fetched makes it a release too old.
{
  try {
    const remote = execFileSync('git', ['ls-remote', '--tags', '--refs', 'origin'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    const names = remote.split('\n').map((l) => l.split('refs/tags/')[1] ?? '');
    const stale = staleBaseWarning(
      ref,
      names.filter((n) => n !== ''),
    );
    if (stale !== null) out(`WARNING: ${stale}`);
  } catch {
    // Offline, or no remote: the check is a courtesy.
  }
}

/** Files of the `mutate` list to mutate whole and rerun in full (repeatable). */
const remeasure = /** @type {string[]} */ ([]);
for (let file = takeValue('--remeasure'); file !== undefined; file = takeValue('--remeasure')) {
  remeasure.push(file);
}

const raw = /** @type {unknown} */ (JSON.parse(readFileSync('stryker.config.json', 'utf8')));
const config = /** @type {{ mutate: string[]; incrementalFile: string; concurrency?: number }} */ (
  raw
);
const { incrementalFile } = config;
const mutate = config.mutate.filter((f) => !without.includes(f));
if (without.length > 0) out(`Leaving out: ${without.join(', ')}`);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('reports/mutation/logs', { recursive: true });
if (existsSync(incrementalFile)) {
  copyFileSync(incrementalFile, `reports/mutation/logs/incremental-before-${stamp}.json`);
}
if (incrementalFrom !== undefined) {
  mkdirSync(dirname(incrementalFile), { recursive: true });
  copyFileSync(incrementalFrom, incrementalFile);
  out(`Starting from the incremental report ${incrementalFrom}.`);
}
// A file of the list that the incremental report has no mutant of has no
// baseline: mutating only its changed lines would leave the rest never
// tested, so it is mutated whole if it changed, and reported as an unmeasured
// gap if it did not (#400).
/** @type {Set<string>} */
let baseline = new Set();
if (existsSync(incrementalFile)) {
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(incrementalFile, 'utf8')));
  const report = /** @type {{ files?: Record<string, unknown> }} */ (parsed);
  baseline = new Set(Object.keys(report.files ?? {}));
}
/** @typedef {Parameters<typeof staleSurvivors>[0]} StaleReport */
const stale = (() => {
  if (!existsSync(incrementalFile)) return [];
  const sources = readSources();
  const dom = domTestsOf(sources);
  const skipped = (/** @type {string[]} */ list) => new Set(matchGlobs(MUTATION_SKIP, list));
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(incrementalFile, 'utf8')));
  const report = /** @type {StaleReport} */ (parsed);
  return staleSurvivors(report, sources, (file) => {
    // Two imports out: further, a test reaches the file through a hub that
    // most of the project shares, and every changed test would flag every file.
    // The timing tests assert nothing in a mutation run (`itTimed`).
    const related = relatedTests(sources, [file], { domTests: dom, maxDepth: 2 });
    const left = skipped(related);
    return related.filter((t) => !left.has(t) && !t.endsWith('.timing.test.ts'));
  }).filter((entry) => mutate.includes(entry.file));
})();
if (stale.length > 0) {
  const shown = stale.slice(0, 10);
  out(
    `${stale.length} file(s) of the list have survivors recorded before a test file near them (one ` +
      `or two imports away) was added or changed, so their verdicts may be out of date. Most open first:\n` +
      shown
        .map((e) => `  ${e.file}: ${e.open} open, ${e.changed.length} test file(s) differ`)
        .join('\n') +
      `${stale.length > shown.length ? `\n  ... and ${stale.length - shown.length} more` : ''}\n` +
      `  Rerun one with --remeasure <file>.`,
  );
}
for (const file of remeasure) {
  if (!mutate.includes(file)) throw new Error(`--remeasure ${file}: not in the mutate list`);
}
const ranges = changedRanges(
  execFileSync('git', ['diff', '-U0', '--no-renames', ref, 'HEAD', '--', 'src'], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }),
);
const { whole: unbaselined, unmeasured } = splitUnbaselined(
  mutate,
  baseline,
  new Set([...ranges.keys(), ...remeasure]),
);
const patterns = mutatePatterns(
  mutate,
  new Set([...ranges.keys(), ...remeasure]),
  wholeFiles ? null : ranges,
  new Set([...unbaselined, ...remeasure]),
);
const files = mutate.filter((f) => ranges.has(f) || unbaselined.has(f) || remeasure.includes(f));

if (unmeasured.length > 0) {
  out(
    `${unmeasured.length} file(s) of the list have no result in ${incrementalFile} and no diff since ${ref}: ` +
      `an unmeasured gap, not mutated (their whole-file dry run can pass the ceiling; triage their old ` +
      `survivors by hand, see design note 50):\n  ${unmeasured.join('\n  ')}`,
  );
}
if (patterns.length === 0) {
  out(`No file in the mutate list changed since ${ref}; nothing to run.`);
  process.exit(0);
}
if (unbaselined.size > 0) {
  out(
    `${unbaselined.size} file(s) of the list have no result in ${incrementalFile}, changed since ${ref}, and are mutated whole` +
      `${unbaselined.size === mutate.length ? ' (no baseline: this is a full run, and a long one)' : ''}:` +
      `\n  ${[...unbaselined].join('\n  ')}`,
  );
}
out(
  `Mutating ${files.length} file(s) changed since ${ref}` +
    `${wholeFiles ? ' (whole files)' : ` (${patterns.length} line range(s))`}:\n  ${files.join('\n  ')}`,
);

const warning = busyWarning(loadavg()[0] ?? 0, cpus().length);
if (warning !== undefined) out(`\nWARNING: ${warning}\n`);

/** @type {Record<string, string>} */
const testEnv = {};
if (!allTests) {
  const sources = readSources();
  const related = relatedTests(sources, files, { domTests: domTestsOf(sources) });
  const skipped = new Set(matchGlobs(MUTATION_SKIP, related));
  const running = related.filter((f) => !skipped.has(f));
  if (running.length === 0) {
    out('No test file reaches these files (outside the skipped suites); nothing to run.');
    process.exit(0);
  }
  const total = Object.keys(sources).filter(isTestFile).length;
  out(
    `Dry run: ${running.length} of ${total} test files reach them` +
      (skipped.size > 0 ? ` (${skipped.size} more are in the skipped suites)` : '') +
      '.',
  );
  testEnv['PLASMIDPOP_MUTATION_TESTS'] = running.join('\n');
}

const startedAt = Date.now();
const log = createWriteStream(`reports/mutation/logs/mutate-${stamp}.log`);

const flags = ['--mutate', patterns.join(',')];
// Workers beyond the cores the machine can spare only add contention, and
// contention is what turns slow mutants into timeouts: never more than the
// cores minus two, and not more than the config asks for.
if (!args.includes('--concurrency')) {
  flags.push('--concurrency', String(workerCount(config.concurrency, cpus().length)));
}
// The dry run is one process; config's 20 minutes is for a run of a few
// files, and a ceiling costs nothing when it is not reached.
if (!args.includes('--dryRunTimeoutMinutes')) flags.push('--dryRunTimeoutMinutes', '45');
if (remeasure.length > 0) flags.push('--force');
if (skipLoops) flags.push('--mutator.excludedMutations', 'UpdateOperator');

execFileSync('node', ['scripts/patch-stryker-vitest.mjs'], { stdio: 'inherit' });
const run = spawn('npx', ['stryker', 'run', ...flags, ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PLASMIDPOP_MUTATION: '1',
    ...(unitOnly ? { PLASMIDPOP_MUTATION_UNIT: '1' } : {}),
    ...testEnv,
  },
});
for (const stream of [run.stdout, run.stderr]) {
  stream.on('data', (/** @type {Buffer} */ chunk) => {
    process.stdout.write(chunk);
    log.write(chunk);
  });
}

run.on('close', (code) => {
  // After an interrupt, the test-runner children of a mutant that loops
  // forever can outlive Stryker, orphaned (parent pid 1), and keep a core
  // busy; kill those that belong to this checkout.
  const orphans = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' })
    .split('\n')
    .filter((l) => l.includes(process.cwd()))
    .map((l) => /^(\d+)\s+1\s+.*child-proxy-process-proxy-worker/.exec(l.trim()))
    .filter((m) => m !== null);
  for (const m of orphans) {
    out(`Killing orphaned Stryker worker ${m[1]}`);
    process.kill(Number(m[1]), 'SIGKILL');
  }
  log.end();
  // The listing of what the run leaves to read (survivors, timeouts), unless
  // this run wrote no report.
  const report = 'reports/mutation/mutation.json';
  if (existsSync(report) && statSync(report).mtimeMs >= startedAt) {
    try {
      const listing = execFileSync('node', ['scripts/mutate-triage.mjs', ref], {
        encoding: 'utf8',
      });
      out(`\n${listing}`);
      writeFileSync(`reports/mutation/logs/triage-${stamp}.txt`, listing);
    } catch (error) {
      out(`The triage listing failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  process.exit(code ?? 1);
});
