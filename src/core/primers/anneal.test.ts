import { reverseComplement } from '../sequence';
import { findAnnealingSites } from './anneal';

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

const TEXT = template(1200);

describe('findAnnealingSites', () => {
  it('finds a primer on either strand', () => {
    const forward = findAnnealingSites(TEXT, 'linear', TEXT.slice(300, 322));
    expect(forward).toHaveLength(1);
    expect(forward[0]).toMatchObject({
      range: { start: 300, end: 322 },
      strand: 'forward',
      annealLength: 22,
      tail: '',
      mismatches: 0,
    });
    const reverse = findAnnealingSites(TEXT, 'linear', reverseComplement(TEXT.slice(300, 322)));
    expect(reverse[0]).toMatchObject({ range: { start: 300, end: 322 }, strand: 'reverse' });
  });

  it('anneals by the 3′ end and calls the rest a tail', () => {
    // The whole point: a cloning primer's 5′ end is a site, an arm or a tag,
    // and matches the template nowhere. `findPrimerBindingSites` cannot see
    // such a primer at all, because it asks for a full-length match.
    const [site] = findAnnealingSites(TEXT, 'linear', `GGATCCAAG${TEXT.slice(300, 322)}`);
    expect(site).toMatchObject({
      range: { start: 300, end: 322 },
      annealLength: 22,
      tail: 'GGATCCAAG',
    });
  });

  it('will not have a mismatch under the 3′ anchor', () => {
    const bad = `${TEXT.slice(300, 320)}${TEXT.charAt(320) === 'A' ? 'CC' : 'AA'}`;
    expect(findAnnealingSites(TEXT, 'linear', bad)).toEqual([]);
    // The same two bases further from the 3′ end are tolerated, and the run
    // is trimmed back to a match, so the site never begins on a mismatch.
    const ok = `${TEXT.slice(300, 310)}${TEXT.charAt(310) === 'A' ? 'C' : 'A'}${TEXT.slice(311, 322)}`;
    const [site] = findAnnealingSites(TEXT, 'linear', ok);
    expect(site).toMatchObject({ annealLength: 22, mismatches: 1 });
  });

  it('needs a long enough match', () => {
    expect(findAnnealingSites(TEXT, 'linear', TEXT.slice(300, 314))).toEqual([]);
    expect(findAnnealingSites(TEXT, 'linear', TEXT.slice(300, 315))).toHaveLength(1);
    expect(
      findAnnealingSites(TEXT, 'linear', TEXT.slice(300, 314), { minAnneal: 14 }),
    ).toHaveLength(1);
  });

  it('wraps the origin of a circular template', () => {
    const over = TEXT.slice(1190) + TEXT.slice(0, 12);
    expect(findAnnealingSites(TEXT, 'linear', over)).toEqual([]);
    const [site] = findAnnealingSites(TEXT, 'circular', over);
    expect(site).toMatchObject({ range: { start: 1190, end: 1212 }, annealLength: 22 });
  });

  it('stops at the tip of a linear template', () => {
    // A primer hanging off the end anneals by whatever is under it, which is
    // how a tail is added to a linear fragment.
    const [site] = findAnnealingSites(TEXT, 'linear', reverseComplement(TEXT.slice(0, 20)));
    expect(site).toMatchObject({ range: { start: 0, end: 20 }, strand: 'reverse' });
    const hanging = findAnnealingSites(
      TEXT,
      'linear',
      `${reverseComplement(TEXT.slice(0, 20))}GGGG`,
    );
    // Its 3′ end would sit four bases before the sequence starts, so it
    // cannot prime at all.
    expect(hanging).toEqual([]);
  });
});
