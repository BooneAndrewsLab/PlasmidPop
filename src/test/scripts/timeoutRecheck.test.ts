import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  type Report,
  applyMutant,
  collectTimeouts,
  mutantKey,
  offsetOf,
  runCommand,
  spanText,
  verdictOf,
} from '../../../scripts/timeoutRecheck.mjs';

// `npm run mutate:recheck-timeouts` (#356, item 50): applies the non-loop
// timeouts of a Stryker report to a file and runs the tests that covered
// them. These tests run it against a tiny project in a temporary directory
// with a fake test runner; the real sources are never touched.

const SOURCE = 'export const a = 1;\nexport const b = 2;\nfor (let i = 0; i < 3; i++) {}\n';

type M = Report['files'][string]['mutants'][number];
const mutant = (
  id: string,
  line: number,
  start: number,
  end: number,
  replacement: string,
  extra: Partial<M> = {},
): M => ({
  id,
  mutatorName: 'StringLiteral',
  replacement,
  status: 'Timeout',
  coveredBy: ['1'],
  location: { start: { line, column: start }, end: { line, column: end } },
  ...extra,
});

const report = (source: string, mutants: M[]): Report => ({
  files: { 'src/lib.ts': { source, mutants } },
  testFiles: { 'src/lib.test.ts': { tests: [{ id: '1' }] } },
});

describe('locations and applying a mutant', () => {
  it('reads 1-based lines and columns', () => {
    expect(offsetOf(SOURCE, { line: 1, column: 1 })).toBe(0);
    expect(offsetOf(SOURCE, { line: 2, column: 1 })).toBe(20);
    expect(offsetOf(SOURCE, { line: 9, column: 1 })).toBeUndefined();
    const m = mutant('1', 2, 18, 19, '9');
    expect(spanText(SOURCE, m.location)).toBe('2');
  });

  it('applies a replacement at its span', () => {
    const applied = applyMutant(SOURCE, SOURCE, mutant('1', 2, 18, 19, '9'));
    expect(applied).toEqual({
      original: '2',
      mutated: 'export const a = 1;\nexport const b = 9;\nfor (let i = 0; i < 3; i++) {}\n',
    });
  });

  it('applies a multi-line span', () => {
    const m: M = {
      ...mutant('1', 1, 18, 1, '0'),
      location: { start: { line: 1, column: 18 }, end: { line: 2, column: 18 } },
    };
    const applied = applyMutant(SOURCE, SOURCE, m);
    expect(applied).toEqual({
      original: '1;\nexport const b = ',
      mutated: 'export const a = 02;\nfor (let i = 0; i < 3; i++) {}\n',
    });
  });

  it('refuses a mutant when the file changed under it', () => {
    const edited = SOURCE.replace('b = 2', 'b = 22');
    const stale = applyMutant(edited, SOURCE, mutant('1', 2, 18, 19, '9'));
    expect(stale).toHaveProperty('stale');
    // Same span text, but the line around it differs.
    const moved = SOURCE.replace('export const b', 'export  const b');
    expect(applyMutant(moved, SOURCE, mutant('1', 2, 19, 20, '9'))).toHaveProperty('stale');
    expect(applyMutant('x\n', SOURCE, mutant('1', 2, 18, 19, '9'))).toHaveProperty('stale');
  });

  it('refuses a mutant with no replacement, or one that changes nothing', () => {
    const { replacement: _replacement, ...bare } = mutant('1', 2, 18, 19, '');
    expect(applyMutant(SOURCE, SOURCE, bare)).toHaveProperty('stale');
    expect(applyMutant(SOURCE, SOURCE, mutant('1', 2, 18, 19, '2'))).toHaveProperty('stale');
  });
});

