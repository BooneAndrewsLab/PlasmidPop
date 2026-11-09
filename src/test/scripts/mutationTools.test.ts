import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  MUTATION_SKIP,
  type MutationReport,
  busyWarning,
  changedRanges,
  domTestsOf,
  globToRegExp,
  isLoopTimeout,
  matchGlobs,
  mutantsOnChangedLines,
  mutatePatterns,
  readSources,
  relatedTests,
  resolveSpecifier,
  specifiers,
  splitUnbaselined,
  staleBaseWarning,
  triageText,
  workerCount,
} from '../../../scripts/mutationTools.mjs';

// The logic behind `npm run mutate:changed` and `npm run mutate:triage`
// (item 50, #320, #355). The scripts themselves start Stryker and are not run
// here; these tests cover what they decide.

describe('globToRegExp and matchGlobs', () => {
  it('reads * and [0-9] and escapes the dot', () => {
    const re = globToRegExp('src/test/oracle/sangerAssembly[0-9]*.test.ts');
    expect(re.test('src/test/oracle/sangerAssembly3.test.ts')).toBe(true);
    expect(re.test('src/test/oracle/sangerAssembly12.test.ts')).toBe(true);
    expect(re.test('src/test/oracle/sangerAssemblyHarness.ts')).toBe(false);
    expect(re.test('src/test/oracle/sangerAssembly3xtest.ts')).toBe(false);
    expect(globToRegExp('a/*.ts').test('a/b/c.ts')).toBe(false);
  });

  it('names real test files for every skip entry', () => {
    const files = Object.keys(readSources());
    for (const glob of MUTATION_SKIP) {
      expect(matchGlobs([glob], files), glob).not.toEqual([]);
    }
  });
});

describe('changedRanges', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,0 +4,2 @@ context',
    '+x',
    '+y',
    '@@ -10 +12 @@',
    '-z',
    '+w',
    '@@ -20,3 +23,0 @@',
    '-gone',
    'diff --git a/src/b.ts b/src/b.ts',
    '--- /dev/null',
    '+++ b/src/b.ts',
    '@@ -0,0 +1,5 @@',
    'diff --git a/src/gone.ts b/src/gone.ts',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,4 +0,0 @@',
    '',
  ].join('\n');

  it('gives the new-side lines of each hunk, one line for a bare count', () => {
    const ranges = changedRanges(diff);
    expect(ranges.get('src/a.ts')).toEqual([
      [4, 5],
      [12, 12],
      [23, 24],
    ]);
    expect(ranges.get('src/b.ts')).toEqual([[1, 5]]);
  });

  it('names the lines around a pure deletion and skips deleted files', () => {
    expect(changedRanges(diff).get('src/a.ts')?.at(-1)).toEqual([23, 24]);
    expect(changedRanges(diff).has('src/gone.ts')).toBe(false);
  });

  it('merges ranges that touch or overlap', () => {
    const d = ['+++ b/src/a.ts', '@@ -1 +1,3 @@', '@@ -9 +4,2 @@', '@@ -12 +9 @@', ''].join('\n');
    expect(changedRanges(d).get('src/a.ts')).toEqual([
      [1, 5],
      [9, 9],
    ]);
  });

  it('has no entry for a file with no hunk (a mode change)', () => {
    expect(changedRanges('+++ b/src/a.ts\n').size).toBe(0);
  });
});

describe('mutatePatterns', () => {
  const ranges = new Map<string, [number, number][]>([
    [
      'src/a.ts',
      [
        [1, 3],
        [8, 9],
      ],
    ],
    ['src/skip.ts', [[1, 1]]],
  ]);
  const list = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

  it('gives one pattern per range for a file of the list that changed', () => {
    expect(mutatePatterns(list, new Set(['src/a.ts', 'src/b.ts']), ranges)).toEqual([
      'src/a.ts:1-3',
      'src/a.ts:8-9',
    ]);
  });

  it('mutates a file whole when it is in the whole set, changed or not', () => {
    const patterns = mutatePatterns(
      list,
      new Set(['src/a.ts']),
      ranges,
      new Set(['src/a.ts', 'src/c.ts']),
    );
    expect(patterns).toEqual(['src/a.ts', 'src/c.ts']);
  });

  it('gives the whole file without ranges', () => {
    expect(mutatePatterns(list, new Set(['src/a.ts', 'src/c.ts']), null)).toEqual([
      'src/a.ts',
      'src/c.ts',
    ]);
  });
});

