// The logic behind `npm run mutate:recheck-timeouts` (#356, item 50): apply
// each non-loop `Timeout` mutant of a Stryker report to its file, run the tests
// that cover it under a short limit, restore the file, and list the mutants the
// tests still pass. A timeout counts as detected, so it can hide a missing
// assertion; a mutant whose covering tests pass when given the time was only
// slower, and is either equivalent (a cache, prefilter, fast path, guard) or a
// gap in the tests.
//
// This applies mutants to real source files, so the rule that matters is that
// it never leaves one behind: the original text is held in memory and written
// back in `finally`, on SIGINT, SIGTERM and SIGHUP, on an uncaught error and at
// exit; a journal and a copy of the original on disk let the next start restore
// a file after a kill -9; the run refuses to start if a target file has
// uncommitted changes, and checks `git diff --stat` after every mutant.
//
// The unit tests are in src/test/scripts/timeoutRecheck.test.ts; they run it
// against a tiny project in a temporary directory.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { MUTATION_SKIP, isLoopTimeout, matchGlobs } from './mutationTools.mjs';

/**
 * @typedef {{ line: number; column: number }} Position
 * @typedef {{ id: string; mutatorName: string; replacement?: string; status: string;
 *   coveredBy?: string[]; location: { start: Position; end: Position } }} Mutant
 * @typedef {{ source: string; mutants: Mutant[] }} ReportFile
 * @typedef {{ files: Record<string, ReportFile>;
 *   testFiles?: Record<string, { tests: { id: string }[] }> }} Report
 *
 * @typedef {{ key: string; file: string; report: string; source: string; mutant: Mutant;
 *   text: string; loop: boolean; testFiles: string[] | undefined }} Timeout
 *   A `Timeout` mutant of a report, with the test files that covered it there
 *   (undefined when the report names none).
 *
 * @typedef {'survived' | 'killed' | 'timeout' | 'error' | 'stale' | 'no-tests' |
 *   'baseline-red'} Verdict
 * @typedef {{ key: string; file: string; line: number; column: number; mutator: string;
 *   original: string; replacement: string; verdict: Verdict; ms: number;
 *   tests: string[]; note?: string }} Result
 * @typedef {{ code: number | null; signal: string | null; timedOut: boolean;
 *   output: string; ms: number }} RunResult
 */

// ---------------------------------------------------------------------------
// Reading the reports

/**
 * Which mutant a report's entry is, across reports: the file, the span and the
 * replacement (the ids differ from one report to the next).
 * @param {string} file
 * @param {Mutant} mutant
 */
export function mutantKey(file, mutant) {
  const { start, end } = mutant.location;
  return `${file}:${start.line}:${start.column}-${end.line}:${end.column}:${mutant.replacement ?? ''}`;
}

/**
 * The test file of each test id of a report.
 * @param {Report} report
 * @returns {Map<string, string>}
 */
function testFileById(report) {
  /** @type {Map<string, string>} */
  const byId = new Map();
  for (const [file, data] of Object.entries(report.testFiles ?? {})) {
    for (const test of data.tests) byId.set(test.id, file);
  }
  return byId;
}

/**
 * The `Timeout` mutants of the reports, loops included (flagged). A mutant
 * that two reports both hold is read from the first: put the newest first, so
 * that a mutant a later run killed is not a timeout here.
 * @param {{ name: string; report: Report }[]} reports
 * @returns {Timeout[]}
 */
export function collectTimeouts(reports) {
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Timeout[]} */
  const out = [];
  for (const { name, report } of reports) {
    const byId = testFileById(report);
    for (const [file, data] of Object.entries(report.files)) {
      const lines = data.source.split('\n');
      for (const mutant of data.mutants) {
        const key = mutantKey(file, mutant);
        if (seen.has(key)) continue;
        seen.add(key);
        if (mutant.status !== 'Timeout') continue;
        const text = (lines[mutant.location.start.line - 1] ?? '').trim();
        const covered = mutant.coveredBy ?? [];
        const files = new Set(covered.flatMap((id) => byId.get(id) ?? []));
        out.push({
          key,
          file,
          report: name,
          source: data.source,
          mutant,
          text,
          loop: isLoopTimeout({ mutant, text }),
          testFiles: files.size === 0 ? undefined : [...files].sort(),
        });
      }
    }
  }
  return out.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.mutant.location.start.line - b.mutant.location.start.line ||
      a.mutant.location.start.column - b.mutant.location.start.column,
  );
}