describe('collectTimeouts', () => {
  const loop = mutant('2', 3, 22, 25, 'i--', { mutatorName: 'UpdateOperator' });
  const plain = mutant('3', 2, 18, 19, '9');
  const bodyOfLoop = mutant('4', 3, 10, 11, 'x', { mutatorName: 'ConditionalExpression' });
  const killed = mutant('5', 1, 18, 19, '0', { status: 'Killed' });

  it('returns the timeouts, loops flagged, in file and line order', () => {
    const found = collectTimeouts([
      { name: 'r', report: report(SOURCE, [loop, plain, bodyOfLoop, killed]) },
    ]);
    expect(found.map((t) => [t.mutant.id, t.loop])).toEqual([
      ['3', false],
      ['4', true],
      ['2', true],
    ]);
    expect(found[0]?.testFiles).toEqual(['src/lib.test.ts']);
  });

  it('names no test files for a mutant the report has no coverage for', () => {
    const found = collectTimeouts([
      { name: 'r', report: report(SOURCE, [{ ...plain, coveredBy: [] }]) },
    ]);
    expect(found[0]?.testFiles).toBeUndefined();
  });

  it('reads a mutant that two reports hold from the first', () => {
    const newer = report(SOURCE, [{ ...plain, status: 'Killed' }]);
    const older = report(SOURCE, [plain, { ...bodyOfLoop, id: '9' }]);
    const found = collectTimeouts([
      { name: 'new', report: newer },
      { name: 'old', report: older },
    ]);
    expect(found.map((t) => [t.report, t.mutant.id])).toEqual([['old', '9']]);
    expect(mutantKey('f', plain)).toBe(mutantKey('f', { ...plain, id: 'other' }));
  });
});

describe('verdictOf', () => {
  const run = (over: Partial<Parameters<typeof verdictOf>[0]>) => ({
    code: 0,
    signal: null,
    timedOut: false,
    output: '',
    ms: 1,
    ...over,
  });

  it('calls passing tests a survivor and failing tests a kill', () => {
    expect(verdictOf(run({}))).toBe('survived');
    expect(verdictOf(run({ code: 1, output: 'AssertionError: expected 1 to be 2' }))).toBe(
      'killed',
    );
  });

  it('calls a process limit or a test limit a timeout', () => {
    expect(verdictOf(run({ timedOut: true, code: null }))).toBe('timeout');
    expect(verdictOf(run({ code: 1, output: 'Error: Test timed out in 5000ms.' }))).toBe('timeout');
  });

  it('sets a mutant that did not compile apart from a kill', () => {
    expect(verdictOf(run({ code: 1, output: 'Error: Transform failed with 1 error' }))).toBe(
      'error',
    );
  });
});

describe('runCommand', () => {
  it('kills a command that never ends, and its children, at the limit', async () => {
    const started = Date.now();
    const result = await runCommand(
      process.execPath,
      [
        '-e',
        "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','for(;;);'],{stdio:'inherit'});for(;;);",
      ],
      { cwd: tmpdir(), timeoutMs: 700 },
    );
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 15_000);

  it('returns the exit code and the output of a command that ends', async () => {
    const result = await runCommand(process.execPath, ['-e', "console.log('hi');process.exit(3)"], {
      cwd: tmpdir(),
      timeoutMs: 10_000,
    });
    expect(result).toMatchObject({ code: 3, timedOut: false });
    expect(result.output).toContain('hi');
  });
});

// ---------------------------------------------------------------------------
// The script, end to end, on a project in a temporary directory.

const CLI = join(process.cwd(), 'scripts', 'mutate-recheck-timeouts.mjs');

// The fake test runner stands in for Vitest: it reads src/lib.ts and decides
// by what the mutant wrote there. HANG never ends, FAIL fails, anything else
// passes; the tests it is given must exist.
const RUNNER = `
import { readFileSync } from 'node:fs';
const text = readFileSync('src/lib.ts', 'utf8');
if (text.includes('HANG')) for (;;);
if (text.includes('FAIL')) { console.log('AssertionError: nope'); process.exit(1); }
process.exit(0);
`;

const LIB = [
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
  '',
].join('\n');

interface Project {
  dir: string;
  lib: string;
  run: (extra: string[], env?: NodeJS.ProcessEnv) => ReturnType<typeof spawnSync>;
  git: (...args: string[]) => string;
}

const made: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const c of children.splice(0)) c.kill('SIGKILL');
  for (const d of made.splice(0)) rmSync(d, { recursive: true, force: true });
});

