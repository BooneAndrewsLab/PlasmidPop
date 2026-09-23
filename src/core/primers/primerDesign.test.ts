import { reverseComplement } from '../sequence';
import { DEFAULT_PRIMER_CRITERIA, normalizePrimerCriteria } from './criteria';
import { analyzePrimer, designPrimers, findPrimerBindingSites } from './primerDesign';
import { longestHairpinStem, threePrimeComplementarity } from './thermo';

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
      expect.arrayContaining(['Shorter than 18 bases', 'GC content below 35%']),
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
      { maxPairs: 3, forwardRegion: { near: 0, far: 50 } },
    );
    for (const p of linear) expect(p.forwardSite.start).toBeGreaterThanOrEqual(0);
    expect(designPrimers('', 'linear', { start: 0, end: 0 })).toEqual([]);
  });
});

describe('designPrimers with criteria', () => {
  const seq = template();
  const target = { start: 250, end: 350 };

  it('keeps every candidate inside the ranges it is given', () => {
    const c = {
      minLength: 20,
      maxLength: 22,
      minTm: 56,
      maxTm: 62,
      minGc: 0.45,
      maxGc: 0.6,
      maxTmDifference: 2,
    };
    const pairs = designPrimers(seq, 'linear', target, c);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      for (const r of [p.forward, p.reverse]) {
        expect(r.length).toBeGreaterThanOrEqual(20);
        expect(r.length).toBeLessThanOrEqual(22);
        expect(r.tm).toBeGreaterThanOrEqual(56);
        expect(r.tm).toBeLessThanOrEqual(62);
        expect(r.gc).toBeGreaterThanOrEqual(0.45);
        expect(r.gc).toBeLessThanOrEqual(0.6);
      }
      expect(p.tmDifference).toBeLessThanOrEqual(2);
    }
  });

  it('looks for each primer only in its own region', () => {
    const pairs = designPrimers(seq, 'linear', target, {
      forwardRegion: { near: 50, far: 120 },
      reverseRegion: { near: 30, far: 90 },
      maxPairs: 20,
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.forwardSite.start).toBeGreaterThanOrEqual(target.start - 120);
      expect(p.forwardSite.end).toBeLessThanOrEqual(target.start - 50);
      expect(p.reverseSite.start).toBeGreaterThanOrEqual(target.end + 30);
      expect(p.reverseSite.end).toBeLessThanOrEqual(target.end + 90);
    }
  });

  it('lets a negative near edge reach into the target, as from a start codon', () => {
    const pairs = designPrimers(seq, 'linear', target, {
      forwardRegion: { near: -40, far: 0 },
      reverseRegion: { near: -40, far: 0 },
      minTm: 50,
      maxTm: 70,
      maxTmDifference: 6,
      maxPairs: 20,
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.forwardSite.start).toBeGreaterThanOrEqual(target.start);
      expect(p.forwardSite.end).toBeLessThanOrEqual(target.start + 40);
      expect(p.reverseSite.start).toBeGreaterThanOrEqual(target.end - 40);
      expect(p.reverseSite.end).toBeLessThanOrEqual(target.end);
    }
  });

  it('refuses hairpins, dimers and missing clamps when told to', () => {
    const loose = designPrimers(seq, 'linear', target, {
      maxHairpin: 60,
      maxSelfComplementarity: 60,
      maxThreePrime: 60,
      maxPairs: 50,
    });
    const strict = designPrimers(seq, 'linear', target, {
      maxHairpin: 3,
      maxThreePrime: 2,
      requireGcClamp: true,
      maxPairs: 50,
    });
    expect(strict.length).toBeGreaterThan(0);
    expect(loose.some((p) => p.forward.hairpin > 3 || p.reverse.hairpin > 3)).toBe(true);
    for (const p of strict) {
      for (const r of [p.forward, p.reverse]) {
        expect(r.hairpin).toBeLessThanOrEqual(3);
        expect(r.threePrimeSelf).toBeLessThanOrEqual(2);
        expect(r.gcClamp).toBe(true);
      }
      expect(p.crossDimer).toBeLessThanOrEqual(2);
    }
  });

  it('keeps products inside the size range', () => {
    const pairs = designPrimers(seq, 'linear', target, {
      minProduct: 250,
      maxProduct: 300,
      maxPairs: 20,
    });
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) {
      expect(p.productLength).toBeGreaterThanOrEqual(250);
      expect(p.productLength).toBeLessThanOrEqual(300);
    }
  });

  it('refuses a primer that would also anneal elsewhere', () => {
    // A second copy of 40..130, where the best forward primers are, at the
    // end: a primer lying wholly in that stretch primes twice.
    const repeated = seq + seq.slice(40, 130);
    const inRepeat = (r: { start: number; end: number }): boolean => r.start >= 40 && r.end <= 130;
    const loose = designPrimers(repeated, 'linear', target, {
      requireSpecific: false,
      maxPairs: 50,
    });
    expect(loose.some((p) => inRepeat(p.forwardSite))).toBe(true);
    const strict = designPrimers(repeated, 'linear', target, { maxPairs: 50 });
    expect(strict.length).toBeGreaterThan(0);
    for (const p of strict) {
      expect(inRepeat(p.forwardSite)).toBe(false);
      for (const [primer, strand, site] of [
        [p.forward.sequence, 'forward', p.forwardSite],
        [p.reverse.sequence, 'reverse', p.reverseSite],
      ] as const) {
        expect(findPrimerBindingSites(repeated, 'linear', primer)).toEqual([
          expect.objectContaining({ strand, range: site }),
        ]);
      }
    }
  });

  it('judges a pasted primer by the same criteria', () => {
    const c = { ...DEFAULT_PRIMER_CRITERIA, minLength: 10, minGc: 0.2 };
    expect(analyzePrimer('ATATATATATAT', c).warnings).not.toContain('Shorter than 10 bases');
    expect(analyzePrimer('GAATTCAAAAAAGAATTC').warnings.join()).toMatch(/Hairpin|Self/);
  });
});

