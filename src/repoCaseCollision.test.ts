import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// macOS and Windows check out into case-insensitive file systems, where two
// tracked paths that differ only by case overwrite each other, and so do two
// modules whose import specifier differs only by case (`./cloningDesign` and
// `./CloningDesign` both resolve to whichever file landed on disk). Issue #455:
// the repo tracked CloningDesign.tsx beside cloningDesign.ts, and Markdown.tsx
// beside markdown.ts, so a clone there could not build.

/** Groups of tracked paths that clash on a case-insensitive file system. */
export function caseCollisions(paths: string[]): string[][] {
  const byFull = new Map<string, Set<string>>();
  const byStem = new Map<string, Set<string>>();
  const add = (map: Map<string, Set<string>>, key: string, path: string): void => {
    const group = map.get(key.toLowerCase()) ?? new Set<string>();
    group.add(path);
    map.set(key.toLowerCase(), group);
  };
  for (const path of paths) {
    add(byFull, path, path);
    // The module name without its last extension: foo.ts and Foo.tsx.
    add(byStem, path.replace(/\.[^./]+$/, ''), path);
  }
  const clashes: string[][] = [];
  for (const map of [byFull, byStem]) {
    for (const group of map.values()) {
      if (group.size < 2) continue;
      const sorted = [...group].sort();
      // Same-case stems (foo.ts and foo.css) are legitimate; flag only when
      // the paths really differ once their extension is ignored in the stem map.
      const stems = new Set(sorted.map((p) => p.replace(/\.[^./]+$/, '')));
      if (map === byStem && stems.size < 2) continue;
      clashes.push(sorted);
    }
  }
  const seen = new Set<string>();
  return clashes.filter((g) => {
    const key = g.join('\0');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe('caseCollisions', () => {
  it('flags paths that differ only by case', () => {
    expect(caseCollisions(['a/Foo.ts', 'a/foo.ts'])).toEqual([['a/Foo.ts', 'a/foo.ts']]);
  });

  it('flags modules whose names differ only by case across extensions', () => {
    expect(caseCollisions(['src/Markdown.tsx', 'src/markdown.ts'])).toEqual([
      ['src/Markdown.tsx', 'src/markdown.ts'],
    ]);
  });

  it('accepts distinct names and same-case companions', () => {
    expect(caseCollisions(['src/foo.ts', 'src/foo.css', 'src/Bar.tsx', 'src/bar2.ts'])).toEqual([]);
  });
});

describe('tracked files', () => {
  it('has no two paths that differ only by case', () => {
    const out = execFileSync('git', ['ls-files', '-z'], {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    const paths = out.split('\0').filter((p) => p !== '');
    expect(paths.length).toBeGreaterThan(0);
    expect(caseCollisions(paths)).toEqual([]);
  });
});
