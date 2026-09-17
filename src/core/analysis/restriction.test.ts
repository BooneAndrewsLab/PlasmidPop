import { reverseComplement } from '../sequence';
import { ENZYME_TABLE } from './enzymeTable';
import {
  ENZYMES,
  digestFragments,
  findCutSites,
  getEnzyme,
  overhangKind,
  overhangLength,
  summarizeEnzymes,
} from './restriction';

describe('enzyme table', () => {
  it('has unique names and valid IUPAC sites', () => {
    const names = ENZYME_TABLE.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
    for (const [, site] of ENZYME_TABLE) expect(site).toMatch(/^[ACGTRYSWKMBDHVN]+$/);
  });

  it('has symmetric cut positions for every palindromic enzyme', () => {
    for (const e of ENZYMES) {
      if (!e.palindromic) continue;
      expect(e.cutTop + e.cutBottom, `${e.name} ${e.site} ${e.cutTop}/${e.cutBottom}`).toBe(
        e.site.length,
      );
    }
  });

  it('classifies overhangs', () => {
    expect(overhangKind(enzyme('EcoRI'))).toBe("5'");
    expect(overhangKind(enzyme('PstI'))).toBe("3'");
    expect(overhangKind(enzyme('SmaI'))).toBe('blunt');
    expect(overhangLength(enzyme('NotI'))).toBe(4);
    expect(getEnzyme('ecori')?.name).toBe('EcoRI');
    expect(getEnzyme('nope')).toBeUndefined();
  });
});

function enzyme(name: string) {
  const e = getEnzyme(name);
  if (e === undefined) throw new Error(`no enzyme ${name}`);
  return e;
}

const only = (...names: string[]) => names.map(enzyme);

describe('findCutSites', () => {
  it('finds palindromic sites once with correct top and bottom cuts', () => {
    const seq = 'CCCCGAATTCCCCC';
    const sites = findCutSites(seq, 'linear', only('EcoRI'));
    expect(sites).toEqual([
      { enzyme: 'EcoRI', cut: 5, cutBottom: 9, siteStart: 4, strand: 'forward' },
    ]);
    expect(findCutSites('CCCCTGCAGCC', 'linear', only('PstI'))).toEqual([
      { enzyme: 'PstI', cut: 8, cutBottom: 4, siteStart: 3, strand: 'forward' },
    ]);
  });

  it('matches IUPAC codes in the site but not ambiguity in the sequence unless the site allows it', () => {
    expect(findCutSites('AGTCGACA', 'linear', only('HincII'))).toHaveLength(1); // GTYRAC matches GTCGAC
    expect(findCutSites('AGTNGACA', 'linear', only('HincII'))).toHaveLength(0);
    expect(findCutSites('AGANTCA', 'linear', only('HinfI'))).toHaveLength(1); // GANTC accepts N
    expect(findCutSites('agaattca', 'linear', only('EcoRI'))).toHaveLength(1);
  });

  it('handles Type IIS enzymes on both strands with mirrored cuts', () => {
    // BsaI GGTCTC(1/5): site at 2, cuts top at 2+7=9, bottom at 2+11=13
    const fwd = 'CCGGTCTCAAAAAAAAAAAA';
    expect(findCutSites(fwd, 'linear', only('BsaI'))).toEqual([
      { enzyme: 'BsaI', cut: 9, cutBottom: 13, siteStart: 2, strand: 'forward' },
    ]);
    // Reverse: the same molecule flipped; cuts must land on the same bases.
    const rev = reverseComplement(fwd);
    const L = fwd.length;
    expect(findCutSites(rev, 'linear', only('BsaI'))).toEqual([
      { enzyme: 'BsaI', cut: L - 13, cutBottom: L - 9, siteStart: L - 8, strand: 'reverse' },
    ]);
    // Cuts that fall off a linear molecule are dropped.
    expect(findCutSites('CCGGTCTCAA', 'linear', only('BsaI'))).toEqual([]);
    expect(findCutSites('CCGGTCTCAA', 'circular', only('BsaI'))).toEqual([
      { enzyme: 'BsaI', cut: 9, cutBottom: 3, siteStart: 2, strand: 'forward' },
    ]);
  });

  it('finds sites and cuts across the origin of a circular sequence', () => {
    const seq = 'TTCAAAAAAAAGAA'; // GAATTC spans the origin: GAA|TTC
    expect(findCutSites(seq, 'circular', only('EcoRI'))).toEqual([
      { enzyme: 'EcoRI', cut: 12, cutBottom: 2, siteStart: 11, strand: 'forward' },
    ]);
    expect(findCutSites(seq, 'linear', only('EcoRI'))).toEqual([]);
    expect(findCutSites('', 'circular')).toEqual([]);
  });

  it('runs the whole table over pBR322-like text and sorts by cut', () => {
    const seq = 'GAATTCAAAAGGATCCAAAACTGCAGAAAA';
    const sites = findCutSites(seq, 'linear');
    expect(sites.map((s) => s.enzyme)).toEqual(expect.arrayContaining(['EcoRI', 'BamHI', 'PstI']));
    for (let i = 1; i < sites.length; i++)
      expect((sites[i]?.cut ?? 0) >= (sites[i - 1]?.cut ?? 0)).toBe(true);
    const summary = summarizeEnzymes(sites);
    expect(summary.find((s) => s.enzyme.name === 'EcoRI')?.sites).toHaveLength(1);
    expect(summary.find((s) => s.enzyme.name === 'NotI')?.sites).toHaveLength(0);
  });
});

describe('digestFragments', () => {
  it('cuts linear molecules into ordered fragments', () => {
    expect(digestFragments([5, 2, 5], 10, 'linear')).toEqual([
      { start: 0, end: 2, length: 2 },
      { start: 2, end: 5, length: 3 },
      { start: 5, end: 10, length: 5 },
    ]);
    expect(digestFragments([], 10, 'linear')).toEqual([{ start: 0, end: 10, length: 10 }]);
    expect(digestFragments([0, 10], 10, 'linear')).toEqual([{ start: 0, end: 10, length: 10 }]);
  });

  it('cuts circular molecules with wrapping fragments', () => {
    expect(digestFragments([7, 2], 10, 'circular')).toEqual([
      { start: 2, end: 7, length: 5 },
      { start: 7, end: 12, length: 5 },
    ]);
    expect(digestFragments([3], 10, 'circular')).toEqual([{ start: 3, end: 13, length: 10 }]);
    expect(digestFragments([], 10, 'circular')).toEqual([{ start: 0, end: 10, length: 10 }]);
    expect(digestFragments([], 0, 'circular')).toEqual([]);
  });
});
