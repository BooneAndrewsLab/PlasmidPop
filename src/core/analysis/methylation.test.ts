import { hostMethylationAt, isHostMethylationSensitive } from './methylation';
import { findCutSites, getEnzyme } from './restriction';

/** What host methylation each cut of `enzyme` in `sequence` would meet. */
function at(sequence: string, enzyme: string, topology: 'linear' | 'circular' = 'linear') {
  const e = getEnzyme(enzyme);
  if (e === undefined) throw new Error(enzyme);
  return findCutSites(sequence, topology, [e]).map((s) =>
    hostMethylationAt(sequence, topology, s, e.site.length),
  );
}

describe('host methylation', () => {
  it('knows which enzymes care, whatever their site', () => {
    // MboI and Sau3AI share GATC; only MboI is blocked by Dam.
    expect(isHostMethylationSensitive('MboI')).toBe(true);
    expect(isHostMethylationSensitive('sau3ai')).toBe(false);
    expect(at('TTGATCTT', 'MboI')).toEqual([['Dam']]);
    expect(at('TTGATCTT', 'Sau3AI')).toEqual([[]]);
    // BamHI's GGATCC holds a GATC, and BamHI cuts it anyway.
    expect(at('TTGGATCCTT', 'BamHI')).toEqual([[]]);
  });

  it('sees a Dam site the flank makes with the recognition site', () => {
    // XbaI TCTAGA is blocked only where a GATC overlaps it.
    expect(at('CCCTCTAGACCC', 'XbaI')).toEqual([[]]);
    expect(at('CCGATCTAGACC', 'XbaI')).toEqual([['Dam']]);
    expect(at('CCTCTAGATCCC', 'XbaI')).toEqual([['Dam']]);
    // ClaI ATCGAT behind a G.
    expect(at('CCGATCGATCC', 'ClaI')).toEqual([['Dam']]);
  });

  it('sees a Dcm site the flank makes with the recognition site', () => {
    // StuI AGGCCT followed by GG makes CCTGG; ApaI GGGCCC followed by AGG makes CCAGG.
    expect(at('TTAGGCCTTT', 'StuI')).toEqual([[]]);
    expect(at('TTAGGCCTGGT', 'StuI')).toEqual([['Dcm']]);
    expect(at('TTGGGCCCAGGT', 'ApaI')).toEqual([['Dcm']]);
    // BsaI GGTCTC behind CCA: the bottom strand's methylated C is in the site.
    expect(at('TTCCAGGTCTCAAAAAAAA', 'BsaI')).toEqual([['Dcm']]);
  });

  it('reads across the origin of a circle', () => {
    // XbaI at the end, GATC made by the bases at the start: ...GA|TCTAGA
    const circle = `TCTAGACCCCCCCCCCGA`;
    expect(at(circle, 'XbaI', 'circular')).toEqual([['Dam']]);
    expect(at(circle, 'XbaI', 'linear')).toEqual([[]]);
  });

  it('does not count a methylated base just past the end of the site', () => {
    // PhoI GGCC is hit by any Dcm base inside it; the CCAGG here starts on
    // its last C, so its methylated inner C is the first base after the site.
    const site = (enzyme: string, siteStart: number, length: number, strand?: 'reverse') =>
      hostMethylationAt(
        'AAAAGGCCCAGG',
        'linear',
        { enzyme, siteStart, ...(strand && { strand }) },
        length,
      );
    expect(site('PhoI', 4, 4)).toEqual([]);
    expect(site('PhoI', 4, 5)).toEqual(['Dcm']);
    expect(site('PhoI', 4, 4, 'reverse')).toEqual([]);
  });

  it('reads a reverse-strand hit of a non-palindromic enzyme mirrored, not as its own mirror image', () => {
    // AlwI GGATC (blocked by the Dam base on the bottom strand of its GATC)
    // is not its own reverse complement, so the mirror reading must not be
    // tried for it, whether or not the enzyme is in the restriction table.
    const reverse = (sequence: string, enzyme: string, length: number) =>
      hostMethylationAt(sequence, 'linear', { enzyme, siteStart: 4, strand: 'reverse' }, length);
    expect(reverse('AAAAGGATCAAAA', 'AlwI', 5)).toEqual([]);
    expect(reverse('ACCAGGGACAAAA', 'BsmFI', 5)).toEqual([]);
    expect(reverse('AAAAGGCGGATCAA', 'EciI', 6)).toEqual([]);
    expect(reverse('AAAAGGTGATCAA', 'HphI', 5)).toEqual([]);
    expect(reverse('AAAAGAAGATCAA', 'MboII', 5)).toEqual([]);
  });
});
