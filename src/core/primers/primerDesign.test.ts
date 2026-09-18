import { reverseComplement } from '../sequence';
import { analyzePrimer, designPrimers, findPrimerBindingSites } from './primerDesign';

// A pseudo-random but fixed 600-bp template with balanced composition.
function template(): string {
  let x = 12345;
  let out = '';
  for (let i = 0; i < 600; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

describe('analyzePrimer', () => {
  it('reports metrics and warnings', () => {
    const good = analyzePrimer('GTAAAACGACGGCCAGTGC');
    expect(good.length).toBe(19);
    expect(good.gcClamp).toBe(true);
    expect(good.warnings).not.toContain('No GC clamp at the 3′ end');
    const bad = analyzePrimer('ATATATATATAT');
    expect(bad.warnings).toEqual(
      expect.arrayContaining(['Shorter than 18 bases', 'GC content below 40%']),
    );
    expect(analyzePrimer('GGGGGGAAAAAAAAAAAAAAAT').warnings.join()).toMatch(
      /Run of 1[0-9]|Run of [5-9]/,
    );
  });
});

describe('designPrimers', () => {
  const seq = template();

  it('returns ranked pairs that flank the target with matched Tm', () => {
    const target = { start: 250, end: 350 };
    const pairs = designPrimers(seq, 'linear', target, { maxPairs: 5 });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.forwardSite.end).toBeLessThanOrEqual(target.start);
      expect(p.reverseSite.start).toBeGreaterThanOrEqual(target.end);
      expect(p.tmDifference).toBeLessThanOrEqual(3);
      expect(p.forward.tm).toBeGreaterThanOrEqual(55);
      expect(p.reverse.tm).toBeLessThanOrEqual(65);
      expect(p.productLength).toBe(p.reverseSite.end - p.forwardSite.start);
      // The forward primer is the template text; the reverse primer is the reverse complement.
      expect(seq.slice(p.forwardSite.start, p.forwardSite.end)).toBe(p.forward.sequence);
      expect(reverseComplement(seq.slice(p.reverseSite.start, p.reverseSite.end))).toBe(
        p.reverse.sequence,
      );
    }
    for (let i = 1; i < pairs.length; i++)
      expect(pairs[i]?.penalty ?? 0).toBeGreaterThanOrEqual(pairs[i - 1]?.penalty ?? 0);
  });

  it('designs across the origin on circular templates and respects linear ends', () => {
    const circular = designPrimers(seq, 'circular', { start: 20, end: 60 }, { maxPairs: 3 });
    expect(circular.length).toBeGreaterThan(0);
    expect(
      circular.some(
        (p) => p.forwardSite.start > p.forwardSite.end - 600 && p.forwardSite.start > 500,
      ),
    ).toBe(true);
    const linear = designPrimers(
      seq,
      'linear',
      { start: 5, end: 60 },
      { maxPairs: 3, searchWindow: 50 },
    );
    for (const p of linear) expect(p.forwardSite.start).toBeGreaterThanOrEqual(0);
    expect(designPrimers('', 'linear', { start: 0, end: 0 })).toEqual([]);
  });
});

describe('findPrimerBindingSites', () => {
  const seq = template();

  it('finds exact and near matches on both strands with a strict 3′ anchor', () => {
    const fwd = seq.slice(100, 120);
    const sites = findPrimerBindingSites(seq, 'linear', fwd);
    expect(sites).toContainEqual({
      range: { start: 100, end: 120 },
      strand: 'forward',
      mismatches: 0,
    });
    const rev = reverseComplement(seq.slice(300, 322));
    expect(findPrimerBindingSites(seq, 'linear', rev)).toContainEqual({
      range: { start: 300, end: 322 },
      strand: 'reverse',
      mismatches: 0,
    });
    // One mismatch in the 5' half is tolerated…
    const mutated = (fwd.charAt(2) === 'A' ? 'C' : 'A') + fwd.slice(1);
    expect(
      findPrimerBindingSites(seq, 'linear', mutated).some(
        (s) => s.range.start === 100 && s.mismatches === 1,
      ),
    ).toBe(true);
    // …but a 3' mismatch is not.
    const threePrime = fwd.slice(0, 19) + (fwd.charAt(19) === 'A' ? 'C' : 'A');
    expect(
      findPrimerBindingSites(seq, 'linear', threePrime).some((s) => s.range.start === 100),
    ).toBe(false);
  });

  it('wraps on circular templates', () => {
    const probe = seq.slice(590) + seq.slice(0, 10);
    expect(findPrimerBindingSites(seq, 'circular', probe)).toContainEqual({
      range: { start: 590, end: 610 },
      strand: 'forward',
      mismatches: 0,
    });
    expect(findPrimerBindingSites(seq, 'linear', probe).some((s) => s.range.start === 590)).toBe(
      false,
    );
    expect(findPrimerBindingSites(seq, 'linear', '')).toEqual([]);
  });
});
