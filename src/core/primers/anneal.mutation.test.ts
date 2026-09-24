import { reverseComplement } from '../sequence';
import { cleanPrimer, findAnnealingSites, mismatchPositions, pairsWithCode } from './anneal';
import { meltingTemperature } from './thermo';

/** A fixed pseudo-random template, so no site is there by coincidence. */
function template(length: number, seed = 424242): string {
  let x = seed;
  let out = '';
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += 'ACGT'.charAt((x >> 16) & 3);
  }
  return out;
}

/** `text` with `at` replaced by `code`. */
function withCode(text: string, at: number, code: string): string {
  return text.slice(0, at) + code + text.slice(at + 1);
}

describe('pairsWithCode', () => {
  it('pairs a code with the bases it stands for, and nothing with a gap', () => {
    expect(pairsWithCode('A', 'R')).toBe(true);
    expect(pairsWithCode('C', 'R')).toBe(false);
    expect(pairsWithCode('N', 'N')).toBe(true);
    expect(pairsWithCode('N', 'A')).toBe(false);
    // A character that is no base at all stands for nothing, and even N
    // cannot pair with nothing.
    expect(pairsWithCode('-', 'N')).toBe(false);
    expect(pairsWithCode('', 'N')).toBe(false);
  });
});

describe('cleanPrimer', () => {
  it('reads U as T and drops what is not a code', () => {
    expect(cleanPrimer('acgu uu-n')).toBe('ACGTTTN');
  });
});

describe('mismatchPositions, at its edges', () => {
  it('finds nothing in an empty site or on an empty template', () => {
    const dna = 'ACGTTGCAAGCTTCCGGATGCATTTAAA';
    expect(
      mismatchPositions(dna, { range: { start: 5, end: 5 }, strand: 'forward' }, 'ACGT'),
    ).toEqual([]);
    expect(
      mismatchPositions('', { range: { start: 0, end: 3 }, strand: 'forward' }, 'ACG'),
    ).toEqual([]);
  });

  it('lines a primer shorter than its site up at the 3′ end, on either strand', () => {
    const dna = 'ACGTTGCAAGCTTCCGGATGCATTTAAA';
    // 2..14 is GTTGCAAGCTTC: a forward primer's 3′ end is the site's last base.
    const forward = { range: { start: 2, end: 14 }, strand: 'forward' as const };
    expect(mismatchPositions(dna, forward, 'CTTC')).toEqual([]);
    expect(mismatchPositions(dna, forward, 'CTTA')).toEqual([13]);
    // 6..18 starts CAAG: a reverse primer's 3′ end is the site's first base.
    const reverse = { range: { start: 6, end: 18 }, strand: 'reverse' as const };
    expect(mismatchPositions(dna, reverse, 'CTTG')).toEqual([]);
    expect(mismatchPositions(dna, reverse, 'ATTG')).toEqual([9]);
  });
});

describe('findAnnealingSites, at its edges', () => {
  it('lets a mismatch sit just past the 3′ anchor, and not inside it', () => {
    const text = template(1200);
    const flip = (b: string): string => (b === 'A' ? 'C' : 'A');
    // The anchor is the last five bases, 317..321; 316 is the first outside it.
    const outside = withCode(text.slice(300, 322), 16, flip(text.charAt(316)));
    expect(findAnnealingSites(text, 'linear', outside)).toMatchObject([
      { range: { start: 300, end: 322 }, annealLength: 22, mismatches: 1 },
    ]);
    const inside = withCode(text.slice(300, 322), 17, flip(text.charAt(317)));
    expect(findAnnealingSites(text, 'linear', inside)).toEqual([]);
  });

  it('keeps a site at the tip of a linear template shorter than the anchor', () => {
    // Off the end is not a mismatch: what lies on the template is all there
    // is, and it is judged by `minAnneal` alone.
    const text = template(1200);
    const sites = findAnnealingSites(text, 'linear', `GG${text.slice(0, 18)}`, {
      exactThreePrime: 20,
    });
    expect(sites).toMatchObject([
      { range: { start: 0, end: 18 }, strand: 'forward', annealLength: 18, tail: 'GG' },
    ]);
  });

  it('lists the sites in template order, whichever strand they are on', () => {
    // The same 22-mer read forward at 500 and turned round at 100: the
    // bottom-strand site is found second but lies first.
    const base = template(1200);
    const probe = base.slice(500, 522);
    const text = base.slice(0, 100) + reverseComplement(probe) + base.slice(122);
    const sites = findAnnealingSites(text, 'linear', probe);
    expect(sites.map((s) => [s.range.start, s.strand])).toEqual([
      [100, 'reverse'],
      [500, 'forward'],
    ]);
  });

  it('gives a degenerate code the template base it anneals to, past a tail, on either strand', () => {
    const text = template(1200);
    const part = text.slice(300, 322);
    // The Tm is of the molecule in the mix that pairs, so it is the Tm of
    // the template's own bases; the tail is not part of it.
    const expected = meltingTemperature(part);
    const forward = findAnnealingSites(text, 'linear', `TTTTTT${withCode(part, 11, 'N')}`);
    expect(forward).toMatchObject([{ range: { start: 300, end: 322 }, tail: 'TTTTTT' }]);
    expect(forward[0]?.tm).toBe(expected);
    const reverse = findAnnealingSites(
      text,
      'linear',
      `TTTTTT${withCode(reverseComplement(part), 3, 'N')}`,
    );
    expect(reverse).toMatchObject([
      { range: { start: 300, end: 322 }, strand: 'reverse', tail: 'TTTTTT' },
    ]);
    expect(reverse[0]?.tm).toBeCloseTo(expected, 9);
  });

  it('gives no Tm where a degenerate code pairs with nothing under it', () => {
    // No molecule of the mix pairs there, so there is no one sequence to
    // give a temperature for; a plain mismatch is the primer's own base.
    const text = template(1200);
    const part = text.slice(300, 322);
    const at = 10;
    const unpaired = 'AT'.includes(part.charAt(at)) ? 'S' : 'W';
    const [site] = findAnnealingSites(text, 'linear', withCode(part, at, unpaired));
    expect(site?.mismatches).toBe(1);
    expect(site?.tm).toBeNaN();
  });
});