describe('criteria', () => {
  it('fills gaps with defaults and puts ranges the right way round', () => {
    expect(normalizePrimerCriteria(null)).toEqual(DEFAULT_PRIMER_CRITERIA);
    const c = normalizePrimerCriteria({
      minLength: 30,
      maxLength: 20,
      minTm: 'hot',
      forwardRegion: { near: 100, far: 10 },
      requireGcClamp: true,
      minProduct: 5000,
      maxProduct: 100,
      requireSpecific: 'yes',
    });
    expect([c.minProduct, c.maxProduct]).toEqual([100, 5000]);
    expect(c.requireSpecific).toBe(true);
    expect([c.minLength, c.maxLength]).toEqual([20, 30]);
    expect(c.minTm).toBe(DEFAULT_PRIMER_CRITERIA.minTm);
    expect(c.forwardRegion).toEqual({ near: 10, far: 100 });
    expect(c.requireGcClamp).toBe(true);
  });
});

describe('hairpins and 3′ dimers', () => {
  it('finds a stem only with room for a loop', () => {
    // GAATTC ... GAATTC: the EcoRI site pairs with itself, arms 6 bp.
    expect(longestHairpinStem('GGATCCTTTTGGATCC')).toBe(6);
    // Arms right next to each other cannot turn: no loop.
    expect(longestHairpinStem('GGATCCGGATCC', 3)).toBeLessThan(6);
    expect(longestHairpinStem('AAAAAAAA')).toBe(0);
  });

  it('measures pairing at the 3′ end only', () => {
    // 3' end GGATCC is its own reverse complement.
    expect(threePrimeComplementarity('TTTTTGGATCC', 'TTTTTGGATCC')).toBe(6);
    expect(threePrimeComplementarity('AAAAAAAC', 'TTTTTTTT')).toBe(0);
    expect(threePrimeComplementarity('CCCCAAAA', 'TTTTGGGG')).toBe(8);
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
