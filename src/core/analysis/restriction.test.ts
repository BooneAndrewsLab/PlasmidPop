import { reverseComplement } from '../sequence';
import { ENZYME_TABLE } from './enzymeTable';
import {
  BUNDLED_ENZYME_SET,
  type Enzyme,
  ENZYMES,
  activeEnzymeSet,
  cutLabel,
  digestFragments,
  findCutSites,
  getEnzyme,
  isTypeIIS,
  isoschizomerGroups,
  isoschizomerKey,
  overhangKind,
  overhangLength,
  setActiveEnzymeSet,
  siteStillMatches,
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

  describe('an enzyme that cuts on both sides of its site', () => {
    // BcgI (10/12)CGANNNNNNTGC(12/10), as a REBASE import reads it.
    const bcgI: Enzyme = {
      name: 'BcgI',
      site: 'CGANNNNNNTGC',
      cutTop: -10,
      cutBottom: -12,
      secondCut: { cutTop: 24, cutBottom: 22 },
      palindromic: false,
    };
    const flank = 'T'.repeat(20);
    const fwd = `${flank}CGAAAAAAATGC${flank}`; // site at 20..32

    it('cuts twice per site, and mirrors both cuts on the bottom strand', () => {
      expect(findCutSites(fwd, 'linear', [bcgI])).toEqual([
        { enzyme: 'BcgI', cut: 10, cutBottom: 8, siteStart: 20, strand: 'forward' },
        { enzyme: 'BcgI', cut: 44, cutBottom: 42, siteStart: 20, strand: 'forward' },
      ]);
      const L = fwd.length;
      expect(findCutSites(reverseComplement(fwd), 'linear', [bcgI])).toEqual([
        { enzyme: 'BcgI', cut: L - 42, cutBottom: L - 44, siteStart: L - 32, strand: 'reverse' },
        { enzyme: 'BcgI', cut: L - 8, cutBottom: L - 10, siteStart: L - 32, strand: 'reverse' },
      ]);
      // Excised: the site leaves on a 34-base piece, with 3' overhangs of 2.
      expect(digestFragments([10, 44], L, 'linear').map((f) => f.length)).toEqual([10, 34, 8]);
    });

    it('keeps the cut that falls on a linear molecule and drops the other', () => {
      const short = `TTTTTCGAAAAAAATGC${flank}`;
      expect(findCutSites(short, 'linear', [bcgI]).map((c) => c.cut)).toEqual([29]);
    });

    it('wraps both cuts on a circle', () => {
      const circle = `CGAAAAAAATGC${flank}`; // 32 bp; the first cut is 10 before the origin
      expect(findCutSites(circle, 'circular', [bcgI])).toEqual([
        { enzyme: 'BcgI', cut: 22, cutBottom: 20, siteStart: 0, strand: 'forward' },
        { enzyme: 'BcgI', cut: 24, cutBottom: 22, siteStart: 0, strand: 'forward' },
      ]);
    });

    it('is a group of its own, apart from a single cutter at the same site', () => {
      const { secondCut: _, ...rest } = bcgI;
      const single: Enzyme = { ...rest, name: 'Single' };
      expect(isoschizomerGroups([bcgI, single])).toHaveLength(2);
    });
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

describe('isoschizomerGroups', () => {
  const make = (name: string, site: string, cutTop: number, cutBottom: number, suppliers = '') => ({
    name,
    site,
    cutTop,
    cutBottom,
    palindromic: true,
    suppliers: suppliers === '' ? [] : suppliers.split(','),
  });

  it('groups by site and cut, so neoschizomers stay apart', () => {
    const groups = isoschizomerGroups([
      make('XmaI', 'CCCGGG', 1, 5),
      make('SmaI', 'CCCGGG', 3, 3),
      make('TspMI', 'cccggg', 1, 5),
      make('BamHI', 'GGATCC', 1, 5),
    ]);
    expect(groups.map((g) => g.members.map((e) => e.name))).toEqual([
      ['BamHI'],
      ['SmaI'],
      ['XmaI', 'TspMI'],
    ]);
  });

  it('puts the bundled name first, then the most widely sold', () => {
    const [group] = isoschizomerGroups([
      make('BstI', 'GGATCC', 1, 5, 'A,B,C,D'),
      make('AliI', 'GGATCC', 1, 5, 'A,B'),
      make('BamHI', 'GGATCC', 1, 5, 'N'),
      make('OkrAI', 'GGATCC', 1, 5, 'A,B'),
    ]);
    expect(group?.members.map((e) => e.name)).toEqual(['BamHI', 'BstI', 'AliI', 'OkrAI']);
  });

  it('leaves the bundled table nearly one enzyme per group', () => {
    const groups = isoschizomerGroups(ENZYMES);
    const shared = groups.filter((g) => g.members.length > 1);
    // HpaII and MspI are the classic pair: C^CGG both, one blocked by CpG methylation.
    expect(shared.some((g) => g.members.some((e) => e.name === 'MspI'))).toBe(true);
    expect(groups.length).toBeGreaterThan(ENZYMES.length - 10);
  });
});

describe('siteStillMatches (#138)', () => {
  const enzyme = (name: string) => {
    const e = getEnzyme(name);
    if (e === undefined) throw new Error(name);
    return e;
  };

  it('checks every site the scan finds, on either strand and over the origin', () => {
    let x = 7;
    let body = '';
    for (let i = 0; i < 3000; i++) {
      x = (x * 1103515245 + 12345) % 2147483648;
      body += 'ACGTN'.charAt(i % 97 === 0 ? 4 : (x >> 16) % 4);
    }
    const text = 'TTC' + body + 'GAA';
    for (const topology of ['linear', 'circular'] as const) {
      const sites = findCutSites(text, topology);
      expect(new Set(sites.map((s) => s.strand))).toEqual(new Set(['forward', 'reverse']));
      for (const s of sites)
        expect(siteStillMatches(text, topology, s, enzyme(s.enzyme))).toBe(true);
    }
    const over = findCutSites(text, 'circular', [enzyme('EcoRI')]).find(
      (s) => s.siteStart === text.length - 3,
    );
    if (over === undefined) throw new Error('no EcoRI site over the origin');
    expect(siteStillMatches(text, 'circular', over, enzyme('EcoRI'))).toBe(true);
    expect(siteStillMatches('C' + text.slice(1), 'circular', over, enzyme('EcoRI'))).toBe(false);
    expect(siteStillMatches(text, 'linear', over, enzyme('EcoRI'))).toBe(false);
  });

  it('turns a site down once a base of it changed', () => {
    const bsaI = enzyme('BsaI');
    const rev = { enzyme: 'BsaI', cut: 3, cutBottom: 7, siteStart: 10, strand: 'reverse' as const };
    expect(siteStillMatches('AAAAAAAAAAGAGACCAA', 'linear', rev, bsaI)).toBe(true);
    expect(siteStillMatches('AAAAAAAAAAGAGACAAA', 'linear', rev, bsaI)).toBe(false);
    expect(siteStillMatches('AAAAAAAAAAGGTCTCAA', 'linear', rev, bsaI)).toBe(false);
    expect(siteStillMatches('aaaaaaaaaagagaccaa', 'linear', rev, bsaI)).toBe(true);
  });
});

describe('cutLabel (#168)', () => {
  it('calls a cut at the origin of a circle "after the last base"', () => {
    expect(cutLabel(0, 4000, 'circular')).toBe(4000);
  });

  it('leaves every other cut, and a cut before the first base of a line, alone', () => {
    expect(cutLabel(1, 4000, 'circular')).toBe(1);
    expect(cutLabel(3999, 4000, 'circular')).toBe(3999);
    expect(cutLabel(0, 4000, 'linear')).toBe(0);
    expect(cutLabel(4000, 4000, 'linear')).toBe(4000);
  });

  it('is what findCutSites reports for a cut that lands exactly on the origin', () => {
    // G^AATTC with the G last: the cut falls between the last base and the first.
    const sequence = 'AATTC' + 'ACGT'.repeat(50) + 'G';
    const ecoRI = getEnzyme('EcoRI');
    if (ecoRI === undefined) throw new Error('EcoRI is in the table');
    const [site] = findCutSites(sequence, 'circular', [ecoRI]);
    expect(site?.cut).toBe(0);
    expect(cutLabel(site?.cut ?? -1, sequence.length, 'circular')).toBe(sequence.length);
  });
});

describe('restriction edges (mutation tests)', () => {
  const fake = (name: string, site: string, cutTop: number, cutBottom: number): Enzyme => ({
    name,
    site,
    cutTop,
    cutBottom,
    palindromic: reverseComplement(site).toUpperCase() === site.toUpperCase(),
  });

  it('calls a cut Type IIS only outside the site, its ends included', () => {
    expect(isTypeIIS(fake('X', 'GAATTC', 0, 0))).toBe(false);
    expect(isTypeIIS(fake('X', 'GAATTC', 6, 6))).toBe(false);
    expect(isTypeIIS(fake('X', 'GAATTC', 0, 6))).toBe(false);
    expect(isTypeIIS(fake('X', 'GAATTC', -1, 3))).toBe(true);
    expect(isTypeIIS(fake('X', 'GAATTC', 7, 3))).toBe(true);
    expect(isTypeIIS(fake('X', 'GAATTC', 3, -1))).toBe(true);
    expect(isTypeIIS(fake('X', 'GAATTC', 3, 7))).toBe(true);
  });

  it('keys an isoschizomer by its site in capitals and its cuts', () => {
    expect(isoschizomerKey(fake('X', 'gaattc', 1, 5))).toBe('GAATTC 1 5');
    expect(
      isoschizomerKey({
        site: 'GAANNNNTTC',
        cutTop: -7,
        cutBottom: -12,
        secondCut: { cutTop: 17, cutBottom: 22 },
      }),
    ).toBe('GAANNNNTTC -7 -12 17 22');
  });

  it('installs an enzyme set and goes back to the bundled one', () => {
    expect(activeEnzymeSet()).toBe(BUNDLED_ENZYME_SET);
    const set = {
      id: 'rebase',
      label: 'Mine',
      enzymes: [fake('Zzz1', 'ACGTTA', 2, 4)],
      suppliers: [],
    };
    try {
      setActiveEnzymeSet(set);
      expect(activeEnzymeSet()).toBe(set);
      expect(getEnzyme('zzz1')?.site).toBe('ACGTTA');
      expect(getEnzyme('EcoRI')?.site).toBe('GAATTC');
    } finally {
      setActiveEnzymeSet(null);
    }
    expect(activeEnzymeSet()).toBe(BUNDLED_ENZYME_SET);
    expect(getEnzyme('Zzz1')).toBeUndefined();
  });

  it('finds nothing in an empty sequence, even for an empty site', () => {
    for (const topology of ['linear', 'circular'] as const) {
      expect(findCutSites('', topology, [fake('Empty', '', 0, 0)])).toEqual([]);
    }
  });

  it('finds a site through the origin of a circle only', () => {
    const ecoRI = getEnzyme('EcoRI');
    if (ecoRI === undefined) throw new Error('EcoRI');
    // GAA at the end, TTC at the start.
    const seq = 'TTCAAAAAAAAGAA';
    expect(findCutSites(seq, 'linear', [ecoRI])).toEqual([]);
    expect(findCutSites(seq, 'circular', [ecoRI])).toEqual([
      { enzyme: 'EcoRI', cut: 12, cutBottom: 2, siteStart: 11, strand: 'forward' },
    ]);
  });

  it('keeps a cut at either end of a line', () => {
    // GGATG is not its own reverse complement (CATCC), which neither holds.
    const atStart = fake('Edge0', 'GGATG', 0, 0);
    const atEnd = fake('Edge5', 'GGATG', 5, 5);
    expect(findCutSites('GGATGAAAA', 'linear', [atStart]).map((s) => s.cut)).toEqual([0]);
    expect(findCutSites('AAAAGGATG', 'linear', [atEnd]).map((s) => s.cut)).toEqual([9]);
  });

  it('orders enzymes cutting at one place by name, as people read them', () => {
    const names = ['Gamma', 'beta', 'Alpha'];
    const sites = findCutSites(
      'AAGAATTCAAGAATTCAA',
      'linear',
      names.map((n) => fake(n, 'GAATTC', 1, 5)),
    );
    expect(sites.map((s) => `${s.cut} ${s.enzyme}`)).toEqual([
      '3 Alpha',
      '3 beta',
      '3 Gamma',
      '11 Alpha',
      '11 beta',
      '11 Gamma',
    ]);
  });

  it('keeps that order when the enzymes come in it already', () => {
    const names = ['Alpha', 'beta', 'Delta', 'Gamma'];
    const sites = findCutSites(
      'AAGAATTCAA',
      'linear',
      names.map((n) => fake(n, 'GAATTC', 1, 5)),
    );
    expect(sites.map((s) => s.enzyme)).toEqual(names);
  });

  it('checks a site where it is, and nowhere it cannot be', () => {
    const ecoRI = fake('EcoRI', 'GAATTC', 1, 5);
    const at = (siteStart: number) => ({
      enzyme: 'EcoRI',
      cut: siteStart + 1,
      cutBottom: siteStart + 5,
      siteStart,
      strand: 'forward' as const,
    });
    expect(siteStillMatches('GAATTCAAAA', 'linear', at(0), ecoRI)).toBe(true);
    // Ending at the last base of a line.
    expect(siteStillMatches('AAAAGAATTC', 'linear', at(4), ecoRI)).toBe(true);
    // Through the origin of a circle, and not of a line.
    expect(siteStillMatches('TTCAAAAGAA', 'circular', at(7), ecoRI)).toBe(true);
    expect(siteStillMatches('TTCAAAAGAA', 'linear', at(7), ecoRI)).toBe(false);
    // A start at or past the end, or before the start, even on a circle.
    expect(siteStillMatches('GAATTCAAAA', 'circular', at(10), ecoRI)).toBe(false);
    expect(siteStillMatches('GAATTCAAAA', 'circular', at(11), ecoRI)).toBe(false);
    expect(siteStillMatches('AGAATTCAAA', 'circular', at(-1), ecoRI)).toBe(false);
    // String.slice reads a negative start from the end: -10 of ten bases is 0.
    expect(siteStillMatches('GAATTCAAAA', 'linear', at(-10), ecoRI)).toBe(false);
    expect(siteStillMatches('GAATTCAAAA', 'circular', at(-10), ecoRI)).toBe(false);
    // A site longer than the circle would read round it more than once.
    expect(siteStillMatches('AAAA', 'circular', at(0), fake('A6', 'AAAAAA', 0, 0))).toBe(false);
    expect(siteStillMatches('AAAA', 'circular', at(0), fake('A4', 'AAAA', 0, 0))).toBe(true);
    // An empty site is no site.
    expect(siteStillMatches('AAAA', 'circular', at(0), fake('None', '', 0, 0))).toBe(false);
  });

  it('cuts a circle into pieces in order round it, a cut at the end being one at 0', () => {
    expect(digestFragments([10, 3], 10, 'circular')).toEqual([
      { start: 0, end: 3, length: 3 },
      { start: 3, end: 10, length: 7 },
    ]);
    expect(digestFragments([10, 9], 20, 'circular').map((f) => f.start)).toEqual([9, 10]);
    expect(digestFragments([4], 10, 'circular')).toEqual([{ start: 4, end: 14, length: 10 }]);
    expect(digestFragments([10], 10, 'circular')).toEqual([{ start: 0, end: 10, length: 10 }]);
  });
});