function project(mutants: M[], opts: { commit?: boolean } = {}): Project {
  const dir = mkdtempSync(join(tmpdir(), 'recheck-'));
  made.push(dir);
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, 'reports', 'mutation'), { recursive: true });
  writeFileSync(join(dir, 'src', 'lib.ts'), LIB);
  writeFileSync(join(dir, 'src', 'lib.test.ts'), '// fake\n');
  writeFileSync(join(dir, 'runner.mjs'), RUNNER);
  writeFileSync(
    join(dir, 'reports', 'mutation', 'mutation.json'),
    JSON.stringify(report(LIB, mutants)),
  );
  writeFileSync(join(dir, '.gitignore'), 'reports/\n');
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.email=t@example.com',
        '-c',
        'user.name=t',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8' },
    );
  git('init', '-q');
  if (opts.commit !== false) {
    git('add', '.');
    git('commit', '-q', '-m', 'init');
  }
  const run = (extra: string[], env?: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      [
        CLI,
        '--cwd',
        dir,
        '--test-command',
        JSON.stringify([process.execPath, 'runner.mjs']),
        ...extra,
      ],
      { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 60_000 },
    );
  return { dir, lib: join(dir, 'src', 'lib.ts'), run, git };
}

// Lines 1-4 of LIB, the value at column 18.
const m1 = mutant('1', 1, 18, 19, 'PASS');
const m2 = mutant('2', 2, 18, 19, 'FAIL');
const m3 = mutant('3', 3, 18, 19, 'HANG');
const m4 = mutant('4', 4, 18, 19, 'PASS');