describe('splitUnbaselined', () => {
  const list = ['src/a.ts', 'src/b.ts', 'src/c.ts'];

  it('mutates a changed file with no baseline whole and reports an unchanged one as unmeasured', () => {
    const { whole, unmeasured } = splitUnbaselined(
      list,
      new Set(['src/a.ts']),
      new Set(['src/b.ts']),
    );
    expect([...whole]).toEqual(['src/b.ts']);
    expect(unmeasured).toEqual(['src/c.ts']);
  });

  it('leaves a file with a baseline to its changed lines', () => {
    const { whole, unmeasured } = splitUnbaselined(list, new Set(list), new Set(['src/a.ts']));
    expect(whole.size).toBe(0);
    expect(unmeasured).toEqual([]);
  });
});

describe('specifiers and resolveSpecifier', () => {
  it('finds static and dynamic local imports and leaves packages', () => {
    const found = specifiers(`
      import { a } from './a';
      import b from '@/core/b';
      import 'fake-indexeddb/auto';
      import type { C } from "../c";
      export * from './d';
      import text from './e.md?raw';
      vi.mock('../mocked', () => ({}));
      const x = await import('./lazy');
      new Worker(new URL('./w.ts', import.meta.url));
      import React from 'react';
    `);
    expect(found.static.sort()).toEqual(
      ['./a', '@/core/b', '../c', './d', './e.md?raw', '../mocked'].sort(),
    );
    expect(found.dynamic.sort()).toEqual(['./lazy', './w.ts']);
  });

  it('resolves relative, alias, index and extension forms', () => {
    const known = new Set(['src/a/x.ts', 'src/a/y.tsx', 'src/core/index.ts', 'src/b/z.ts']);
    expect(resolveSpecifier('./x', 'src/a/t.test.ts', known)).toBe('src/a/x.ts');
    expect(resolveSpecifier('./y', 'src/a/t.test.ts', known)).toBe('src/a/y.tsx');
    expect(resolveSpecifier('../b/z', 'src/a/t.test.ts', known)).toBe('src/b/z.ts');
    expect(resolveSpecifier('@/core', 'src/a/t.test.ts', known)).toBe('src/core/index.ts');
    expect(resolveSpecifier('./x.js', 'src/a/t.test.ts', known)).toBe('src/a/x.ts');
    expect(resolveSpecifier('./gone', 'src/a/t.test.ts', known)).toBeUndefined();
  });
});

describe('relatedTests', () => {
  const sources: Record<string, string> = {
    'src/core/leaf.ts': 'export const leaf = 1;',
    'src/core/mid.ts': "import { leaf } from './leaf'; export const mid = leaf;",
    'src/core/index.ts': "export * from './mid';",
    'src/core/lone.ts': 'export const lone = 1;',
    'src/core/leaf.test.ts': "import { leaf } from './leaf';",
    'src/app/viaBarrel.test.ts': "import { mid } from '@/core';",
    'src/app/viaHelper.test.ts': "import { help } from '../test/helper';",
    'src/test/helper.ts': "import { mid } from '../core/mid';",
    'src/app/unrelated.test.ts': "import { lone } from '@/core/lone';",
    'src/app/dom.test.tsx': '// @vitest-environment jsdom\nimport "react";',
    'src/test/setup.ts': "import { mid } from '../core/mid';\nawait import('../core/lone');",
  };

  it('finds the tests that import a file directly, through a barrel, or through a helper', () => {
    const found = relatedTests(sources, ['src/core/leaf.ts'], { setupFile: 'none' });
    expect(found).toEqual([
      'src/app/viaBarrel.test.ts',
      'src/app/viaHelper.test.ts',
      'src/core/leaf.test.ts',
    ]);
  });

  it('limits the search by depth', () => {
    expect(relatedTests(sources, ['src/core/leaf.ts'], { setupFile: 'none', maxDepth: 1 })).toEqual(
      ['src/core/leaf.test.ts'],
    );
  });

  it('counts the setup file`s static imports for every test and its dynamic ones for DOM tests', () => {
    const all = relatedTests(sources, ['src/core/leaf.ts']);
    expect(all).toContain('src/app/unrelated.test.ts');
    expect(all).toContain('src/app/dom.test.tsx');
    const lone = relatedTests(sources, ['src/core/lone.ts'], {
      domTests: domTestsOf(sources),
    });
    expect(lone).toEqual(['src/app/dom.test.tsx', 'src/app/unrelated.test.ts']);
  });

  it('is empty for a file no test reaches', () => {
    expect(relatedTests({ 'src/x.ts': '' }, ['src/x.ts'], { setupFile: 'none' })).toEqual([]);
  });

  it('finds the test that imports a real module, and others through the barrels', () => {
    const real = readSources();
    const found = new Set(
      relatedTests(real, ['src/core/alignment/banded.ts'], { domTests: domTestsOf(real) }),
    );
    expect(found.has('src/core/alignment/banded.test.ts')).toBe(true);
    expect(found.size).toBeGreaterThan(10);
  });
});

