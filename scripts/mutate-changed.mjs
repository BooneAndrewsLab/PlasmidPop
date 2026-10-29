// `npm run mutate:changed [-- <git ref>] [--skip-loops] [--unit-only] [stryker flags]`:
// the pre-release mutation pass limited to the files in stryker.config.json's
// `mutate` list that changed since a ref (default: the latest tag). Only those
// files are instrumented, which is what keeps the dry run short (item 50,
// #320); the incremental file still reuses results for unchanged mutants.
//
//   --skip-loops  leave out UpdateOperator mutants (`i++` to `i--`). In the
//                 1.19.0 run 150 of its 253 were timeouts (a loop that never
//                 ends) and only 2 survived, and each timeout costs its whole
//                 budget; the other 90 were killed by a test, so the pass
//                 loses that signal on loop counters.
//   --unit-only   run the tests without the jsdom component tests (*.test.tsx)
//                 that the mutated files do not need; a mutant only a
//                 component test would kill then survives and is triaged.
//
// Every run keeps a copy of the incremental file taken before it (an
// interrupted Stryker writes its report only at the end) and its own log.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { cpus } from 'node:os';

const out = (/** @type {string} */ text) => process.stdout.write(`${text}\n`);

const args = process.argv.slice(2);
const take = (/** @type {string} */ flag) => {
  const at = args.indexOf(flag);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
};
const skipLoops = take('--skip-loops');
const unitOnly = take('--unit-only');
const first = args[0];
const ref =
  first !== undefined && !first.startsWith('-')
    ? String(args.shift())
    : execFileSync('git', ['describe', '--tags', '--abbrev=0'], { encoding: 'utf8' }).trim();

const raw = /** @type {unknown} */ (JSON.parse(readFileSync('stryker.config.json', 'utf8')));
const config = /** @type {{ mutate: string[]; incrementalFile: string }} */ (raw);
const { mutate, incrementalFile } = config;
const changed = new Set(
  execFileSync('git', ['diff', '--name-only', ref, 'HEAD', '--', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean),
);
const files = mutate.filter((f) => changed.has(f));

if (files.length === 0) {
  out(`No file in the mutate list changed since ${ref}; nothing to run.`);
  process.exit(0);
}
out(`Mutating ${files.length} file(s) changed since ${ref}:\n  ${files.join('\n  ')}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
mkdirSync('reports/mutation/logs', { recursive: true });
if (existsSync(incrementalFile)) {
  copyFileSync(incrementalFile, `reports/mutation/logs/incremental-before-${stamp}.json`);
}
const log = createWriteStream(`reports/mutation/logs/mutate-${stamp}.log`);

const flags = ['--mutate', files.join(',')];
// Workers beyond the cores the machine can spare only add contention, and
// contention is what turns slow mutants into timeouts.
if (!args.includes('--concurrency')) {
  flags.push('--concurrency', String(Math.max(1, cpus().length - 2)));
}
if (skipLoops) flags.push('--mutator.excludedMutations', 'UpdateOperator');

execFileSync('node', ['scripts/patch-stryker-vitest.mjs'], { stdio: 'inherit' });
const run = spawn('npx', ['stryker', 'run', ...flags, ...args], {
  stdio: ['inherit', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PLASMIDPOP_MUTATION: '1',
    ...(unitOnly ? { PLASMIDPOP_MUTATION_UNIT: '1' } : {}),
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
  process.exit(code ?? 1);
});
