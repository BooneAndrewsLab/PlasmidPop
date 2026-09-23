import { describe, expect, it } from 'vitest';

import { getEnzyme } from '@/core';

import { RebaseParseError, parseRebaseWithRefM } from './withrefm';

/**
 * A stand-in for a REBASE download, written here rather than checked in as a
 * real one: REBASE files are "all rights reserved" and must not live in this
 * repo (docs/design/07-rebase-enzymes.md). The layout follows the format REBASE documents in
 * its own header; the enzymes are ones the bundled table already carries, so
 * the facts in this fixture are ours to begin with.
 */
const FIXTURE = `
REBASE version 609                                              withrefm.609
 
    REBASE, The Restriction Enzyme Database   http://rebase.neb.com
    Copyright (c)  Dr. Somebody, 2024.   All rights reserved.
 
Rich Roberts                                                    Aug 27 2026
 

REBASE codes for commercial sources of enzymes

                N        New England Biolabs (8/24)
                R        Promega Corporation (11/20)


<1>EcoRI
<2>BstHPI,Eco1I
<3>G^AATTC
<4>3(6)
<5>Escherichia coli RY13
<6>R.N. Yoshimori
<7>NR
<8>Greene, P.J., Unpublished observations.

<1>SmaI
<2>XmaI
<3>CCC^GGG
<4>
<5>Serratia marcescens Sb
<6>ATCC 13880
<7>N
<8>Endow, S.A., Unpublished observations.

<1>BsaI
<2>Eco31I
<3>GGTCTC(1/5)
<4>-4(6)
<5>Bacillus stearothermophilus 6-55
<6>NEB
<7>N
<8>Unpublished observations.

<1>BsmI
<2>
<3>GAATGC(1/-1)
<4>
<5>Bacillus stearothermophilus NUB36
<6>NEB
<7>N
<8>Unpublished observations.

<1>BglI
<2>
<3>GCCNNNN^NGGC
<4>
<5>Bacillus globigii
<6>NEB
<7>N
<8>Unpublished observations.

<1>BcgI
<2>
<3>(10/12)CGANNNNNNTGC(12/10)
<4>3(6),-3(6)
<5>Bacillus coagulans
<6>NEB
<7>N
<8>Unpublished observations.

<1>AbaPI
<2>
<3>CCCNNNNNNNNNNNNN
<4>
<5>Somewhere
<6>Someone
<7>
<8>Unpublished observations.

<1>AbcI
<2>
<3>CCANNNNN?
<4>
<5>Somewhere
<6>Someone
<7>
<8>Unpublished observations.

<1>AbaSI
<2>
<3>C(11/9)
<4>
<5>Acinetobacter baumannii
<6>Someone
<7>N
<8>Unpublished observations.

<1>CviJI
<2>
<3>RG^CY
<4>
<5>Chlorella virus
<6>Someone
<7>
<8>Unpublished observations.

<1>M.EcoRI
<2>
<3>GA^ATTC
<4>
<5>Escherichia coli RY13
<6>R.N. Yoshimori
<7>
<8>Unpublished observations.
`;

describe('parseRebaseWithRefM', () => {
  const parsed = parseRebaseWithRefM(FIXTURE);
  const find = (name: string) => parsed.enzymes.find((e) => e.name === name);

  it('reads the release and the supplier key from the header', () => {
    expect(parsed.version).toBe('609');
    expect(parsed.released).toBe('Aug 27 2026');
    expect(parsed.suppliers).toEqual([
      { code: 'N', name: 'New England Biolabs' },
      { code: 'R', name: 'Promega Corporation' },
    ]);
  });

  it('reads a caret cut into our own offsets', () => {
    expect(find('EcoRI')).toMatchObject({ site: 'GAATTC', cutTop: 1, cutBottom: 5 });
    expect(find('SmaI')).toMatchObject({ site: 'CCCGGG', cutTop: 3, cutBottom: 3 });
  });

  it('reads a Type IIS cut beyond the site, including a negative offset', () => {
    expect(find('BsaI')).toMatchObject({ site: 'GGTCTC', cutTop: 7, cutBottom: 11 });
    // GAATGC(1/-1): one past the site on top, one base inside it below.
    expect(find('BsmI')).toMatchObject({ site: 'GAATGC', cutTop: 7, cutBottom: 5 });
  });

  it('agrees with the bundled table on the enzymes both hold', () => {
    for (const name of ['EcoRI', 'SmaI', 'BsaI', 'BsmI', 'BglI']) {
      const ours = getEnzyme(name);
      expect(find(name), name).toMatchObject({
        site: ours?.site,
        cutTop: ours?.cutTop,
        cutBottom: ours?.cutBottom,
        palindromic: ours?.palindromic,
      });
    }
  });

  it('keeps the suppliers, isoschizomers and methylation site', () => {
    expect(find('EcoRI')?.suppliers).toEqual(['N', 'R']);
    expect(find('EcoRI')?.isoschizomers).toEqual(['BstHPI', 'Eco1I']);
    expect(find('EcoRI')?.methylation).toBe('3(6)');
    // An enzyme nobody sells carries no supplier list at all.
    expect(find('SmaI')?.isoschizomers).toEqual(['XmaI']);
    expect(find('BsmI')?.methylation).toBeUndefined();
  });

  it('reads an enzyme that cuts on both sides of its site', () => {
    // (10/12)CGANNNNNNTGC(12/10): 10 and 12 bases before the 12-base site,
    // 12 and 10 after it — a 2-base 3' overhang at each cut.
    expect(find('BcgI')).toMatchObject({
      site: 'CGANNNNNNTGC',
      cutTop: -10,
      cutBottom: -12,
      secondCut: { cutTop: 24, cutBottom: 22 },
    });
    expect(find('EcoRI')?.secondCut).toBeUndefined();
  });

  it('leaves out what it cannot represent, and counts why', () => {
    // A site with no cut position determined.
    expect(find('AbaPI')).toBeUndefined();
    expect(find('AbcI')).toBeUndefined();
    expect(parsed.skipped).toEqual({
      cutUnknown: 2,
      noSite: 0,
      tooUnspecific: 1,
    });
  });

  it('leaves out modification-dependent enzymes, and keeps real frequent cutters', () => {
    // REBASE gives AbaSI the site `C` because what it cuts is a modified
    // cytosine; taken literally it would cut at every C in the plasmid.
    expect(find('AbaSI')).toBeUndefined();
    // CviJI is genuinely this frequent, and sits just above the line.
    expect(find('CviJI')).toMatchObject({ site: 'RGCY', cutTop: 2, cutBottom: 2 });
  });

  it('leaves out methyltransferases, which do not cut', () => {
    expect(find('M.EcoRI')).toBeUndefined();
  });

  it('sorts by name so the panel has a stable order', () => {
    const names = parsed.enzymes.map((e) => e.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('refuses text that is not a REBASE file', () => {
    expect(() => parseRebaseWithRefM('LOCUS  pBR322  4361 bp')).toThrow(RebaseParseError);
  });
});