describe('workerCount and busyWarning', () => {
  it('never exceeds the cores minus two, nor the configured count', () => {
    expect(workerCount(8, 16)).toBe(8);
    expect(workerCount(8, 8)).toBe(6);
    expect(workerCount(undefined, 12)).toBe(10);
    expect(workerCount(14, 4)).toBe(2);
  });

  it('keeps at least one worker', () => {
    expect(workerCount(8, 2)).toBe(1);
    expect(workerCount(undefined, 1)).toBe(1);
    expect(workerCount(0, 16)).toBe(1);
  });

  it('warns when the load is past a quarter of the threads', () => {
    expect(busyWarning(0.3, 16)).toBeUndefined();
    expect(busyWarning(4, 16)).toBeUndefined();
    expect(busyWarning(8.5, 16)).toMatch(/idle\s+machine/);
    expect(busyWarning(1.5, 2)).toBeDefined();
  });
});

describe('triage of a report', () => {
  const source = [
    'export function f(a: number) {',
    '  let n = 0;',
    '  for (let i = 0; i < a; i++) {',
    '    n += i;',
    '  }',
    '  const cache = new Map();',
    '  return cache.size + n;',
    '}',
  ].join('\n');
  const mutant = (
    id: string,
    mutatorName: string,
    status: string,
    line: number,
    replacement = 'x',
  ) => ({
    id,
    mutatorName,
    replacement,
    status,
    location: { start: { line }, end: { line } },
  });
  const report: MutationReport = {
    files: {
      'src/f.ts': {
        source,
        mutants: [
          mutant('1', 'UpdateOperator', 'Timeout', 3, 'i--'),
          mutant('2', 'ConditionalExpression', 'Timeout', 3, 'true'),
          mutant('3', 'MethodExpression', 'Timeout', 6, 'new Set()'),
          mutant('4', 'ArithmeticOperator', 'Survived', 7, 'n'),
          mutant('5', 'ArithmeticOperator', 'NoCoverage', 4),
          mutant('6', 'ArithmeticOperator', 'Killed', 4),
          mutant('7', 'MethodExpression', 'Timeout', 1),
        ],
      },
      'src/g.ts': { source: 'x', mutants: [mutant('8', 'X', 'Survived', 1)] },
    },
  };
  const ranges = new Map<string, [number, number][]>([['src/f.ts', [[3, 7]]]]);

  it('takes only mutants of the status that start on a changed line', () => {
    const timeouts = mutantsOnChangedLines(report, ranges, ['Timeout']);
    expect(timeouts.map((t) => t.mutant.id)).toEqual(['1', '2', '3']);
    expect(timeouts[2]?.text).toBe('const cache = new Map();');
    const open = mutantsOnChangedLines(report, ranges, ['Survived', 'NoCoverage']);
    expect(open.map((t) => t.mutant.id)).toEqual(['4', '5']);
  });

  it('calls a flipped counter or a mutant on a loop line a loop, and the rest not', () => {
    const [a, b, c] = mutantsOnChangedLines(report, ranges, ['Timeout']);
    expect(a && isLoopTimeout(a)).toBe(true);
    expect(b && isLoopTimeout(b)).toBe(true);
    expect(c && isLoopTimeout(c)).toBe(false);
  });

  it('writes survivors per file with their skipped suites, and the timeouts split', () => {
    const text = triageText(report, ranges, (f) => (f === 'src/f.ts' ? ['src/x.test.ts'] : []));
    expect(text).toContain('Survivors and uncovered mutants on lines changed: 2');
    expect(text).toContain('src/f.ts: 2');
    expect(text).toContain('src/x.test.ts');
    expect(text).toContain('Timeouts on lines changed: 3 (2 loops, sound kills)');
    expect(text).toContain('MethodExpression (1)');
    expect(text).toContain('6: const cache = new Map();  ->  new Set()');
    expect(text).not.toContain('src/g.ts');
  });

  it('says so when nothing is left', () => {
    const text = triageText({ files: {} }, ranges, () => []);
    expect(text).toContain('lines changed: 0');
    expect(text).toContain('Timeouts on lines changed: 0 (0 loops');
    expect(text).not.toContain('apply by hand');
  });
});