// ---------------------------------------------------------------------------
// Applying a mutant

/**
 * The index in `text` of a report position (1-based line and column).
 * @param {string} text
 * @param {Position} position
 * @returns {number | undefined} undefined when the line does not exist
 */
export function offsetOf(text, position) {
  let offset = 0;
  for (let line = 1; line < position.line; line++) {
    const next = text.indexOf('\n', offset);
    if (next < 0) return undefined;
    offset = next + 1;
  }
  return offset + position.column - 1;
}

/**
 * The text of `source` that a span covers.
 * @param {string} source
 * @param {Mutant['location']} location
 */
export function spanText(source, location) {
  const from = offsetOf(source, location.start);
  const to = offsetOf(source, location.end);
  if (from === undefined || to === undefined || to < from) return undefined;
  return source.slice(from, to);
}

/**
 * The file with the mutant applied, or why it cannot be: the report's
 * source is the file as the run saw it, so the mutant is applied only where
 * the file still has the same text on the mutant's lines, at the span and
 * around it.
 * @param {string} current the file now
 * @param {string} source the file as the report saw it
 * @param {Mutant} mutant
 * @returns {{ mutated: string; original: string } | { stale: string }}
 */
export function applyMutant(current, source, mutant) {
  if (mutant.replacement === undefined) return { stale: 'the report has no replacement' };
  const original = spanText(source, mutant.location);
  if (original === undefined) return { stale: 'the location is outside the report source' };
  const from = offsetOf(current, mutant.location.start);
  const to = offsetOf(current, mutant.location.end);
  if (from === undefined || to === undefined) return { stale: 'the location is past the file' };
  if (current.slice(from, to) !== original) {
    return { stale: 'the file has changed since the report: the span reads differently' };
  }
  const lines = (/** @type {string} */ t) => t.split('\n');
  const { start, end } = mutant.location;
  const reportLines = lines(source).slice(start.line - 1, end.line);
  const fileLines = lines(current).slice(start.line - 1, end.line);
  if (reportLines.join('\n') !== fileLines.join('\n')) {
    return { stale: 'the file has changed since the report: the lines read differently' };
  }
  const mutated = current.slice(0, from) + mutant.replacement + current.slice(to);
  if (mutated === current) return { stale: 'the replacement equals the original' };
  return { mutated, original };
}

// ---------------------------------------------------------------------------
// Running a command that may never end

/** @type {Set<number>} */
const liveGroups = new Set();

/**
 * Kills a whole process group (the runner and the workers it started).
 * @param {number} pid
 * @param {NodeJS.Signals} [signal]
 */
export function killGroup(pid, signal = 'SIGKILL') {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group has no members left.
  }
}

/** Kills the groups of every command still running. */
export function killLiveGroups() {
  for (const pid of liveGroups) killGroup(pid);
  liveGroups.clear();
}

/**
 * Runs a command in its own process group and kills the group when it has run
 * for `timeoutMs`, so that a loop that never ends (a mutant) and the workers it
 * runs in are gone when this returns.
 * @param {string} command
 * @param {readonly string[]} args
 * @param {{ cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<RunResult>}
 */
