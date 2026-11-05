// `npm run mutate:recheck-timeouts [flags]`: finds the untested behaviour a
// mutation timeout hid (#356, item 50). Stryker counts a mutant whose tests
// run out of time as detected, but a mutant that only made the code slower (a
// cache, prefilter or fast path removed) leaves the answer alone. For each
// `Timeout` mutant in reports/mutation/mutation.json and stryker-incremental.json
// that is not a loop-counter flip, this applies the mutant to its file, runs
// the test files that covered it under a short limit, restores the file, and
// lists the mutants whose tests still pass.
//
// It edits real source files in place, one mutant at a time, and always puts
// them back (see scripts/timeoutRecheck.mjs): on an error, on Ctrl-C or kill,
// and after a kill -9 at the next start. It refuses to start when a file it
// would mutate has uncommitted changes. Run it on an idle machine, not beside
// an editor that saves the file or a test run.
//
// Flags:
//   --dry-run            print each mutant it would apply; touch nothing, run
//                        no tests.
//   --file <path>        only mutants in this file (or files whose path
//                        contains it); repeatable.
//   --limit <n>          run at most n mutants now (the rest wait for a later
//                        run with --resume).
//   --resume             skip the mutants the state file already has a result
//                        for (an interrupted run continues); without it a
//                        run starts a fresh state.
//   --timeout-seconds <n>   one limit per mutant. Default: the time of the
//                        unmutated tests (run once per file) times
//   --timeout-factor <n>    (default 4), at least
//   --min-seconds <n>       (default 20).
//   --report <file>      a Stryker report to read, newest first; repeatable.
//                        Default: mutation.json, then stryker-incremental.json.
//   --dir <folder>       state, journal and reports (default
//                        reports/mutation/timeout-recheck, git-ignored).
//   --cwd <folder>       the checkout (default: here).
//   --test-command <json array>
//                        run this command with the test files appended
//                        instead of Vitest (the unit tests use it).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { domTestsOf, readSources, relatedTests } from './mutationTools.mjs';
import { recheckTimeouts, vitestRunner, withoutSkipped } from './timeoutRecheck.mjs';

const args = process.argv.slice(2);
const flagSet = new Set(['--dry-run', '--resume', '--help']);
const valued = new Set([
  '--file',
  '--limit',
  '--timeout-seconds',
  '--timeout-factor',
  '--min-seconds',
  '--report',
  '--dir',
  '--cwd',
  '--test-command',
]);
/** @type {Map<string, string[]>} */
const values = new Map();
/** @type {Set<string>} */
const flags = new Set();
for (let i = 0; i < args.length; i++) {
  const arg = String(args[i]);
  if (flagSet.has(arg)) flags.add(arg);
  else if (valued.has(arg)) {
    const value = args[++i];
    if (value === undefined) fail(`${arg} needs a value`);
    values.set(arg, [...(values.get(arg) ?? []), String(value)]);
  } else fail(`unknown argument ${arg}`);
}

/** @param {string} message */
function fail(message) {
  process.stderr.write(`mutate-recheck-timeouts: ${message}\n`);
  process.exit(2);
}
/** @param {string} flag */
const one = (flag) => values.get(flag)?.[0];
/**
 * @param {string} flag
 * @returns {number | undefined}
 */
const num = (flag) => {
  const v = one(flag);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${flag} wants a positive number, got ${v}`);
  return n;
};

if (flags.has('--help')) {
  process.stdout.write(
    'usage: npm run mutate:recheck-timeouts -- [--dry-run] [--file f]... [--limit n] [--resume]\n' +
      '       [--timeout-seconds n | --timeout-factor n --min-seconds n] [--report f]... [--dir d]\n' +
      '(see the header of scripts/mutate-recheck-timeouts.mjs)\n',
  );
  process.exit(0);
}

const cwd = resolve(one('--cwd') ?? '.');
process.chdir(cwd);
const dir = resolve(cwd, one('--dir') ?? 'reports/mutation/timeout-recheck');
const reportPaths = values.get('--report') ?? [
  'reports/mutation/mutation.json',
  'reports/mutation/stryker-incremental.json',
];
const reports = reportPaths
  .filter((p) => existsSync(resolve(cwd, p)))
  .map((p) => {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(resolve(cwd, p), 'utf8')));
    return { name: p, report: /** @type {import('./timeoutRecheck.mjs').Report} */ (parsed) };
  });
if (reports.length === 0) fail(`none of ${reportPaths.join(', ')} exists`);

const commandText = one('--test-command');
const testCommand =
  commandText === undefined ? undefined : /** @type {string[]} */ (JSON.parse(commandText));

// For a mutant the report has no coverage for: the tests that can reach its
// file by imports, outside the suites a mutation run skips.
/** @type {Record<string, string> | undefined} */
let sources;
/** @type {ReadonlySet<string> | undefined} */
let dom;
const fallbackTests = withoutSkipped((/** @type {string} */ file) => {
  sources ??= readSources();
  dom ??= domTestsOf(sources);
  return relatedTests(sources, [file], { domTests: dom });
});

try {
  const timeoutSeconds = num('--timeout-seconds');
  const limit = num('--limit');
  const timeoutFactor = num('--timeout-factor');
  const minSeconds = num('--min-seconds');
  const { exitCode } = await recheckTimeouts({
    cwd,
    dir,
    reports,
    run: vitestRunner(cwd, testCommand),
    fallbackTests,
    dryRun: flags.has('--dry-run'),
    resume: flags.has('--resume'),
    ...(values.has('--file') ? { files: values.get('--file') ?? [] } : {}),
    ...(limit === undefined ? {} : { limit }),
    ...(timeoutSeconds === undefined ? {} : { fixedSeconds: timeoutSeconds }),
    ...(timeoutFactor === undefined ? {} : { timeoutFactor }),
    ...(minSeconds === undefined ? {} : { minSeconds }),
  });
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
