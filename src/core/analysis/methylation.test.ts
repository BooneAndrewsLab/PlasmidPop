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
});