export function runCommand(command, args, { cwd, timeoutMs, env }) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(command, [...args], {
      cwd,
      env: env ?? process.env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const pid = child.pid;
    if (pid !== undefined) liveGroups.add(pid);
    let output = '';
    const keep = (/** @type {Buffer} */ chunk) => {
      output = (output + chunk.toString('utf8')).slice(-200_000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    let finished = false;
    /** @type {NodeJS.Timeout | undefined} */
    let giveUp;
    const finish = (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(giveUp);
      if (pid !== undefined) {
        killGroup(pid);
        liveGroups.delete(pid);
      }
      done({ code, signal, timedOut, output, ms: Date.now() - started });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      if (pid !== undefined) killGroup(pid);
      // Pipes held open by a straggler would keep 'close' from coming.
      giveUp = setTimeout(() => {
        finish(null, 'SIGKILL');
      }, 5_000);
    }, timeoutMs);
    child.on('error', (error) => {
      output += `\n${error.message}`;
      finish(127, null);
    });
    child.on('close', finish);
  });
}

/**
 * What a run of the covering tests says about the mutant.
 *  - survived: the tests pass; the answer did not change.
 *  - timeout: they ran out of time again (the process limit or a test limit).
 *  - error: the mutated file did not compile or load; read it by hand.
 *  - killed: a test failed.
 * @param {RunResult} run
 * @returns {'survived' | 'killed' | 'timeout' | 'error'}
 */
export function verdictOf(run) {
  if (run.timedOut || /(?:Test|Hook) timed out in \d+ms/.test(run.output)) return 'timeout';
  if (run.code === 0) return 'survived';
  if (
    /Transform failed|Pre-transform error|Failed to parse source|SyntaxError:/.test(run.output) &&
    !run.output.includes('AssertionError')
  ) {
    return 'error';
  }
  return 'killed';
}

// ---------------------------------------------------------------------------
// git

/**
 * @param {string} cwd
 * @param {string[]} args
 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/**
 * The uncommitted changes in `files` (relative to `cwd`), as `git status
 * --porcelain` lines: empty for a clean tree. Throws outside a git checkout.
 * @param {string} cwd
 * @param {readonly string[]} files
 */
export function dirtyFiles(cwd, files) {
  git(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (files.length === 0) return [];
  return git(cwd, ['status', '--porcelain', '--', ...files])
    .split('\n')
    .filter((l) => l !== '');
}

/**
 * `git diff --stat` of the files against HEAD (staged or not): empty when
 * none of them differs.
 * @param {string} cwd
 * @param {readonly string[]} files
 */
export function diffStat(cwd, files) {
  if (files.length === 0) return '';
  return git(cwd, ['diff', '--stat', 'HEAD', '--', ...files]).trim();
}

// ---------------------------------------------------------------------------
// The run

/**
 * @typedef {object} RecheckOptions
 * @property {string} cwd the checkout; every file name is relative to it
 * @property {{ name: string; report: Report }[]} reports newest first
 * @property {string} dir where the state, journal, backup and reports live
 * @property {readonly string[]} [files] only mutants in files whose name equals
 *   or contains one of these
 * @property {number} [limit] at most this many mutants are run now
 * @property {boolean} [resume] skip the mutants the state file already has
 * @property {boolean} [dryRun] print what would be applied; touch nothing
 * @property {number} [minSeconds] the least time a mutant's tests are given
 * @property {number} [timeoutFactor] times the time of the unmutated tests
 * @property {number} [fixedSeconds] one limit for every mutant, no baseline
 * @property {(files: string[], limitMs: number) => Promise<RunResult>} run
 *   runs the given test files with a limit; the baseline and every mutant
 * @property {(file: string) => string[]} [fallbackTests] test files for a
 *   mutant the report has no coverage for
 * @property {(line: string) => void} [log]
 */

/** @param {number} n */
const secs = (n) => `${(n / 1000).toFixed(1)}s`;

/**
 * @param {string} path
 * @param {string} text
 */
function writeAtomic(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Puts back the file a killed run left mutated, from the journal and the copy
 * of the original it made before writing the mutant.
 * @param {string} cwd
 * @param {string} dir
 * @param {(line: string) => void} log
 * @returns {boolean} whether a file was restored
 */
export function recoverJournal(cwd, dir, log) {
  const journal = join(dir, 'applied.json');
  if (!existsSync(journal)) return false;
  const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(journal, 'utf8')));
  const { file } = /** @type {{ file: string }} */ (parsed);
  const backup = join(dir, 'applied.orig');
  if (!existsSync(backup)) {
    throw new Error(`${journal} names ${file} but ${backup} is missing: run git diff on it`);
  }
  writeFileSync(resolve(cwd, file), readFileSync(backup));
  rmSync(journal);
  rmSync(backup);
  log(`A previous run was killed with ${file} mutated; restored it from ${backup}.`);
  return true;
}

