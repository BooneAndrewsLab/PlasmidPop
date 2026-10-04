import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// CLAUDE.md is read into every coding session, so each line it carries
// taxes every turn of every session. Until 1.10 it accumulated a paragraph
// per release and reached 270 lines, most of it a changelog already kept
// in the GitHub Release notes. Trimmed to ~115 lines on 2026-10-04; this
// test keeps it there.
const text = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
const lines = text.split('\n');

describe('CLAUDE.md', () => {
  it('stays within its line budget', () => {
    expect(lines.length).toBeLessThanOrEqual(140);
  });

  it('carries no per-release paragraphs (those belong in GitHub Release notes)', () => {
    const releaseParagraphs = lines.filter((line) => /^\*\*\d+\.\d+\.\d+\*\*/.test(line));
    expect(releaseParagraphs).toEqual([]);
    expect(lines.some((line) => line.startsWith('## Status'))).toBe(false);
  });

  it('names exactly one current version', () => {
    const versions = text.match(/current is \d+\.\d+\.\d+/g) ?? [];
    expect(versions).toHaveLength(1);
  });
});
