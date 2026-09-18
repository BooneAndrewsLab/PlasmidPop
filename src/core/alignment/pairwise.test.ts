import { AlignmentTooLargeError, alignPairwise } from './pairwise';

describe('alignPairwise global', () => {
  it('aligns identical sequences with full identity', () => {
    const r = alignPairwise('ACGTACGT', 'ACGTACGT');
    expect(r.alignedA).toBe('ACGTACGT');
    expect(r.matchLine).toBe('||||||||');
    expect(r.identity).toBe(1);
    expect(r.score).toBe(40);
    expect([r.startA, r.endA, r.startB, r.endB]).toEqual([0, 8, 0, 8]);
  });

  it('places a single gap where a base is missing', () => {
    const r = alignPairwise('ACGTTACGT', 'ACGTACGT');
    expect(r.alignedA).toBe('ACGTTACGT');
    expect(r.alignedB.replace('-', '')).toBe('ACGTACGT');
    expect(r.alignedB).toMatch(/^ACG-?T-?ACGT$|^ACGT-ACGT$/);
    expect(r.gaps).toBe(1);
    expect(r.score).toBe(8 * 5 - 10);
  });

  it('prefers one long gap over several short ones (affine)', () => {
    const r = alignPairwise('AAAACCCCGGGG', 'AAAAGGGG');
    expect(r.alignedB).toBe('AAAA----GGGG');
    expect(r.score).toBe(8 * 5 - 10 - 3 * 0.5);
  });

  it('scores mismatches and is case-insensitive', () => {
    const r = alignPairwise('acgt', 'ACGA');
    expect(r.matchLine).toBe('|||.');
    expect(r.score).toBe(15 - 4);
    expect(r.identities).toBe(3);
  });

  it('handles empty inputs', () => {
    expect(alignPairwise('', 'ACG').alignedA).toBe('---');
    expect(alignPairwise('ACG', '').alignedB).toBe('---');
    expect(alignPairwise('', '').columns).toBe(0);
  });
});

describe('alignPairwise local', () => {
  it('reports only the best-scoring region', () => {
    const r = alignPairwise('TTTTTTACGTACGTACGTTTTTT', 'GGGGACGTACGTACGTGGGG', { mode: 'local' });
    expect(r.alignedA).toBe('ACGTACGTACGT');
    expect(r.alignedB).toBe('ACGTACGTACGT');
    expect(r.score).toBe(60);
    expect([r.startA, r.endA]).toEqual([6, 18]);
    expect([r.startB, r.endB]).toEqual([4, 16]);
  });

  it('returns an empty alignment when nothing matches', () => {
    const r = alignPairwise('AAAA', 'CCCC', { mode: 'local' });
    expect(r.columns).toBe(0);
    expect(r.score).toBe(0);
  });

  it('can include gaps inside the local hit', () => {
    const r = alignPairwise('GGGGACGTACGTTTACGTACGTGGGG', 'CCACGTACGTACGTACGTCC', {
      mode: 'local',
    });
    expect(r.alignedA.replace(/-/g, '')).toBe('ACGTACGTTTACGTACGT');
    expect(r.alignedB.replace(/-/g, '')).toBe('ACGTACGTACGTACGT');
    expect(r.gaps).toBe(2);
  });
});

describe('limits and performance', () => {
  it('refuses oversized problems', () => {
    expect(() => alignPairwise('A'.repeat(1000), 'A'.repeat(1000), { maxCells: 1000 })).toThrow(
      AlignmentTooLargeError,
    );
  });

  it('aligns two 3 kb sequences in well under a second (plain TS baseline)', () => {
    let x = 99;
    const rnd = (): string => {
      x = (x * 1103515245 + 12345) & 0x7fffffff;
      return 'ACGT'.charAt((x >> 16) & 3);
    };
    let a = '';
    for (let i = 0; i < 3000; i++) a += rnd();
    // b: a with ~2% substitutions and a couple of indels
    let b = '';
    for (let i = 0; i < a.length; i++) {
      if (i % 50 === 0) continue; // deletion
      b += i % 47 === 0 ? (a.charAt(i) === 'A' ? 'C' : 'A') : a.charAt(i);
    }
    const t0 = performance.now();
    const r = alignPairwise(a, b);
    const ms = performance.now() - t0;
    expect(r.identity).toBeGreaterThan(0.9);
    expect(ms).toBeLessThan(1500);
    // eslint-disable-next-line no-console
    console.info(`[perf] global alignment 3000x${b.length}: ${ms.toFixed(0)} ms`);
  }, 10_000);
});