/**
 * @param {RecheckOptions} options
 * @returns {Promise<{ results: Result[]; exitCode: number }>}
 */
export async function recheckTimeouts(options) {
  if (options.dryRun) return recheckInner(options);
  const { cwd, dir } = options;
  const log = options.log ?? ((/** @type {string} */ line) => process.stdout.write(`${line}\n`));
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, 'lock');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive;
    try {
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`another recheck (pid ${pid}) is running; ${lock} names it`);
  }
  writeFileSync(lock, String(process.pid));
  try {
    // Before anything reads a file: a run killed outright may have left one
    // mutated.
    recoverJournal(cwd, dir, log);
    return await recheckInner(options);
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * @param {RecheckOptions} options
 * @returns {Promise<{ results: Result[]; exitCode: number }>}
 */
async function recheckInner(options) {
  const { cwd, dir, run, dryRun = false } = options;
  const log = options.log ?? ((/** @type {string} */ line) => process.stdout.write(`${line}\n`));
  const stateFile = join(dir, 'state.json');
  const timeouts = collectTimeouts(options.reports);
  const nonLoops = timeouts.filter((t) => !t.loop);
  const wanted = options.files ?? [];
  const inScope = nonLoops.filter(
    (t) => wanted.length === 0 || wanted.some((w) => t.file === w || t.file.includes(w)),
  );
  log(
    `Timeouts in the reports: ${timeouts.length} (${timeouts.length - nonLoops.length} loops, skipped); ` +
      `${nonLoops.length} to re-check${inScope.length < nonLoops.length ? `, ${inScope.length} in the files asked for` : ''}.`,
  );

  /** @type {Record<string, Result>} */
  let done = {};
  if (options.resume && existsSync(stateFile)) {
    const parsed = /** @type {unknown} */ (JSON.parse(readFileSync(stateFile, 'utf8')));
    const saved = /** @type {{ results: Record<string, Result> }} */ (parsed);
    done = saved.results;
    log(`Resuming: ${Object.keys(done).length} mutant(s) already have a result in ${stateFile}.`);
  }

  // Which mutants apply, to which file text, and with which tests.
  /** @type {Map<string, string>} */
  const texts = new Map();
  const currentText = (/** @type {string} */ file) => {
    let text = texts.get(file);
    if (text === undefined) {
      const path = resolve(cwd, file);
      text = existsSync(path) ? readFileSync(path, 'utf8') : '';
      texts.set(file, text);
    }
    return text;
  };
  /** @type {{ t: Timeout; mutated: string; original: string; tests: string[]; note?: string }[]} */
  const todo = [];
  /** @type {Result[]} */
  const fixed = [];
  for (const t of inScope) {
    if (done[t.key] !== undefined) continue;
    const { start } = t.mutant.location;
    const base = {
      key: t.key,
      file: t.file,
      line: start.line,
      column: start.column,
      mutator: t.mutant.mutatorName,
      replacement: t.mutant.replacement ?? '',
      ms: 0,
    };
    const applied = applyMutant(currentText(t.file), t.source, t.mutant);
    if ('stale' in applied) {
      fixed.push({
        ...base,
        original: spanText(t.source, t.mutant.location) ?? '',
        verdict: 'stale',
        tests: [],
        note: applied.stale,
      });
      continue;
    }
    const fromReport = t.testFiles;
    const wantedTests = fromReport ?? options.fallbackTests?.(t.file) ?? [];
    const tests = wantedTests.filter((f) => existsSync(resolve(cwd, f)));
    if (tests.length === 0) {
      fixed.push({
        ...base,
        original: applied.original,
        verdict: 'no-tests',
        tests: [],
        note: 'no test file covers it',
      });
      continue;
    }
    todo.push({
      t,
      mutated: applied.mutated,
      original: applied.original,
      tests,
      ...(fromReport === undefined ? { note: 'tests by imports (the report names none)' } : {}),
    });
  }
  const limited = options.limit === undefined ? todo : todo.slice(0, options.limit);

  if (dryRun) {
    log(`Dry run: nothing is written or run. ${limited.length} mutant(s) would be applied:`);
    for (const { t, original, tests, note } of limited) {
      const { start } = t.mutant.location;
      log(
        `  ${t.file}:${start.line}:${start.column} ${t.mutant.mutatorName}: ` +
          `${show(original)} -> ${show(t.mutant.replacement ?? '')}  [${tests.length} test file(s)${note === undefined ? '' : `; ${note}`}]`,
      );
    }
    for (const r of fixed) {
      log(`  ${r.file}:${r.line}:${r.column} ${r.mutator}: ${r.verdict} (${r.note ?? ''})`);
    }
    if (todo.length > limited.length) log(`  ... and ${todo.length - limited.length} more.`);
    return { results: fixed, exitCode: 0 };
  }

  mkdirSync(dir, { recursive: true });
  // A fresh run starts a fresh state; `--resume` keeps the old one.
  /** @type {Record<string, Result>} */
  const results = { ...done };
  for (const r of fixed) results[r.key] = r;

  const targets = [...new Set(limited.map(({ t }) => t.file))].sort();
  const dirty = dirtyFiles(cwd, targets);
  if (dirty.length > 0) {
    throw new Error(
      `refusing to start: the files it would mutate have uncommitted changes:\n  ${dirty.join('\n  ')}\n` +
        'Commit or stash them first (a mutant is applied and reverted in place).',
    );
  }
  log(
    `${limited.length} mutant(s) to run in ${targets.length} file(s)` +
      `${todo.length > limited.length ? ` (${todo.length - limited.length} more waiting: --limit)` : ''}.`,
  );

  /** The file mutated now: its path and original text. */
  /** @type {Map<string, string>} */
  const active = new Map();
  const journal = join(dir, 'applied.json');
  const backup = join(dir, 'applied.orig');
  const restoreSync = () => {
    for (const [path, text] of active) writeFileSync(path, text);
    active.clear();
    rmSync(journal, { force: true });
    rmSync(backup, { force: true });
  };
  const saveState = () => {
    writeAtomic(stateFile, `${JSON.stringify({ version: 1, results }, null, 2)}\n`);
  };
  /** @param {NodeJS.Signals} signal */
  const onSignal = (signal) => {
    killLiveGroups();
    restoreSync();
    saveState();
    process.stderr.write(`${signal}: file restored, state saved. Continue with --resume.\n`);
    rmSync(join(dir, 'lock'), { force: true });
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  /** @param {unknown} error */
  const onCrash = (error) => {
    killLiveGroups();
    restoreSync();
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    rmSync(join(dir, 'lock'), { force: true });
    process.exit(1);
  };
  const onExit = () => {
    restoreSync();
  };
  const signals = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);
  for (const s of signals) process.on(s, onSignal);
  process.on('uncaughtException', onCrash);
  process.on('unhandledRejection', onCrash);
  process.on('exit', onExit);

  try {
    /** @type {Map<string, number>} */
    const limits = new Map();
    /** @type {Set<string>} */
    const red = new Set();
    let n = 0;
    for (const item of limited) {
      n++;
      const { t, mutated, original, tests } = item;
      const { start } = t.mutant.location;
      const where = `${t.file}:${start.line}:${start.column}`;
      const base = {
        key: t.key,
        file: t.file,
        line: start.line,
        column: start.column,
        mutator: t.mutant.mutatorName,
        original,
        replacement: t.mutant.replacement ?? '',
        tests,
        ...(item.note === undefined ? {} : { note: item.note }),
      };
      if (red.has(t.file)) {
        results[t.key] = { ...base, verdict: 'baseline-red', ms: 0 };
        continue;
      }
      const baselineKey = `${t.file}\n${tests.join('\n')}`;
      let limitMs = limits.get(baselineKey);
      if (limitMs === undefined) {
        if (options.fixedSeconds !== undefined) {
          limitMs = options.fixedSeconds * 1000;
        } else {
          const floor = (options.minSeconds ?? 20) * 1000;
          // The unmutated tests, to time them and to know they pass at all.
          const plain = await run(tests, Math.max(floor * 6, 600_000));
          if (plain.code !== 0) {
            log(`[${n}/${limited.length}] ${t.file}: its tests fail unmutated; skipping the file.`);
            red.add(t.file);
            results[t.key] = { ...base, verdict: 'baseline-red', ms: plain.ms };
            saveState();
            continue;
          }
          limitMs = Math.max(floor, plain.ms * (options.timeoutFactor ?? 4));
          log(`  ${t.file}: tests take ${secs(plain.ms)}; limit per mutant ${secs(limitMs)}.`);
        }
        limits.set(baselineKey, limitMs);
      }

      const path = resolve(cwd, t.file);
      // The copy and the journal first, then the mutant: a run killed in
      // between leaves nothing mutated, and one killed after leaves what
      // the next start restores.
      writeFileSync(backup, readFileSync(path));
      writeAtomic(journal, `${JSON.stringify({ file: t.file })}\n`);
      /** @type {RunResult} */
      let outcome;
      const text = currentText(t.file);
      active.set(path, text);
      try {
        writeFileSync(path, mutated);
        outcome = await run(tests, limitMs);
      } finally {
        writeFileSync(path, text);
        active.delete(path);
        rmSync(journal, { force: true });
        rmSync(backup, { force: true });
      }
      const back = readFileSync(path, 'utf8');
      const stat = diffStat(cwd, targets);
      if (back !== text || stat !== '') {
        throw new Error(
          `${t.file} is not as it was after mutant ${where}; stopping.\n${stat}\n` +
            'Run `git diff` and `git checkout -- <file>`.',
        );
      }
      const verdict = verdictOf(outcome);
      results[t.key] = { ...base, verdict, ms: outcome.ms };
      saveState();
      log(
        `[${n}/${limited.length}] ${where} ${t.mutant.mutatorName} ${show(original)} -> ${show(base.replacement)}: ${verdict} (${secs(outcome.ms)})`,
      );
    }
    saveState();
  } finally {
    restoreSync();
    for (const s of signals) process.off(s, onSignal);
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
    process.off('exit', onExit);
  }
  const all = Object.values(results);
  writeAtomic(join(dir, 'report.json'), `${JSON.stringify(reportJson(all), null, 2)}\n`);
  writeAtomic(join(dir, 'report.md'), reportMarkdown(all));
  log(summaryText(all));
  log(`Wrote ${join(dir, 'report.md')} and report.json.`);
  return { results: all, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Reports

/** @param {string} text */
function show(text) {
  const flat = text.replaceAll('\n', ' ');
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

/** @param {readonly Result[]} results */
export function summaryText(results) {
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const r of results) count.set(r.verdict, (count.get(r.verdict) ?? 0) + 1);
  const parts = [...count].sort().map(([v, n]) => `${n} ${v}`);
  const survivors = results.filter((r) => r.verdict === 'survived');
  return (
    `Re-checked ${results.length}: ${parts.join(', ')}.\n` +
    `Survivors of a timeout (the covering tests pass; equivalent, or a missing test): ${survivors.length}`
  );
}

/** @param {readonly Result[]} results */
export function reportJson(results) {
  return {
    generated: new Date().toISOString(),
    counts: Object.fromEntries(
      [...new Set(results.map((r) => r.verdict))]
        .sort()
        .map((v) => [v, results.filter((r) => r.verdict === v).length]),
    ),
    survivors: results.filter((r) => r.verdict === 'survived'),
    errors: results.filter((r) => r.verdict === 'error'),
    results,
  };
}

/** @param {readonly Result[]} results */
export function reportMarkdown(results) {
  const out = ['# Timeouts re-checked (#356)', '', summaryText(results), ''];
  /** @type {[string, string, Verdict[]][]} */
  const sections = [
    [
      'Survivors',
      'The covering tests passed with the mutant applied: the timeout only slowed the code. Equivalent (cache, prefilter, fast path, guard) or a missing test.',
      ['survived'],
    ],
    ['Compile or load errors', 'Read these by hand.', ['error']],
    ['Stale, no tests or red baseline', 'Not run.', ['stale', 'no-tests', 'baseline-red']],
  ];
  for (const [title, note, verdicts] of sections) {
    const rows = results.filter((r) => verdicts.includes(r.verdict));
    if (rows.length === 0) continue;
    out.push(`## ${title} (${rows.length})`, '', note, '');
    /** @type {Map<string, Result[]>} */
    const byFile = new Map();
    for (const r of rows) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r]);
    for (const [file, group] of [...byFile].sort((a, b) => a[0].localeCompare(b[0]))) {
      out.push(`### ${file}`, '');
      for (const r of group.sort((a, b) => a.line - b.line || a.column - b.column)) {
        const why =
          r.verdict === 'survived' || r.verdict === 'error'
            ? ''
            : ` [${r.verdict}: ${r.note ?? ''}]`;
        out.push(
          `- ${r.line}:${r.column} ${r.mutator}: \`${show(r.original)}\` -> \`${show(r.replacement)}\`${why}` +
            (r.tests.length > 0 ? ` (${r.tests.length} test file(s))` : ''),
        );
      }
      out.push('');
    }
  }
  return `${out.join('\n')}\n`;
}

// ---------------------------------------------------------------------------
// Test runner

/**
 * The command that runs test files with Vitest, as `recheckTimeouts` wants
 * it: a limit on the whole run, and a test limit well inside it, so that a
 * test that waits (rather than loops) fails as a timeout.
 * @param {string} cwd
 * @param {readonly string[] | undefined} testCommand a replacement for
 *   Vitest, for the unit tests; the test files are appended
 * @returns {(files: string[], limitMs: number) => Promise<RunResult>}
 */
export function vitestRunner(cwd, testCommand) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  // A plain run: the mutation-mode limits and project split are not wanted.
  for (const name of Object.keys(env)) {
    if (name.startsWith('PLASMIDPOP_MUTATION')) env[name] = undefined;
  }
  return (files, limitMs) => {
    if (testCommand !== undefined) {
      const [command, ...rest] = testCommand;
      if (command === undefined) throw new Error('empty --test-command');
      return runCommand(command, [...rest, ...files], { cwd, timeoutMs: limitMs, env });
    }
    const bin = join(cwd, 'node_modules', 'vitest', 'vitest.mjs');
    const testTimeout = Math.max(2_000, Math.floor(limitMs / 2));
    return runCommand(
      process.execPath,
      [bin, 'run', ...files, `--testTimeout=${testTimeout}`, '--reporter=dot'],
      { cwd, timeoutMs: limitMs, env },
    );
  };
}

/**
 * The test files of the skipped suites are not run by a mutation pass, so
 * the by-imports fallback leaves them out too.
 * @param {(file: string) => string[]} related
 * @returns {(file: string) => string[]}
 */
export function withoutSkipped(related) {
  return (file) => {
    const tests = related(file);
    const skipped = new Set(matchGlobs(MUTATION_SKIP, tests));
    return tests.filter((f) => !skipped.has(f));
  };
}