describe('mutate:recheck-timeouts', () => {
  it('lists the mutants whose tests pass, and leaves the file as it was', () => {
    const p = project([m1, m2, m3]);
    const r = p.run(['--timeout-seconds', '1.5']);
    expect(r.status).toBe(0);
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
    expect(p.git('status', '--porcelain')).toBe('');
    const json = JSON.parse(
      readFileSync(join(p.dir, 'reports/mutation/timeout-recheck/report.json'), 'utf8'),
    ) as { counts: Record<string, number>; survivors: { line: number }[] };
    expect(json.counts).toEqual({ killed: 1, survived: 1, timeout: 1 });
    expect(json.survivors.map((s) => s.line)).toEqual([1]);
    const md = readFileSync(join(p.dir, 'reports/mutation/timeout-recheck/report.md'), 'utf8');
    expect(md).toContain('1:18 StringLiteral');
    expect(existsSync(join(p.dir, 'reports/mutation/timeout-recheck/applied.json'))).toBe(false);
  }, 60_000);

  it('skips loop-counter flips', () => {
    const loopLib = `${LIB}for (let i = 0; i < 3; i++) {}\n`;
    const p = project([m1]);
    writeFileSync(
      join(p.dir, 'reports/mutation/mutation.json'),
      JSON.stringify(
        report(loopLib, [m1, mutant('9', 5, 22, 25, 'i--', { mutatorName: 'UpdateOperator' })]),
      ),
    );
    const r = p.run(['--dry-run']);
    expect(r.stdout).toContain('(1 loops, skipped)');
    expect(r.stdout).toContain('1 mutant(s) would be applied');
  });

  it('a dry run prints the mutants and changes nothing', () => {
    const p = project([m1, m2]);
    const r = p.run(['--dry-run']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('src/lib.ts:1:18 StringLiteral: 1 -> PASS');
    expect(r.stdout).toContain('2 mutant(s) would be applied');
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
    expect(existsSync(join(p.dir, 'reports/mutation/timeout-recheck'))).toBe(false);
  });

  it('refuses to start when a target file has uncommitted changes', () => {
    const p = project([m1]);
    writeFileSync(p.lib, `${LIB}// edit\n`);
    const r = p.run(['--timeout-seconds', '2']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing to start');
    expect(readFileSync(p.lib, 'utf8')).toBe(`${LIB}// edit\n`);
  });

  it('refuses outside a git checkout', () => {
    const p = project([m1], { commit: false });
    rmSync(join(p.dir, '.git'), { recursive: true });
    const r = p.run(['--timeout-seconds', '2']);
    expect(r.status).toBe(1);
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
  });

  it('marks a mutant stale when the file changed since the report', () => {
    const p = project([m1, m2]);
    writeFileSync(p.lib, LIB.replace('a = 1', 'a = 11'));
    p.git('commit', '-q', '-am', 'edit');
    const r = p.run(['--timeout-seconds', '2']);
    expect(r.status).toBe(0);
    const json = JSON.parse(
      readFileSync(join(p.dir, 'reports/mutation/timeout-recheck/report.json'), 'utf8'),
    ) as { counts: Record<string, number> };
    expect(json.counts).toEqual({ killed: 1, stale: 1 });
  }, 60_000);

  it('limits the mutants run and resumes where it stopped', () => {
    const p = project([m1, m2, m4]);
    const first = p.run(['--timeout-seconds', '2', '--limit', '2']);
    expect(first.stdout).toContain('2 mutant(s) to run');
    expect(first.stdout).toContain('1 more waiting');
    const second = p.run(['--timeout-seconds', '2', '--resume']);
    expect(second.stdout).toContain('Resuming: 2 mutant(s)');
    expect(second.stdout).toContain('1 mutant(s) to run');
    const json = JSON.parse(
      readFileSync(join(p.dir, 'reports/mutation/timeout-recheck/report.json'), 'utf8'),
    ) as { counts: Record<string, number> };
    expect(json.counts).toEqual({ killed: 1, survived: 2 });
    const third = p.run(['--timeout-seconds', '2', '--resume']);
    expect(third.stdout).toContain('0 mutant(s) to run');
  }, 60_000);

  it('takes only the files asked for', () => {
    const p = project([m1]);
    expect(p.run(['--dry-run', '--file', 'nothing/here.ts']).stdout).toContain(
      '0 mutant(s) would be applied',
    );
    expect(p.run(['--dry-run', '--file', 'lib.ts']).stdout).toContain(
      '1 mutant(s) would be applied',
    );
  });

  it('skips a file whose tests fail unmutated', () => {
    const p = project([m1]);
    writeFileSync(join(p.dir, 'runner.mjs'), 'process.exit(1);\n');
    p.git('add', '-A');
    p.git('commit', '-q', '-m', 'red');
    const r = p.run([]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('fail unmutated');
    expect(r.stdout).toContain('1 baseline-red');
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
  }, 60_000);

  it('restores the file after SIGTERM in the middle of a mutant', async () => {
    const p = project([m3]);
    const child = spawn(
      process.execPath,
      [
        CLI,
        '--cwd',
        p.dir,
        '--test-command',
        JSON.stringify([process.execPath, 'runner.mjs']),
        '--timeout-seconds',
        '60',
      ],
      { stdio: 'ignore' },
    );
    children.push(child);
    const exited = new Promise<number | null>((done) =>
      child.on('exit', (code) => {
        done(code);
      }),
    );
    const deadline = Date.now() + 20_000;
    while (!readFileSync(p.lib, 'utf8').includes('HANG')) {
      if (Date.now() > deadline) throw new Error('the mutant was never applied');
      await new Promise((r) => setTimeout(r, 25));
    }
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
    expect(p.git('status', '--porcelain')).toBe('');
    expect(existsSync(join(p.dir, 'reports/mutation/timeout-recheck/applied.json'))).toBe(false);
  }, 40_000);

  it('restores a file that a killed run left mutated, from the journal', () => {
    const p = project([m1]);
    const state = join(p.dir, 'reports/mutation/timeout-recheck');
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, 'applied.orig'), LIB);
    writeFileSync(join(state, 'applied.json'), '{"file":"src/lib.ts"}\n');
    writeFileSync(p.lib, LIB.replace('a = 1', 'a = HANG'));
    const r = p.run(['--timeout-seconds', '2']);
    expect(r.stdout).toContain('A previous run was killed with src/lib.ts mutated');
    expect(r.status).toBe(0);
    expect(readFileSync(p.lib, 'utf8')).toBe(LIB);
    expect(p.git('status', '--porcelain')).toBe('');
  }, 60_000);
});