describe('mutate-triage.mjs, run in a repository of its own', () => {
  it('lists the survivors on the lines changed since a tag', () => {
    const dir = mkdtempSync(join(tmpdir(), 'triage-'));
    const file = 'src/core/alignment/banded.ts';
    mkdirSync(join(dir, 'src/core/alignment'), { recursive: true });
    mkdirSync(join(dir, 'reports/mutation'), { recursive: true });
    const git = (...args: string[]) =>
      execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...args], {
        cwd: dir,
        encoding: 'utf8',
      });
    git('init', '-q');
    writeFileSync(join(dir, file), 'x\n');
    git('add', 'src');
    git('commit', '-q', '-m', 'one');
    git('tag', 'v0.0.1');
    writeFileSync(join(dir, file), 'a\nb\nc\n');
    git('commit', '-q', '-am', 'two');
    const survivor = (id: string, line: number) => ({
      id,
      mutatorName: 'EqualityOperator',
      status: 'Survived',
      location: { start: { line }, end: { line } },
    });
    const report: MutationReport = {
      files: { [file]: { source: 'a\nb\nc', mutants: [survivor('1', 1), survivor('2', 3)] } },
    };
    writeFileSync(join(dir, 'reports/mutation/mutation.json'), JSON.stringify(report));
    const script = join(process.cwd(), 'scripts', 'mutate-triage.mjs');
    const text = execFileSync('node', [script, 'v0.0.1'], { cwd: dir, encoding: 'utf8' });
    expect(text).toContain('Lines changed since v0.0.1.');
    expect(text).toContain('Survivors and uncovered mutants on lines changed: 2');
    expect(text).toContain(`${file}: 2`);
  });
});

describe('staleBaseWarning', () => {
  it('says nothing when the base is the newest release tag on the remote', () => {
    expect(staleBaseWarning('v1.24.0', ['v1.23.0', 'v1.24.0', 'v1.8.1'])).toBeNull();
  });

  it('names the newest remote tag when the base is older', () => {
    const warning = staleBaseWarning('v1.23.0', ['v1.8.1', 'v1.24.0', 'v1.9.0', 'v1.23.0']);
    expect(warning).toContain('v1.24.0');
    expect(warning).toContain('v1.23.0');
    expect(warning).toContain('git fetch --tags');
  });

  it('compares the parts as numbers, not as text', () => {
    expect(staleBaseWarning('v1.9.0', ['v1.10.0'])).toContain('v1.10.0');
    expect(staleBaseWarning('v1.10.0', ['v1.9.0'])).toBeNull();
    expect(staleBaseWarning('v1.24.0', ['v1.24.1'])).toContain('v1.24.1');
    expect(staleBaseWarning('v1.24.1', ['v2.0.0'])).toContain('v2.0.0');
  });

  it('ignores tags that are not releases, and a base that is not one', () => {
    expect(staleBaseWarning('v1.24.0', ['v2.0.0-rc1', 'nightly', ''])).toBeNull();
    expect(staleBaseWarning('main', ['v9.9.9'])).toBeNull();
    expect(staleBaseWarning('v1.24.0', [])).toBeNull();
  });
});
