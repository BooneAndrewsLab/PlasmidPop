import { AlignmentTooLargeError, DEFAULT_MAX_CELLS, alignPairwise } from './pairwise';

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

describe('alignPairwise IUPAC codes (#47)', () => {
  it('scores ambiguity codes by EDNAFULL instead of as mismatches', () => {
    // A–N −2 and G–R +1 (EDNAFULL), against −4 for a mismatch
    const r = alignPairwise('ACGTACGT', 'ACNTACRT');
    expect(r.alignedB).toBe('ACNTACRT');
    expect(r.matchLine).toBe('||:|||:|');
    expect(r.score).toBe(6 * 5 - 2 + 1);
    expect(r.identities).toBe(6);
    expect(r.ambiguous).toBe(2);
    expect(r.identity).toBe(6 / 8);
  });

  it('matches a degenerate base in the first sequence too, in either case', () => {
    const r = alignPairwise('ACYT', 'acct');
    expect(r.matchLine).toBe('||:|');
    expect(r.score).toBe(15 + 1);
  });

  it('still counts an incompatible code as a mismatch', () => {
    // R is A or G, never C
    const r = alignPairwise('ACGT', 'ARGT');
    expect(r.matchLine).toBe('|.||');
    expect(r.score).toBe(15 - 4);
  });

  it('does not let a run of Ns outscore the bases it hides', () => {
    // N against anything scores −2, so an N-rich read does not align everywhere
    const r = alignPairwise('GGGGGGGGACGTACGTACGT', 'NNNNNNNNNNNNNNNNNNNN', { mode: 'local' });
    expect(r.columns).toBe(0);
  });

  it('with iupac false, only identical codes match', () => {
    const r = alignPairwise('ACGT', 'ACNT', { iupac: false });
    expect(r.score).toBe(15 - 4);
    // the match line still says the N was compatible
    expect(r.matchLine).toBe('||:|');
  });

  it('treats U as T', () => {
    expect(alignPairwise('ACGT', 'ACGU').matchLine).toBe('||||');
  });
});

describe('limits and performance', () => {
  it('allows a 12 kb × 12 kb problem by default', () => {
    expect(12_001 * 12_001).toBeLessThan(DEFAULT_MAX_CELLS);
  });

  it('reports its progress through a long fill, rising and short of the end', () => {
    const seen: number[] = [];
    alignPairwise('ACGT'.repeat(600), 'TGCA'.repeat(600), {}, (f) => seen.push(f));
    // 2,401 × 2,401 cells: a report about every 830 rows
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    expect(seen.every((f) => f > 0 && f < 1)).toBe(true);
  });

  it('does not report on a small alignment', () => {
    const seen: number[] = [];
    alignPairwise('ACGTACGT', 'ACGTACGT', {}, (f) => seen.push(f));
    expect(seen).toEqual([]);
  });

  it('refuses oversized problems', () => {
    expect(() => alignPairwise('A'.repeat(1000), 'A'.repeat(1000), { maxCells: 1000 })).toThrow(
      AlignmentTooLargeError,
    );
  });

  it('aligns two 3 kb sequences quickly (plain TS baseline)', () => {
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
    // ~280 ms on a desktop, ~1.8 s on a shared CI runner; the bound only catches gross regressions.
    expect(ms).toBeLessThan(8000);
    // eslint-disable-next-line no-console
    console.info(`[perf] global alignment 3000x${b.length}: ${ms.toFixed(0)} ms`);
  }, 10_000);
});
